export default async function handler(req, res) {
  const VERIFY_TOKEN = process.env.MESSENGER_VERIFY_TOKEN;

  // 🔹 Step 0: Cron job check
  if (req.query.cron === "true") {
    console.log("⏰ Cron job triggered");
    // এখানে cron job logic/run করা হবে
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
