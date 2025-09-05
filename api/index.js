// api/index.js
import { sendMessage } from "../messengerHelper.js";
import { checkReminders } from "../cronJob.js";

const TEACHER_ID = "111434164633233750255";
const STUDENTS = [
  { senderId: "24423234430632948", courses: ["769869403822"] },
];

export default async function handler(req, res) {
  console.log("🔹 Starting handler");
  console.log("Env vars:", process.env.REDIS_REST_URL, process.env.REDIS_REST_TOKEN);

  try {
    // Cron job trigger
    if (req.query.cron === "true") {
      console.log("⏰ Cron job triggered");
      await checkReminders();
      return res.status(200).send("Cron job executed");
    }

    // Webhook verify
    if (req.method === "GET") {
      const mode = req.query["hub.mode"];
      const token = req.query["hub.verify_token"];
      const challenge = req.query["hub.challenge"];

      if (mode === "subscribe" && token === process.env.MESSENGER_VERIFY_TOKEN) {
        console.log("✅ WEBHOOK_VERIFIED");
        return res.status(200).send(challenge);
      } else {
        return res.status(403).send("Forbidden");
      }
    }

    // Handle Messenger message
    if (req.method === "POST") {
      const body = req.body;
      if (!body || body.object !== "page") return res.status(400).send("Invalid");

      for (const entry of body.entry) {
        if (!entry.messaging) continue;
        for (const event of entry.messaging) {
          const senderId = event.sender?.id;
          if (!senderId) continue;

          if (event.message && event.message.text) {
            const msg = event.message.text;
            const isTeacher = senderId === TEACHER_ID;

            if (isTeacher) {
              // Notify all students
              for (const s of STUDENTS) {
                await sendMessage(s.senderId, `📢 New post in Classroom:\n${msg}`);
              }
            } else {
              // Optional: echo student messages
              await sendMessage(senderId, `You said: ${msg}`);
            }
          }
        }
      }

      return res.status(200).send("EVENT_RECEIVED");
    }

    return res.status(400).send("Invalid request method");
  } catch (err) {
    console.error("❌ Handler error:", err);
    return res.status(500).send("Error");
  }
}

export const config = { api: { bodyParser: true } };
