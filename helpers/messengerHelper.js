import fetch from "node-fetch";
import { getUser } from "./redisHelper.js";

async function sendApiRequest(payload) {
    const PAGE_ACCESS_TOKEN = process.env.MESSENGER_PAGE_ACCESS_TOKEN;
    if (!PAGE_ACCESS_TOKEN) return console.error("❌ PAGE_ACCESS_TOKEN is missing.");
    
    const url = `https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`;
    try {
        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
        const result = await response.json();
        if (result.error) console.error("[Messenger] API Error:", result.error);
    } catch (error) {
        console.error("❌ Failed to send message:", error);
    }
}

export async function sendRawMessage(psid, text) {
    const payload = { recipient: { id: psid }, message: { text } };
    await sendApiRequest(payload);
}

export async function sendLoginButton(psid) {
    const domain = process.env.PUBLIC_URL || `https://${process.env.VERCEL_URL}`;
    const loginUrl = `${domain}/api/auth/google?psid=${psid}`;
    const payload = {
        recipient: { id: psid },
        message: {
            attachment: { type: "template", payload: {
                template_type: "button",
                text: "Welcome! Please log in with your university Google account to receive reminders.",
                buttons: [{ type: "web_url", url: loginUrl, title: "Login with Google" }],
            }},
        },
    };
    await sendApiRequest(payload);
}

export async function sendMessageToGoogleUser(googleId, text) {
    const user = await getUser(googleId);
    if (!user || !user.psid) return;
    await sendRawMessage(user.psid, text);
}