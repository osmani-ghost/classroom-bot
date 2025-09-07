import { sendLoginButton, sendRawMessage } from "../helpers/messengerHelper.js";
import { runCronJobs } from "../helpers/cronHelper.js";
import { isPsidRegistered } from "../helpers/redisHelper.js";

export default async function handler(req, res) {
  const VERIFY_TOKEN = process.env.MESSENGER_VERIFY_TOKEN;

  // --- ক্রন জব ট্রিগার ---  
  if (req.query.cron === "true") {
    try {
      console.log("[Cron Trigger] Running cron jobs...");
      await runCronJobs();
      console.log("[Cron Trigger] Cron jobs executed successfully.");
      return res.status(200).send("Cron jobs executed successfully.");
    } catch (err) {
      console.error("❌ Cron jobs failed:", err);
      return res.status(500).send("Cron jobs error");
    }
  }

  // --- ফেসবুক ওয়েবহুক ভেরিফিকেশন (GET) ---  
  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      console.log("[Webhook] Verification successful");
      return res.status(200).send(challenge);
    }
    console.warn("[Webhook] Verification failed");
    return res.status(403).send("Forbidden");
  }

  // --- মেসেঞ্জারের মেসেজ হ্যান্ডেল করা (POST) ---  
  if (req.method === "POST") {
    try {
      const body = req.body;
      if (!body || body.object !== "page") {
        console.warn("[Webhook] Invalid POST request body");
        return res.status(400).send("Invalid request");
      }

      for (const entry of body.entry || []) {
        for (const event of entry.messaging || []) {
          const senderId = event.sender?.id;
          if (!senderId) continue;

          // --- শুধুমাত্র আসল মেসেজের উত্তর দেওয়া হবে ---
          if (event.message) {
            console.log(`[Webhook] Message received from PSID: ${senderId}`);

            try {
              const isRegistered = await isPsidRegistered(senderId);
              if (isRegistered) {
                await sendRawMessage(senderId, `Your account is already linked and active.`);
              } else {
                await sendLoginButton(senderId);
              }
            } catch (innerErr) {
              console.error(`[Webhook] Error handling sender ${senderId}:`, innerErr);
            }
          } else {
            console.log(`[Webhook] Ignoring non-message event from PSID: ${senderId}`);
          }
        }
      }

      return res.status(200).send("EVENT_RECEIVED");
    } catch (err) {
      console.error("❌ Error handling webhook POST:", err);
      return res.status(500).send("Error");
    }
  }

  // --- অন্য সব মেথড ---
  return res.status(400).send("Invalid request method");
}
