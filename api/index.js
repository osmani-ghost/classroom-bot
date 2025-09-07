import { sendLoginButton, sendRawMessage } from "../helpers/messengerHelper.js";
import { runCronJobs } from "../helpers/cronHelper.js";
import { isPsidRegistered, searchContentForUser, getUserFromPsid } from "../helpers/redisHelper.js";

export default async function handler(req, res) {
  const VERIFY_TOKEN = process.env.MESSENGER_VERIFY_TOKEN;

  if (req.query.cron === "true") {
    try {
      await runCronJobs();
      return res.status(200).send("Cron jobs executed successfully.");
    } catch (err) {
      console.error("❌ Cron jobs failed:", err);
      return res.status(500).send("Cron jobs error");
    }
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
    try {
      const body = req.body;
      if (!body || body.object !== "page") return res.status(400).send("Invalid request");

      for (const entry of body.entry) {
        for (const event of entry.messaging) {
          const senderId = event.sender?.id;
          if (!senderId) continue;
          
          if (event.message) {
            const isRegistered = await isPsidRegistered(senderId);
            if (isRegistered) {
                const msg = event.message?.text?.trim();
                if (msg && msg.toLowerCase().startsWith("/find ")) {
                    const searchTerm = msg.substring(6).toLowerCase();
                    if (!searchTerm) {
                        await sendRawMessage(senderId, `Please provide a keyword to search. Example: /find lab`);
                        continue;
                    }
                    
                    const user = await getUserFromPsid(senderId);
                    if (!user) continue;
                    const results = await searchContentForUser(user.googleId, searchTerm);

                    if (results.length > 0) {
                        let reply = `Found ${results.length} results for "${searchTerm}":\n\n`;
                        results.slice(0, 5).forEach(item => {
                            reply += `-[${item.type}] ${item.title}\nLink: ${item.link || 'N/A'}\n\n`;
                        });
                        await sendRawMessage(senderId, reply);
                    } else {
                        await sendRawMessage(senderId, `Sorry, no results found for "${searchTerm}".`);
                    }
                } else {
                    await sendRawMessage(senderId, `Your account is linked. Use /find <keyword> to search.`);
                }
            } else {
              await sendLoginButton(senderId);
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
}