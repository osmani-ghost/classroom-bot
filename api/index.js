import { sendRawMessage } from "../helpers/messengerHelper.js";
import { runCronJobs } from "../helpers/cronHelper.js";
import { mapGoogleIdToPsid, isPsidMapped } from "../helpers/redisHelper.js";

export default async function handler(req, res) {
  const VERIFY_TOKEN = process.env.MESSENGER_VERIFY_TOKEN;

  // Cron job ট্রিগার
  if (req.query.cron === "true") {
    try {
      await runCronJobs();
      return res.status(200).send("Cron jobs executed successfully.");
    } catch (err) {
      console.error("❌ Cron jobs failed:", err);
      return res.status(500).send("Cron jobs error");
    }
  }

  // Webhook ভেরিফিকেশন
  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      console.log("✅ WEBHOOK_VERIFIED");
      return res.status(200).send(challenge);
    }
    return res.status(403).send("Forbidden");
  }

  // মেসেঞ্জারের মেসেজ হ্যান্ডেল করা
  if (req.method === "POST") {
    try {
      const body = req.body;
      if (!body || body.object !== "page") return res.status(400).send("Invalid request");

      for (const entry of body.entry) {
        for (const event of entry.messaging) {
          const senderId = event.sender?.id;
          if (!senderId) continue;

          if (event.message && event.message.text) {
            const msg = event.message.text.trim();

            if (msg.toLowerCase().startsWith("link:")) {
              const googleId = msg.split(":")[1]?.trim();
              if (googleId) {
                await mapGoogleIdToPsid(googleId, senderId);
                await sendRawMessage(senderId, `✅ Success! Your account is now linked.`);
              } else {
                await sendRawMessage(senderId, `⚠️ Please provide your Google ID. Example: link:123456789`);
              }
            } else {
              const isLinked = await isPsidMapped(senderId);
              if (isLinked) {
                await sendRawMessage(senderId, `Your account is already linked. You will receive notifications automatically.`);
              } else {
                await sendRawMessage(senderId, `Hi! To link your account for reminders, please type "link:" followed by your Google Classroom ID.`);
              }
            }
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