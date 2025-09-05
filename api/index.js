import { sendMessage } from "../messengerHelper.js";
import { checkReminders } from "../cronJob.js";

console.log("🔹 Starting handler");
console.log("Env vars:", process.env.REDIS_REST_URL, process.env.REDIS_REST_TOKEN);

export default async function handler(req, res) {
  const VERIFY_TOKEN = process.env.MESSENGER_VERIFY_TOKEN;
  const TEACHER_ID = process.env.TEACHER_ID;
  const STUDENTS = [
    { senderId: "24423234430632948", courses: ["769869403822"] },
  ];

  // Cron job trigger
  if (req.query.cron === "true") {
    console.log("⏰ Cron job triggered");
    try {
      await checkReminders();
      return res.status(200).send("Cron job executed");
    } catch (err) {
      console.error("❌ Cron job failed:", err);
      return res.status(500).send("Cron job error");
    }
  }

  // Webhook verify
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

  // Handle Messenger message (POST)
  if (req.method === "POST") {
    try {
      const body = req.body;
      if (!body || body.object !== "page") return res.status(400).send("Invalid");

      for (const entry of body.entry || []) {
        for (const event of entry.messaging || []) {
          const senderId = event.sender?.id;
          if (!senderId) continue;

          // Teacher post detection
          if (event.message && event.message.text) {
            const isTeacher = senderId === TEACHER_ID;
            if (isTeacher) {
              for (const s of STUDENTS) {
                await sendMessage(
                  s.senderId,
                  `📢 New post in Classroom:\n${event.message.text}`
                );
              }
            } else {
              // Optional: echo student messages
              await sendMessage(senderId, `You said: ${event.message.text}`);
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
