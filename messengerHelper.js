import fetch from "node-fetch";

export async function sendMessage(senderId, text) {
  const PAGE_ACCESS_TOKEN = process.env.MESSENGER_PAGE_ACCESS_TOKEN;
  if (!PAGE_ACCESS_TOKEN) return console.error("PAGE_ACCESS_TOKEN missing");

  const url = `https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`;
  const body = { recipient: { id: senderId }, message: { text } };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await res.json();
    console.log("✅ Message sent:", result);
  } catch (err) {
    console.error("❌ Failed to send message:", err);
  }
}
