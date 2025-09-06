import { sendRawMessage } from "../helpers/messengerHelper.js";
import { checkReminders } from "../helpers/cronHelper.js";
import { mapGoogleIdToPsid } from "../helpers/redisHelper.js";

export default async function handler(req, res) {
  const VERIFY_TOKEN = process.env.MESSENGER_VERIFY_TOKEN;

  // Cron job ট্রিগার
  if (req.query.cron === "true") {
    try {
      await checkReminders();
      return res.status(200).send("Cron job executed successfully.");
    } catch (err) {
      console.error("❌ Cron job failed:", err);
      return res.status(500).send("Cron job error");
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
      if (!body || body.object !== "page")
        return res.status(400).send("Invalid request");

      for (const entry of body.entry) {
        for (const event of entry.messaging) {
          const senderId = event.sender?.id; // এটা মেসেঞ্জার PSID
          if (!senderId) continue;

          if (event.message && event.message.text) {
            const msg = event.message.text.trim();

            // ছাত্রছাত্রীর রেজিস্ট্রেশন কমান্ড চেক করা
            if (msg.toLowerCase().startsWith("link:")) {
              const googleId = msg.split(":")[1]?.trim();
              if (googleId) {
                await mapGoogleIdToPsid(googleId, senderId);
                await sendRawMessage(
                  senderId,
                  `✅ Success! Your account is now linked. You will receive assignment reminders here.`
                );
              } else {
                await sendRawMessage(
                  senderId,
                  `⚠️ Please provide your Google ID after "link:". Example: link:123456789`
                );
              }
            } else {
              // সাধারণ মেসেজের উত্তর
              await sendRawMessage(
                senderId,
                `Hi! To link your account for reminders, please type "link:" followed by your Google Classroom ID.`
              );
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
