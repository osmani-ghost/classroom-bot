import fetch from "node-fetch";
import { getPsidForGoogleId } from "./redisHelper.js";

// এই ফাংশনটি সরাসরি মেসেঞ্জার PSID দিয়ে মেসেজ পাঠায়
export async function sendRawMessage(psid, text) {
  const PAGE_ACCESS_TOKEN = process.env.MESSENGER_PAGE_ACCESS_TOKEN;
  if (!PAGE_ACCESS_TOKEN) {
    console.error("❌ PAGE_ACCESS_TOKEN is missing.");
    return;
  }

  const url = `https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`;
  const body = { recipient: { id: psid }, message: { text } };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await response.json();
    console.log("✅ Message sent API Response:", result);
  } catch (error) {
    console.error("❌ Failed to send message:", error);
  }
}

// এই ফাংশনটি গুগল আইডি ব্যবহার করে মেসেজ পাঠায়
export async function sendMessageToGoogleUser(googleId, text) {
  const psidData = await getPsidForGoogleId(googleId);
  const psid = psidData ? psidData.psid : null;

  if (!psid) {
    console.error(`⚠️ No Messenger PSID mapped for Google ID: ${googleId}. Skipping message.`);
    return;
  }

  await sendRawMessage(psid, text);
}