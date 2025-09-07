import fetch from "node-fetch";
import { getUserByPsid, getUser, searchIndexedItems } from "./redisHelper.js";

// --- send to Facebook Messenger API with debug logs ---
async function sendApiRequest(payload) {
  const PAGE_ACCESS_TOKEN = process.env.MESSENGER_PAGE_ACCESS_TOKEN;
  if (!PAGE_ACCESS_TOKEN) {
    console.error("❌ PAGE_ACCESS_TOKEN missing in environment variables.");
    return;
  }

  const url = `https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`;
  try {
    console.log(`[Messenger] API request payload: ${JSON.stringify(payload, null, 2)}`);
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    if (result.error) console.error("[Messenger] API Error:", result.error);
    else console.log("[Messenger] API Response:", JSON.stringify(result, null, 2));
  } catch (error) {
    console.error("❌ Failed to send message:", error);
  }
}

// Send plain text
export async function sendRawMessage(psid, text) {
  console.log(`[Messenger] sendRawMessage to ${psid}: ${text}`);
  const payload = { recipient: { id: psid }, message: { text } };
  await sendApiRequest(payload);
}

// Send login button
export async function sendLoginButton(psid) {
  const domain = process.env.PUBLIC_URL || `https://${process.env.VERCEL_URL}`;
  const loginUrl = `${domain}/api/auth/google?psid=${psid}`;

  console.log(`[Messenger] Sending Login button to PSID ${psid} -> ${loginUrl}`);
  const payload = {
    recipient: { id: psid },
    message: {
      attachment: {
        type: "template",
        payload: {
          template_type: "button",
          text: "Welcome! Please log in with your Google account to receive reminders and search your Classroom.",
          buttons: [{ type: "web_url", url: loginUrl, title: "Login with Google" }],
        },
      },
    },
  };
  await sendApiRequest(payload);
}

// Send message by googleId
export async function sendMessageToGoogleUser(googleId, text) {
  console.log(`[Messenger] sendMessageToGoogleUser for googleId ${googleId}: ${text}`);
  const user = await getUser(googleId);
  if (!user || !user.psid) {
    console.error(`⚠️ No PSID mapped for Google ID: ${googleId}. Cannot send message.`);
    return;
  }
  await sendRawMessage(user.psid, text);
}

// Format a single item for Messenger UI
export function formatItemMessage(item) {
  const typeTitle = item.type ? `${capitalize(item.type)}` : "Item";
  const course = item.courseName || item.courseId || "Unknown course";
  const title = item.title || "No title";
  const dueText = item.dueDate ? formatDueShort(item.dueDate, item.dueTime) : null;
  const link = item.link || "Link not available";

  let body = `📘 ${course}\nTitle: ${title}\nType: ${typeTitle}`;
  if (dueText) body += `\nDeadline: ${dueText}`;
  body += `\nLink: ${link}`;
  return body;
}

function capitalize(s) {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatDueShort(dueDate, dueTime) {
  try {
    if (!dueDate) return "End of day";
    const utcDate = new Date(
      Date.UTC(
        dueDate.year,
        dueDate.month - 1,
        dueDate.day,
        dueTime?.hours || 23,
        dueTime?.minutes || 0
      )
    );
    utcDate.setHours(utcDate.getHours() + 6); // BDT
    const day = utcDate.getDate().toString().padStart(2, "0");
    const month = (utcDate.getMonth() + 1).toString().padStart(2, "0");
    const year = utcDate.getFullYear();
    let hours = utcDate.getHours();
    const minutes = utcDate.getMinutes().toString().padStart(2, "0");
    const ampm = hours >= 12 ? "PM" : "AM";
    hours = hours % 12 || 12;
    return `${day}-${month}-${year}, ${hours}:${minutes} ${ampm}`;
  } catch (e) {
    console.error("[formatDueShort] Error formatting dueDate:", dueDate, e);
    return "Unknown";
  }
}

// -------------------- USER MESSAGE HANDLER -----------------
export async function handleUserTextMessage(psid, text) {
  console.log(`[Messenger] Received user message from ${psid}: "${text}"`);

  const user = await getUserByPsid(psid);
  if (!user) {
    console.log("[Messenger] No user found for PSID, sending login button...");
    await sendLoginButton(psid);
    return;
  }
  const googleId = user.googleId;

  let filters = {};
  const lower = text.toLowerCase();
  console.log(`[Messenger] Lowercased text: "${lower}"`);

  // Command shortcut
  if (text.startsWith("/")) {
    const parts = text.slice(1).split(/\s+/);
    const command = parts[0].toLowerCase();
    const arg = parts.slice(1).join(" ");
    console.log(`[Messenger] Parsed command: ${command}, arg: ${arg}`);

    if (command === "assignments") filters.type = "assignment";
    if (command === "materials") filters.type = "material";
    if (command === "announcements") filters.type = "announcement";

    if (arg) {
      const dateRange = parseDateKeyword(arg);
      if (dateRange) {
        console.log(`[Messenger] Detected dateRange from command arg:`, dateRange);
        filters.dateRange = dateRange;
      } else {
        filters.course = arg;
        console.log(`[Messenger] Using course filter from command arg: ${arg}`);
      }
    }
  } else {
    console.log("[Messenger] Processing natural language message...");

    if (lower.includes("assignment") || lower.includes("due")) filters.type = "assignment";
    if (lower.includes("material") || lower.includes("notes") || lower.includes("slide")) filters.type = "material";
    if (lower.includes("announcement") || lower.includes("notice")) filters.type = "announcement";

    const knownCourses = ["share codes","test bot"];
    for (const k of knownCourses) {
      if (lower.includes(k)) {
        filters.course = k;
        console.log(`[Messenger] Detected course from known courses: ${k}`);
        break;
      }
    }

    const dateRange = parseDateKeyword(text);
    if (dateRange) {
      console.log(`[Messenger] Detected dateRange from natural language:`, dateRange);
      filters.dateRange = dateRange;
    }

    const keywords = extractKeywords(text);
    if (keywords.length > 0) {
      console.log(`[Messenger] Extracted keywords: ${keywords}`);
      filters.keywords = keywords;
    }
  }

  console.log(`[Messenger] Final filters to use in searchIndexedItems:`, filters);

  const results = await searchIndexedItems(googleId, filters, true);
  console.log(`[Messenger] Found ${results?.length || 0} results for googleId ${googleId}`);

  if (!results || results.length === 0) {
    await sendRawMessage(psid, `🔍 No results found. Try different keywords or use /assignments today`);
    return;
  }

  const maxToSend = 8;
  const toSend = results.slice(0, maxToSend);
  const messages = toSend.map(i => formatItemMessage(i));
  console.log(`[Messenger] Sending ${toSend.length} formatted items to user`);
  await sendRawMessage(psid, messages.join("\n\n—\n\n"));

  if (results.length > maxToSend) {
    await sendRawMessage(psid, `📎 ${results.length} results found. Showing top ${maxToSend}. Refine your query.`);
  }
}

// parse date keywords and return {from: ISO, to: ISO}
function parseDateKeyword(text) {
  const lower = text.toLowerCase();
  const now = new Date();
  const startOfDay = date => new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0);
  const endOfDay = date => new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59);

  if (lower.includes("today")) {
    const r = { from: startOfDay(now).toISOString(), to: endOfDay(now).toISOString() };
    console.log("[parseDateKeyword] Detected 'today':", r);
    return r;
  }
  if (lower.includes("tomorrow")) {
    const t = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const r = { from: startOfDay(t).toISOString(), to: endOfDay(t).toISOString() };
    console.log("[parseDateKeyword] Detected 'tomorrow':", r);
    return r;
  }

  console.log("[parseDateKeyword] No date keyword detected");
  return null;
}

function extractKeywords(text) {
  const lower = text.toLowerCase();
  const tokens = lower.replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
  const stop = new Set(["the","and","or","of","in","on","a","an","to","for","with","by","from","this","that","is","are","me","i","show","find","all","please","give","send","my","from","last","week","today","tomorrow"]);
  const out = [];
  for (const t of tokens) {
    if (t.length <= 2) continue;
    if (stop.has(t)) continue;
    if (!out.includes(t)) out.push(t);
  }
  console.log("[extractKeywords] Extracted keywords:", out);
  return out.slice(0, 10);
}
