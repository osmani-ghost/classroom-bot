import { sendLoginButton, sendRawMessage } from "../helpers/messengerHelper.js";
import { runCronJobs } from "../helpers/cronHelper.js";
import { isPsidRegistered } from "../helpers/redisHelper.js";
import { searchContent } from "../helpers/searchHelper.js";  // ✅ new helper

export default async function handler(req, res) {
  const VERIFY_TOKEN = process.env.MESSENGER_VERIFY_TOKEN;

  // --- ক্রন জব ট্রিগার ---
  if (req.query.cron === "true") {
    try {
      console.log("[Index Debug] Cron trigger received");
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
      console.log("[Index Debug] Webhook verified successfully");
      return res.status(200).send(challenge);
    }
    return res.status(403).send("Forbidden");
  }

  // --- মেসেঞ্জারের মেসেজ হ্যান্ডেল করা (POST রিকোয়েস্ট) ---
  if (req.method === "POST") {
    try {
      const body = req.body;
      if (!body || body.object !== "page") return res.status(400).send("Invalid request");

      for (const entry of body.entry) {
        for (const event of entry.messaging) {
          const senderId = event.sender?.id;
          if (!senderId) continue;

          if (event.message?.text) {
            const text = event.message.text.trim();
            console.log(`[Webhook] Received text from ${senderId}: ${text}`);

            if (text.startsWith("/find")) {
              const query = text.replace("/find", "").trim();
              const results = await searchContent(senderId, query);
              if (results.length > 0) {
                for (const r of results) {
                  await sendRawMessage(senderId, r);
                }
              } else {
                await sendRawMessage(senderId, "⚠️ No results found for your query.");
              }
            } else {
              const isRegistered = await isPsidRegistered(senderId);
              if (isRegistered) {
                await sendRawMessage(senderId, `Your account is already linked and active.`);
              } else {
                await sendLoginButton(senderId);
              }
            }
          } else {
            console.log(`[Webhook] Ignoring non-message event from PSID: ${senderId}`);
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
