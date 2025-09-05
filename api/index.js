import { sendMessage } from "../messengerHelper.js";
import { checkReminders } from "../cronJob.js";

export default async function handler(req, res) {
  const VERIFY_TOKEN = process.env.MESSENGER_VERIFY_TOKEN;

  console.log("🔹 Starting handler");

  // Cron job trigger
  if (req.query.cron === "true") {
    console.log("⏰ Cron job triggered");
    try {
      await checkReminders();
      console.log("✅ Cron job executed successfully");
      return res.status(200).send("Cron job executed");
    } catch (err) {
      console.error("❌ Cron job failed:", err);
      return res.status(500).send("Cron job failed: " + err.message);
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

  // Handle Messenger message
  if (req.method === "POST") {
    try {
      const body = req.body;
      if (!body || body.object !== "page")
        return res.status(400).send("Invalid");

      for (const entry of body.entry) {
        if (!entry.messaging) continue;
        for (const event of entry.messaging) {
          const senderId = event.sender?.id;
          if (!senderId) continue;

          // Teacher posts / assignments
          if (event.message && event.message.text) {
            const msg = event.message.text;

            // Notify all students in all courses
            // You can fetch from classroomHelper.fetchStudents if you want dynamic roster
            // Example below assumes a test student array
            const STUDENTS = ["24423234430632948"];
            for (const s of STUDENTS) {
              await sendMessage(s, `📢 New post in Classroom:\n${msg}`);
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
