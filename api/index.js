// api/index.js

// 🔹 Helper function: Send message back to Messenger
async function sendMessage(senderId, text) {
  const PAGE_ACCESS_TOKEN = process.env.MESSENGER_PAGE_ACCESS_TOKEN; // match your Vercel env

  if (!PAGE_ACCESS_TOKEN) {
    console.error("❌ PAGE_ACCESS_TOKEN is missing in env variables");
    return;
  }

  const url = `https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`;

  const body = {
    recipient: { id: senderId },
    message: { text: text },
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const result = await response.json();
    console.log("✅ Message sent:", result);
  } catch (error) {
    console.error("❌ Failed to send message:", error);
  }
}

export default async function handler(req, res) {
  const VERIFY_TOKEN = process.env.MESSENGER_VERIFY_TOKEN;

  // 🔹 Step 0: Cron job check
  if (req.query.cron === "true") {
    console.log("⏰ Cron job triggered");
    // Cron job logic run করতে পারেন এখানে
    return res.status(200).send("Cron job executed");
  }

  // 🔹 Step 1: Verify webhook (GET request from Facebook)
  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    console.log("FB sent token:", token);
    console.log("Our VERIFY_TOKEN from env:", VERIFY_TOKEN);

    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      console.log("✅ WEBHOOK_VERIFIED");
      return res.status(200).send(challenge);
    } else {
      console.error("❌ Webhook verification failed");
      return res.status(403).send("Forbidden");
    }
  }

  // 🔹 Step 2: Handle Messenger messages (POST)
  if (req.method === "POST") {
    try {
      const body = req.body;
      if (!body || body.object !== "page")
        return res.status(400).send("Invalid request");

      body.entry.forEach(async (entry) => {
        if (!entry.messaging) return;

        entry.messaging.forEach(async (event) => {
          const senderId = event.sender?.id;
          if (!senderId) return;

          if (event.message && event.message.text) {
            const userMessage = event.message.text;
            console.log(`👤 User (${senderId}) said: ${userMessage}`);
            await sendMessage(senderId, `You said: ${userMessage}`);
          } else {
            console.log(
              "ℹ️ Non-message event received, skipping:",
              JSON.stringify(event)
            );
          }
        });
      });

      return res.status(200).send("EVENT_RECEIVED");
    } catch (err) {
      console.error("❌ Error handling message:", err);
      return res.status(500).send("Error");
    }
  }

  return res.status(400).send("Invalid request method.");
}

// 🔹 Default bodyParser enabled (Next.js handles JSON automatically)
export const config = {
  api: {
    bodyParser: true,
  },
};
