// api/index.js

// Messenger webhook handler
export default async function handler(req, res) {
  // 🔹 Step 1: Verify webhook (GET request from Facebook)
  if (req.method === "GET") {
    const VERIFY_TOKEN = process.env.MESSENGER_VERIFY_TOKEN;

    console.log("FB sent token:", req.query["hub.verify_token"]);
    console.log("Our VERIFY_TOKEN from env:", VERIFY_TOKEN);

    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      console.log("✅ WEBHOOK_VERIFIED");
      return res.status(200).send(challenge);
    } else {
      console.error("❌ Webhook verification failed");
      return res.status(403).send("Forbidden");
    }
  }

  // 🔹 Step 2: Handle messages (POST request from Facebook)
  if (req.method === "POST") {
    try {
      const body = req.body;

      console.log("📩 Messenger event received:");
      console.log(JSON.stringify(body, null, 2));

      if (body.object === "page") {
        body.entry.forEach(async (entry) => {
          const event = entry.messaging[0];
          const senderId = event.sender.id;

          if (event.message && event.message.text) {
            const userMessage = event.message.text;
            console.log(`👤 User (${senderId}) said: ${userMessage}`);

            // Simple reply
            await sendMessage(senderId, `You said: ${userMessage}`);
          }
        });
      }

      return res.status(200).send("EVENT_RECEIVED");
    } catch (err) {
      console.error("❌ Error handling message:", err);
      return res.status(500).send("Error");
    }
  }

  // Invalid method
  return res.status(400).send("Invalid request method.");
}

// 🔹 Helper function: Send message back to Messenger
async function sendMessage(senderId, text) {
  const PAGE_ACCESS_TOKEN = process.env.MESSENGER_PAGE_TOKEN;

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

// 🔹 Disable bodyParser for raw request body (Messenger requirement)
export const config = {
  api: {
    bodyParser: false,
  },
};
