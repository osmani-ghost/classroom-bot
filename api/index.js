import fetch from "node-fetch";

const PAGE_ACCESS_TOKEN = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.FACEBOOK_VERIFY_TOKEN;

export default async function handler(req, res) {
  if (req.method === "GET") {
    // Facebook webhook verification
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      console.log("✅ Webhook verified");
      return res.status(200).send(challenge);
    } else {
      console.warn("❌ Webhook verification failed");
      return res.status(403).send("Forbidden");
    }
  }

  if (req.method === "POST") {
    const body = req.body;

    if (!body || body.object !== "page") {
      return res.status(400).send("Invalid request");
    }

    for (const entry of body.entry || []) {
      for (const event of entry.messaging || []) {
        const senderId = event.sender?.id;
        if (!senderId) continue;

        if (event.message && !event.message.is_echo) {
          console.log("Message received from:", senderId);
          await sendTextMessage(senderId, "Hi! This is your bot.");
        }
      }
    }

    return res.status(200).send("EVENT_RECEIVED");
  }

  return res.status(400).send("Invalid request method");
}

// Function to send text message to Messenger
async function sendTextMessage(psid, text) {
  if (!PAGE_ACCESS_TOKEN) {
    console.error("❌ PAGE_ACCESS_TOKEN is missing in environment variables.");
    return;
  }

  const payload = {
    recipient: { id: psid },
    message: { text },
  };

  const url = `https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    console.log("Messenger API result:", result);
    return result;
  } catch (err) {
    console.error("❌ Failed to send message:", err);
  }
}
