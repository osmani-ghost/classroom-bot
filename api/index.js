import { sendMessage } from "../helpers/messengerHelper.js";
import { checkReminders } from "../cronJob.js";
import { registerPSID } from "../helpers/psidDBHelper.js";

export default async function handler(req, res) {
  const VERIFY_TOKEN = process.env.MESSENGER_VERIFY_TOKEN;

  // Cron job trigger
  if (req.query.cron === "true") {
    try {
      await checkReminders();
      return res.status(200).send("Cron job executed");
    } catch (err) {
      return res.status(500).send("Cron job failed: " + err.message);
    }
  }

  // Webhook verify
  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token === VERIFY_TOKEN) return res.status(200).send(challenge);
    return res.status(403).send("Forbidden");
  }

  // Handle Messenger POST
  if (req.method === "POST") {
    const body = req.body;
    if (!body || body.object !== "page") return res.status(400).send("Invalid");

    for (const entry of body.entry) {
      if (!entry.messaging) continue;
      for (const event of entry.messaging) {
        const senderId = event.sender?.id;
        if (!senderId) continue;

        // If student sends bot, register PSID
        if (event.message && event.message.text) {
          const msg = event.message.text;
          // Example: student sends Classroom ID to register
          const classroomUserId = msg.trim();
          await registerPSID(classroomUserId, senderId);
          await sendMessage(senderId, "✅ You are registered for reminders.");
        }
      }
    }
    return res.status(200).send("EVENT_RECEIVED");
  }

  return res.status(400).send("Invalid request method");
}

export const config = { api: { bodyParser: true } };
