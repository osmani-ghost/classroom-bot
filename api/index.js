import { sendMessage } from "../messengerHelper.js";
import { checkReminders } from "../../cronJob.js";

export default async function handler(req, res) {
  const VERIFY_TOKEN = process.env.MESSENGER_VERIFY_TOKEN;

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

    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      console.log("✅ WEBHOOK_VERIFIED");
      return res.status(200).send(challenge);
    } else {
      return res.status(403).send("Forbidden");
    }
  }

  // Handle Messenger message
  if (req.method === "POST") {
    try {
      const body = req.body;
      if (!body || body.object !== "page")
        return res.status(400).send("Invalid");

      body.entry.forEach(async (entry) => {
        if (!entry.messaging) return;
        entry.messaging.forEach(async (event) => {
          const senderId = event.sender?.id;
          if (!senderId) return;

          if (event.message && event.message.text) {
            const msg = event.message.text;

            // Example: teacher check (replace with your teacherId check)
            const isTeacher = senderId === "111434164633233750255";
            if (isTeacher) {
              // Notify all students in that course
              const STUDENTS = [
                { senderId: "24423234430632948", courses: ["769869403822"] },
              ];
              for (const s of STUDENTS) {
                await sendMessage(
                  s.senderId,
                  `📢 New post in Classroom:\n${msg}`
                );
              }
            } else {
              // Optional: echo student messages
              await sendMessage(senderId, `You said: ${msg}`);
            }
          }
        });
      });

      return res.status(200).send("EVENT_RECEIVED");
    } catch (err) {
      console.error("❌ Error handling message:", err);
      return res.status(500).send("Error");
    }
  }

  return res.status(400).send("Invalid request method");
}

export const config = { api: { bodyParser: true } };
