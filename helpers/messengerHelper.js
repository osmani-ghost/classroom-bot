import fetch from "node-fetch";
import { getUserByPsid, getUser, searchIndexedItems } from "./redisHelper.js";

// --- send to Facebook Messenger API with debug logs ---
async function sendApiRequest(payload) {
  const PAGE_ACCESS_TOKEN = process.env.MESSENGER_PAGE_ACCESS_TOKEN;
  if (!PAGE_ACCESS_TOKEN) {
    console.error("❌ PAGE_ACCESS_TOKEN is missing in environment variables.");
    return;
  }

  const url = `https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`;
  try {
    console.log(
      `[Messenger] Sending API request payload to recipient: ${JSON.stringify(payload.recipient).substring(
        0,
        200
      )}`
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
      console.log("[Messenger] API Response:", JSON.stringify(result).substring(0, 500));
    }
  } catch (error) {
    console.error("❌ Failed to send message:", error);
  }
}

// Send plain text
export async function sendRawMessage(psid, text) {
  console.log(`[Messenger] sendRawMessage to ${psid}: ${text.substring(0, 400)}`);
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

// send by googleId
export async function sendMessageToGoogleUser(googleId, text) {
  console.log(`[Messenger] sendMessageToGoogleUser for googleId ${googleId}: ${text.substring(0, 200)}`);
  const user = await getUser(googleId);
  if (!user || !user.psid) {
    console.error(`⚠️ No PSID mapped for Google ID: ${googleId}. Cannot send message.`);
    return;
  }
  await sendRawMessage(user.psid, text);
}

// Format a single item for Messenger UI (clean)
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
    utcDate.setHours(utcDate.getHours() + 6); // to BDT (UTC+6)
    const day = utcDate.getDate().toString().padStart(2, "0");
    const month = (utcDate.getMonth() + 1).toString().padStart(2, "0");
    const year = utcDate.getFullYear();
    let hours = utcDate.getHours();
    const minutes = utcDate.getMinutes().toString().padStart(2, "0");
    const ampm = hours >= 12 ? "PM" : "AM";
    hours = hours % 12 || 12;
    return `${day}-${month}-${year}, ${hours}:${minutes} ${ampm}`;
  } catch (e) {
    return "Unknown";
  }
}

// -------------------- SEARCH LOGIC -----------------------
async function searchIndexedItems(googleId, filters = {}) {
  try {
    const rawKeys = await redisClient.get(`index:items:google:${googleId}`);
    if (!rawKeys) return [];
    const keys = JSON.parse(rawKeys);
    const items = [];
    for (const key of keys) {
      const raw = await redisClient.get(key);
      if (!raw) continue;
      items.push(JSON.parse(raw));
    }

    // Filter by type
    let results = items;
    if (filters.type) results = results.filter(i => i.type === filters.type);
    // Filter by course name (case-insensitive)
    if (filters.course) {
      const c = filters.course.toLowerCase();
      results = results.filter(i => i.courseName.toLowerCase().includes(c));
    }
    // Filter by date range
    if (filters.dateRange) {
      const from = new Date(filters.dateRange.from).getTime();
      const to = new Date(filters.dateRange.to).getTime();
      results = results.filter(i => {
        if (!i.dueDate) return false;
        const d = new Date(i.dueDate.year, i.dueDate.month - 1, i.dueDate.day).getTime();
        return d >= from && d <= to;
      });
    }
    // Filter by keywords
    if (filters.keywords && filters.keywords.length > 0) {
      results = results.filter(i => {
        const text = ((i.title || "") + " " + (i.description || "")).toLowerCase();
        return filters.keywords.every(k => text.includes(k));
      });
    }

    // Sort by due date ascending
    results.sort((a, b) => {
      const da = a.dueDate ? new Date(a.dueDate.year, a.dueDate.month - 1, a.dueDate.day) : new Date();
      const db = b.dueDate ? new Date(b.dueDate.year, b.dueDate.month - 1, b.dueDate.day) : new Date();
      return da - db;
    });

    return results;
  } catch (err) {
    console.error("[SEARCH ERROR]", err);
    return [];
  }
}

// -------------------- USER MESSAGE HANDLER -----------------
export async function handleUserTextMessage(psid, text) {
  console.log(`[Messenger] handleUserTextMessage from ${psid}: "${text}"`);
  const user = await getUserByPsid(psid);
  if (!user) {
    await sendLoginButton(psid);
    return;
  }
  const googleId = user.googleId;

  let filters = {};
  const lower = text.toLowerCase();

  // Command shortcut
  if (text.startsWith("/")) {
    const parts = text.slice(1).split(/\s+/);
    const command = parts[0].toLowerCase();
    const arg = parts.slice(1).join(" ");
    if (command === "assignments") filters.type = "assignment";
    if (command === "materials") filters.type = "material";
    if (command === "announcements") filters.type = "announcement";

    if (arg) {
      const dateRange = parseDateKeyword(arg);
      if (dateRange) filters.dateRange = dateRange;
      else filters.course = arg;
    }
  } else {
    // natural language
    if (lower.includes("assignment") || lower.includes("due")) filters.type = "assignment";
    if (lower.includes("material") || lower.includes("notes") || lower.includes("slide")) filters.type = "material";
    if (lower.includes("announcement") || lower.includes("notice")) filters.type = "announcement";

    // course detection
    const known = ["share codes","test bot"];
    for (const k of known) {
      if (lower.includes(k)) {
        filters.course = k;
        break;
      }
    }

    const dateRange = parseDateKeyword(text);
    if (dateRange) filters.dateRange = dateRange;

    const keywords = extractKeywords(text);
    if (keywords.length > 0) filters.keywords = keywords;
  }

  console.log(`[Messenger] Parsed filters: ${JSON.stringify(filters)}`);
  const results = await searchIndexedItems(googleId, filters);

  if (!results || results.length === 0) {
    await sendRawMessage(psid, `🔍 No results found. Try different keywords or use /assignments today`);
    return;
  }

  const maxToSend = 8;
  const toSend = results.slice(0, maxToSend);
  const messages = toSend.map(i => formatItemMessage(i));
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
    return { from: startOfDay(now).toISOString(), to: endOfDay(now).toISOString() };
  }
  if (lower.includes("tomorrow")) {
    const t = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    return { from: startOfDay(t).toISOString(), to: endOfDay(t).toISOString() };
  }
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
  return out.slice(0, 10);
}
