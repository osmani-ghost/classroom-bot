import { sendMessage } from "../messengerHelper.js";
import { checkReminders } from "../cronJob.js";
import { registerStudent, getAllStudents } from "../studentDB.js";

export default async function handler(req, res) {
  const VERIFY_TOKEN = process.env.MESSENGER_VERIFY_TOKEN;

  console.log("🔹 Starting handler");

  if (req.query.cron === "true") {
    console.log("⏰ Cron job triggered");
    try {
      await checkReminders();
      return res.status(200).send("Cron job executed");
    } catch (err) {
      console.error("❌ Cron job failed:", err);
      return res.status(500).send("Cron job failed: " + err.message);
    }
  }

  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    if (mode === "subscribe" && token === VERIFY_TOKEN) return res.status(200).send(challenge);
    return res.status(403).send("Forbidden");
  }

  if (req.method === "POST") {
    try {
      const body = req.body;
      if (!body || body.object !== "page") return res.status(400).send("Invalid");

      for (const entry of body.entry) {
        if (!entry.messaging) continue;
        for (const event of entry.messaging) {
          const senderId = event.sender?.id;
          if (!senderId) continue;

          await registerStudent(senderId);

          if (event.message && event.message.text) {
            const msg = event.message.text;
            const students = await getAllStudents();
            for (const s of students) await sendMessage(s, `📢 New post in Classroom:\n${msg}`);
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
