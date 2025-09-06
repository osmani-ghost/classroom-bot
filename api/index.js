import { sendRawMessage } from "../helpers/messengerHelper.js";
import { runCronJobs } from "../helpers/cronHelper.js";
import { mapGoogleIdToPsid, isPsidMapped } from "../helpers/redisHelper.js";

export default async function handler(req, res) {
  // ফেসবুক ওয়েবহুক ভেরিফাই করার জন্য টোকেন
  const VERIFY_TOKEN = process.env.MESSENGER_VERIFY_TOKEN;

  // --- ক্রন জব ট্রিগার ---
  // URL-এ "?cron=true" থাকলে এই অংশটি কাজ করবে
  if (req.query.cron === "true") {
    try {
      console.log("⏰ Cron job triggered...");
      await runCronJobs(); // রিমাইন্ডার এবং নতুন পোস্ট চেক করার ফাংশন চলবে
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
      console.log("✅ WEBHOOK_VERIFIED");
      return res.status(200).send(challenge);
    } else {
      return res.status(403).send("Forbidden");
    }
  }

  // --- মেসেঞ্জারের মেসেজ হ্যান্ডেল করা (POST রিকোয়েস্ট) ---
  if (req.method === "POST") {
    try {
      const body = req.body;
      if (!body || body.object !== "page") {
        return res.status(400).send("Invalid request");
      }

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
                // গুগল আইডি এবং মেসেঞ্জার PSID লিঙ্ক করা হচ্ছে
                await mapGoogleIdToPsid(googleId, senderId);
                await sendRawMessage(senderId, `✅ Success! Your account is now linked. You will receive assignment reminders here.`);
              } else {
                await sendRawMessage(senderId, `⚠️ Please provide your Google ID after "link:". Example: link:123456789`);
              }
            } else {
              // সাধারণ মেসেজের উত্তর
              // চেক করা হচ্ছে ইউজার আগে থেকেই লিঙ্ক করা কি না
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

  // অন্য কোনো মেথড হলে
  return res.status(400).send("Invalid request method");
}