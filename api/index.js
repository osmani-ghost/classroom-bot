import { sendLoginButton, sendRawMessage } from "../../helpers/messengerHelper.js";
import { runCronJobs } from "../../helpers/cronHelper.js";
import { isPsidRegistered } from "../../helpers/redisHelper.js";
import { searchContent } from "../../helpers/searchHelper.js";

export default async function handler(req, res) {
  const VERIFY_TOKEN = process.env.MESSENGER_VERIFY_TOKEN;

  if (req.query.cron === "true") {
    await runCronJobs();
    return res.status(200).send("Cron jobs executed.");
  }

  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).send("Forbidden");
  }

  if (req.method === "POST") {
    const body = req.body;
    if (!body || body.object !== "page") return res.status(400).send("Invalid request");

    for (const entry of body.entry) {
      for (const event of entry.messaging) {
        const senderId = event.sender?.id;
        if (!senderId) continue;

        if (event.message?.text) {
          const text = event.message.text.trim();
          console.log(`[Webhook] Message from ${senderId}: ${text}`);

          const isRegistered = await isPsidRegistered(senderId);
          if (!isRegistered) {
            await sendLoginButton(senderId);
            continue;
          }

          if (text.startsWith("/find")) {
            const query = text.replace("/find", "").trim();
            if (!query) {
              await sendRawMessage(senderId, "❌ Please provide search keywords, e.g. `/find physics`");
              continue;
            }

            const results = await searchContent(query);
            if (results.length === 0) {
              await sendRawMessage(senderId, "😥 No results found.");
            } else {
              for (const item of results) {
                if (item.type === "assignment") {
                  const due = item.dueDate ? `${item.dueDate.day}-${item.dueDate.month}-${item.dueDate.year}` : "No due date";
                  const message = `📌 Assignment Reminder\nCourse: ${item.courseName}\nTitle: ${item.title}\nDue: ${due}\nLink: ${item.link}`;
                  await sendRawMessage(senderId, message);
                } else {
                  const message = `📌 ${item.type === "material" ? "Material" : "Announcement"}\nCourse: ${item.courseName}\nTitle: ${item.title}\nLink: ${item.link}`;
                  await sendRawMessage(senderId, message);
                }
              }
            }
          } else {
            await sendRawMessage(senderId, `Your account is already linked and active.`);
          }
        }
      }
    }
    return res.status(200).send("EVENT_RECEIVED");
  }

  return res.status(400).send("Invalid request");
}
