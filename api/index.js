import { sendLoginButton, sendRawMessage, handleIncomingMessage } from "../helpers/messengerHelper.js";
import { runCronJobs } from "../helpers/cronHelper.js";
import { isPsidRegistered } from "../helpers/redisHelper.js";

export default async function handler(req, res) {
  console.log("\n--- /api/index.js: ENTRY ---");
  try {
    const VERIFY_TOKEN = process.env.FACEBOOK_VERIFY_TOKEN;
    // Cron trigger
    if (req.query.cron === "true") {
      console.log("[INDEX] Cron trigger received via query param.");
      try {
        await runCronJobs();
        console.log("[INDEX] Cron jobs executed successfully.");
        return res.status(200).send("Cron jobs executed successfully.");
      } catch (err) {
        console.error("❌ Cron jobs failed:", err);
        return res.status(500).send("Cron jobs error");
      }
    }

    // Facebook webhook verification (GET)
    if (req.method === "GET") {
      console.log("[INDEX] GET webhook verification request");
      const mode = req.query["hub.mode"];
      const token = req.query["hub.verify_token"];
      const challenge = req.query["hub.challenge"];
      if (mode === "subscribe" && token === VERIFY_TOKEN) {
        console.log("[INDEX] Webhook verified successfully.");
        return res.status(200).send(challenge);
      }
      console.warn("[INDEX] Webhook verification failed.");
      return res.status(403).send("Forbidden");
    }

    // Messenger message handling (POST)
    if (req.method === "POST") {
      console.log("[INDEX] POST webhook event received");
      try {
        const body = req.body;
        if (!body || body.object !== "page") {
          console.warn("[INDEX] Invalid webhook body or not a page object.");
          return res.status(400).send("Invalid request");
        }

        for (const entry of body.entry || []) {
          for (const event of entry.messaging || []) {
            const senderId = event.sender?.id;
            if (!senderId) {
              console.log("[INDEX] Skipping event without sender id.");
              continue;
            }

            // Only respond to real message events (ignore echo, delivery, read, postback here)
            if (event.message && !event.message.is_echo) {
              console.log(`[INDEX] Received a message event from PSID: ${senderId}`);
              const isRegistered = await isPsidRegistered(senderId);
              console.log(`[INDEX] isPsidRegistered(${senderId}) => ${isRegistered}`);
              const text = event.message.text || "";

              if (isRegistered) {
                // Route to message handler that implements search/filter & heuristics
                try {
                  await handleIncomingMessage(senderId, text);
                } catch (err) {
                  console.error("[INDEX] Error in handleIncomingMessage:", err);
                  await sendRawMessage(senderId, "Sorry, there was an error processing your request.");
                }
              } else {
                console.log(`[INDEX] PSID ${senderId} not registered -> sending login button`);
                await sendLoginButton(senderId);
              }
            } else {
              console.log(`[INDEX] Ignoring non-message or echo event from PSID: ${senderId}`);
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
  } finally {
    console.log("--- /api/index.js: EXIT ---\n");
  }
}
