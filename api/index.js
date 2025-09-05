// api/index.js
import { sendMessage } from "../../messengerHelper.js";
import { checkReminders } from "../../cronJob.js";

export default async function handler(req, res) {
  const VERIFY_TOKEN = process.env.MESSENGER_VERIFY_TOKEN;

  // 🔹 Cron job trigger
  if (req.query.cron === "true") {
    console.log("⏰ Cron job triggered");
    await checkReminders();
    return res.status(200).send("Cron job executed");
  }

  // 🔹 Webhook verification
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

  // 🔹 Handle Messenger messages
  if (req.method === "POST") {
    try {
      const body = req.body;
      if (!body || body.object !== "page")
        return res.status(400).send("Invalid request");

      for (const entry of body.entry) {
        if (!entry.messaging) continue;

        for (const event of entry.messaging) {
          const senderId = event.sender?.id;
          if (!senderId) continue;

          if (event.message && event.message.text) {
            const msg = event.message.text;

            // 🔹 Teacher check
            const isTeacher = senderId === "111434164633233750255";
            if (isTeacher) {
              const STUDENTS = [
                { senderId: "24423234430632948", courses: ["769869403822"] },
              ];
              for (const s of STUDENTS) {
                await sendMessage(
                  s.senderId,
                  `📢 New post in Classroom:\n${msg}`
                );
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

export const config = { api: { bodyParser: true } };
