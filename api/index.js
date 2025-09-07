import { sendLoginButton, sendRawMessage } from "../helpers/messengerHelper.js";
import { runCronJobs } from "../helpers/cronHelper.js";
import { isPsidRegistered } from "../helpers/redisHelper.js";
import { handleUserTextMessage } from "../helpers/messengerHelper.js";

export default async function handler(req, res) {
  const VERIFY_TOKEN = process.env.MESSENGER_VERIFY_TOKEN;

  // --- ক্রন জব ট্রিগার ---
  if (req.query.cron === "true") {
    try {
      console.log("[API] Cron trigger received via HTTP /?cron=true");
      await runCronJobs();
      return res.status(200).send("Cron jobs executed successfully.");
    } catch (err) {
      console.error("❌ Cron jobs failed:", err);
      return res.status(500).send("Cron jobs error");
    }
  }

  // --- ফেসবুক ওয়েব হুক ভেরিফিকেশন (GET) ---
  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    console.log(`[Webhook] GET verification attempt mode=${mode} token=${token ? "provided" : "missing"}`);
    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      console.log("[Webhook] Verification successful. Responding with challenge.");
      return res.status(200).send(challenge);
    }
    console.warn("[Webhook] Verification failed. Forbidden.");
    return res.status(403).send("Forbidden");
  }

  // --- মেসেঞ্জারের মেসেজ হ্যান্ডেল (POST) ---
  if (req.method === "POST") {
    try {
      const body = req.body;
      console.log("[Webhook] POST body received:", JSON.stringify(body).substring(0, 1500));
      if (!body || body.object !== "page") return res.status(400).send("Invalid request");

      for (const entry of body.entry || []) {
        for (const event of entry.messaging || []) {
          const senderId = event.sender?.id;
          if (!senderId) continue;

          // If text message present
          if (event.message && event.message.text) {
            console.log(`[Webhook] Received text from PSID ${senderId}: "${event.message.text}"`);
            const isRegistered = await isPsidRegistered(senderId);
            if (isRegistered) {
              console.log(`[Webhook] PSID ${senderId} is registered -> handling text message.`);
              await handleUserTextMessage(senderId, event.message.text);
            } else {
              console.log(`[Webhook] PSID ${senderId} NOT registered -> sending login button.`);
              await sendLoginButton(senderId);
            }
          } else if (event.message) {
            // Non-text message
            console.log(`[Webhook] Received non-text message from PSID ${senderId} -> acknowledging.`);
            await sendRawMessage(senderId, `Thanks! I only process text commands right now. Try: /assignments today or "Show assignments today".`);
          } else {
            // other event types (delivery, read, postback)
            console.log(`[Webhook] Ignoring event type for PSID ${senderId}: ${Object.keys(event).join(", ")}`);
          }
        }
      }

      return res.status(200).send("EVENT_RECEIVED");
    } catch (err) {
      console.error("❌ Error handling webhook POST:", err);
      return res.status(500).send("Error");
    }
  }

  return res.status(400).send("Invalid request method");
}
