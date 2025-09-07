import fetch from "node-fetch";
import { getUser } from "./redisHelper.js";

// ==========================
// Generic Messenger API Request
// ==========================
async function sendApiRequest(payload) {
  const PAGE_ACCESS_TOKEN = process.env.MESSENGER_PAGE_ACCESS_TOKEN;
  if (!PAGE_ACCESS_TOKEN) {
    console.error("❌ PAGE_ACCESS_TOKEN missing in environment variables.");
    return;
  }

  const url = `https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`;
  try {
    console.log(`[Messenger] Sending API request to PSID: ${payload.recipient.id}`);
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

// ==========================
// Send simple text message
// ==========================
export async function sendRawMessage(psid, text) {
  if (!psid) return console.warn("[Messenger] PSID is missing for sendRawMessage.");
  const payload = { recipient: { id: psid }, message: { text } };
  await sendApiRequest(payload);
}

// ==========================
// Send "Login with Google" button
// ==========================
export async function sendLoginButton(psid) {
  if (!psid) return console.warn("[Messenger] PSID is missing for sendLoginButton.");
  const domain = process.env.PUBLIC_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
  if (!domain) return console.error("❌ Cannot determine domain for Google login URL.");

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

// ==========================
// Send message using Google ID
// ==========================
export async function sendMessageToGoogleUser(googleId, text) {
  if (!googleId) return console.warn("[Messenger] Google ID is missing for sendMessageToGoogleUser.");
  const user = await getUser(googleId);
  if (!user || !user.psid) {
    console.error(`⚠️ No PSID mapped for Google ID: ${googleId}.`);
    return;
  }
  await sendRawMessage(user.psid, text);
}
