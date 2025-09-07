import { sendLoginButton, sendRawMessage } from "../helpers/messengerHelper.js";
import { runCronJobs } from "../helpers/cronHelper.js";
import { isPsidRegistered, getUserByPsid } from "../helpers/redisHelper.js";
import { handleUserTextMessage } from "../helpers/messengerHelper.js";

export default async function handler(req, res) {
  const VERIFY_TOKEN = process.env.MESSENGER_VERIFY_TOKEN;

  // --- ক্রন জব ট্রিগার ---
  if (req.query.cron === "true") {
    try {
      await runCronJobs();
      return res.status(200).send("Cron jobs executed successfully.");
    } catch (err) {
      console.error("❌ Cron jobs failed:", err);
      return res.status(500).send("Cron jobs error");
    }
  }

  // --- ফেসবুক ওয়েবহুক ভেরিফিকেশন (GET রিকোয়েস্ট) ---
  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      console.log("[Webhook] Verification challenge received -- sending challenge.");
      return res.status(200).send(challenge);
    }
    console.log("[Webhook] Verification failed.");
    return res.status(403).send("Forbidden");
  }

  // --- মেসেঞ্জারের মেসেজ হ্যান্ডেল করা (POST রিকোয়েস্ট) ---
  if (req.method === "POST") {
    try {
      const body = req.body;
      console.log("[Webhook] POST body received:", JSON.stringify(body).substring(0, 1000));
      if (!body || body.object !== "page") return res.status(400).send("Invalid request");

      for (const entry of body.entry) {
        for (const event of entry.messaging) {
          const senderId = event.sender?.id;
          if (!senderId) continue;

          if (event.message && event.message.text) {
            console.log(`[Webhook] Received a message event from PSID: ${senderId} TEXT: ${event.message.text}`);
            const isRegistered = await isPsidRegistered(senderId);
            if (isRegistered) {
              // --- Registered user: handle text commands / queries ---
              console.log(`[Webhook] PSID ${senderId} is registered. Handling text query.`);
              await handleUserTextMessage(senderId, event.message.text);
            } else {
              // Not registered: give them login button
              console.log(`[Webhook] PSID ${senderId} is NOT registered. Sending login button.`);
              await sendLoginButton(senderId);
            }
          } else if (event.message) {
            // Non-text message (attachments, quick replies) -> simple acknowledgement or ignore
            console.log(`[Webhook] Ignoring non-text message event from PSID: ${senderId}`);
            await sendRawMessage(senderId, `Thanks for reaching out! Please send text commands or login to link your account.`);
          } else {
            // other events (delivery, postback, etc.) just log
            console.log(`[Webhook] Ignoring non-message event from PSID: ${senderId}`, event);
          }
        }
      }
      return res.status(200).send("EVENT_RECEIVED");
    } catch (err) {
      console.error("❌ Error handling message:", err);
      return res.status(500).send("Error");
    }
  }

  return res.status(400).send("Invalid request method");
}
