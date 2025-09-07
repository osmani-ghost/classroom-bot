import fetch from "node-fetch";
import { getUser } from "./redisHelper.js";

// এই ফাংশনটি ফেসবুক এপিআই-তে রিকোয়েস্ট পাঠায়
async function sendApiRequest(payload) {
  const PAGE_ACCESS_TOKEN = process.env.MESSENGER_PAGE_ACCESS_TOKEN;
  if (!PAGE_ACCESS_TOKEN) {
    console.error("❌ PAGE_ACCESS_TOKEN is missing in environment variables.");
    return;
  }

  const url = `https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`;
  try {
    console.log(
      `[Messenger] Sending API request to PSID: ${payload.recipient.id}`
    );
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    if (result.error) {
      console.error("[Messenger] API Error:", result.error);
    } else {
      console.log("[Messenger] API Response:", result);
    }
  } catch (error) {
    console.error("❌ Failed to send message:", error);
  }
}

// এই ফাংশনটি সরাসরি মেসেঞ্জার PSID ব্যবহার করে টেক্সট মেসেজ পাঠায়
export async function sendRawMessage(psid, text) {
  const payload = { recipient: { id: psid }, message: { text } };
  await sendApiRequest(payload);
}

// এই ফাংশনটি "Login with Google" বাটন পাঠায়
export async function sendLoginButton(psid) {
  // --- এটাই মূল সমাধান ---
  // লোকাল টেস্টিংয়ের জন্য PUBLIC_URL (ngrok) ব্যবহার করবে
  // Vercel-এ ডিপ্লয় করার পর স্বয়ংক্রিয়ভাবে Vercel-এর নিজের URL ব্যবহার করবে
  const domain = process.env.PUBLIC_URL || `https://${process.env.VERCEL_URL}`;
  const loginUrl = `${domain}/api/auth/google?psid=${psid}`;

  const payload = {
    recipient: { id: psid },
    message: {
      attachment: {
        type: "template",
        payload: {
          template_type: "button",
          text: "Welcome! Please log in with your university Google account to receive reminders.",
          buttons: [
            { type: "web_url", url: loginUrl, title: "Login with Google" },
          ],
        },
      },
    },
  };
  await sendApiRequest(payload);
}

// এই ফাংশনটি গুগল আইডি ব্যবহার করে মেসেজ পাঠায়
export async function sendMessageToGoogleUser(googleId, text) {
  const user = await getUser(googleId);
  if (!user || !user.psid) {
    console.error(`⚠️ No PSID mapped for Google ID: ${googleId}.`);
    return;
  }
  await sendRawMessage(user.psid, text);
}