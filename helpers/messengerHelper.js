import fetch from "node-fetch";
import {
  getUser,
  getAllItemsForPsid,
  searchItemsForPsid,
} from "./redisHelper.js";

/**
 * NOTE on env names:
 * Your .env contains MESSENGER_PAGE_ACCESS_TOKEN and MESSENGER_VERIFY_TOKEN.
 * The original code referenced different names in places; we use MESSENGER_PAGE_ACCESS_TOKEN here.
 */

const PAGE_ACCESS_TOKEN = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;

/* Low-level API request */
async function sendApiRequest(payload) {
  if (!PAGE_ACCESS_TOKEN) {
    console.error("❌ PAGE_ACCESS_TOKEN is missing in environment variables.");
    return;
  }
  const url = `https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`;
  try {
    console.log(`[Messenger] Sending API request to PSID: ${payload.recipient?.id}`);
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
    return result;
  } catch (error) {
    console.error("❌ Failed to send message:", error);
    throw error;
  }
}

/* Raw text message */
export async function sendRawMessage(psid, text) {
  console.log(`[Messenger] sendRawMessage -> psid=${psid}, textPreview="${String(text).slice(0, 80)}"`);
  const payload = {
    recipient: { id: psid },
    message: { text },
  };
  return sendApiRequest(payload);
}

/* Login button */
export async function sendLoginButton(psid) {
  console.log(`[Messenger] sendLoginButton -> psid=${psid}`);
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
            {
              type: "web_url",
              url: loginUrl,
              title: "Login with Google",
            },
          ],
        },
      },
    },
  };
  return sendApiRequest(payload);
}

/* Send message using Google ID mapping */
export async function sendMessageToGoogleUser(googleId, text) {
  console.log(`[Messenger] sendMessageToGoogleUser -> googleId=${googleId}`);
  const user = await getUser(googleId);
  if (!user || !user.psid) {
    console.error(`⚠️ No PSID mapped for Google ID: ${googleId}. Cannot send message.`);
    return;
  }
  return sendRawMessage(user.psid, text);
}

/* Helper: sleep */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* High-level incoming message handler
   - Recognizes /commands and natural heuristics
   - Calls Redis search and formats replies
*/
export async function handleIncomingMessage(psid, text) {
  console.log(`[Messenger] handleIncomingMessage -> psid=${psid}, text="${text}"`);
  try {
    if (!text || text.trim().length === 0) {
      console.log("[Messenger] Empty message text -> send help");
      await sendRawMessage(psid, "Please type a command. Try: /assignments today or /materials chemistry");
      return;
    }

    const normalized = text.trim().toLowerCase();
    // if starts with slash -> explicit commands
    let command = null;
    let arg = null;

    if (normalized.startsWith("/")) {
      const parts = normalized.split(/\s+/);
      command = parts[0]; // e.g., /assignments
      arg = parts.slice(1).join(" ") || null;
      console.log(`[Messenger] Detected slash command: ${command} arg="${arg}"`);
    } else {
      // Natural language heuristics: simple keyword matching
      // Look for keywords for type, timeframe, or course
      const tokens = normalized.split(/\s+/);
      const typeHints = ["assignment", "assign", "homework", "task"];
      const materialHints = ["material", "materials", "note", "notes", "slides"];
      const announcementHints = ["announcement", "announce", "announcements", "notice"];

      const timeframeHints = ["today", "tomorrow", "thisweek", "this week", "this-week", "thisweek"];
      // Determine basic type
      const tokenSet = new Set(tokens);
      if (tokens.some((t) => typeHints.includes(t))) {
        command = "/assignments";
      } else if (tokens.some((t) => materialHints.includes(t))) {
        command = "/materials";
      } else if (tokens.some((t) => announcementHints.includes(t))) {
        command = "/announcements";
      } else {
        // fallback: assume assignments search
        command = "/assignments";
      }
      // Look for timeframe tokens
      const tf = tokens.find((t) => ["today", "tomorrow", "this", "week", "thisweek", "this-week", "thisweek"].includes(t));
      arg = tf || tokens.find((t) => t.length > 2) || null; // naive course or timeframe
      console.log(`[Messenger] Heuristic inferred command=${command} arg=${arg}`);
    }

    // Build filters
    const filters = { type: null, course: null, timeframe: null, raw: normalized };

    // parse command into type
    if (command === "/assignments") filters.type = "assignment";
    if (command === "/materials") filters.type = "material";
    if (command === "/announcements") filters.type = "announcement";

    // parse arg: could be timeframe or course
    if (arg) {
      const a = arg.toLowerCase();
      if (["today", "tomorrow", "thisweek", "this week", "this-week"].includes(a)) {
        if (a.includes("today")) filters.timeframe = "today";
        else if (a.includes("tomorrow")) filters.timeframe = "tomorrow";
        else filters.timeframe = "thisweek";
      } else if (["lastweek", "last week", "last-week"].includes(a)) {
        filters.timeframe = "lastweek";
      } else {
        // treat as course hint or keyword
        filters.course = a;
      }
    }

    console.log(`[Messenger] Filters after parsing: ${JSON.stringify(filters)}`);

    // Query Redis
    console.log("[Messenger] Querying Redis for items...");
    const results = await searchItemsForPsid(psid, filters);
    console.log(`[Messenger] searchItemsForPsid returned ${results.length} items.`);

    if (!results || results.length === 0) {
      console.log("[Messenger] No matching items found -> sending apology.");
      await sendRawMessage(psid, "Sorry, I couldn't find anything matching your search.");
      return;
    }

    // Format results. If <=5 results -> single message; otherwise batch.
    const formatItem = (item) => {
      const itemTypeLabel = item.type === "assignment" ? "Assignment" : item.type === "material" ? "Material" : "Announcement";
      const dateLabel =
        item.type === "assignment"
          ? `Deadline: ${formatIsoToReadableBDT(item.dueDate)}`
          : `Posted: ${formatIsoToReadableBDT(item.createdAt)}`;
      const link = item.link || "Link not available";
      return `📘 ${item.courseName} ${itemTypeLabel}\n\nTitle: ${item.title}\n${dateLabel}\nLink: ${link}`;
    };

    // If small set, combine into single message
    if (results.length <= 5) {
      const combined = results.map(formatItem).join("\n\n---\n\n");
      console.log("[Messenger] Sending combined results message (<=5 items).");
      await sendRawMessage(psid, combined);
    } else {
      console.log("[Messenger] Sending results in batches to avoid spam.");
      // batch size 5
      for (let i = 0; i < results.length; i += 5) {
        const batch = results.slice(i, i + 5).map(formatItem).join("\n\n---\n\n");
        console.log(`[Messenger] Sending batch ${Math.floor(i / 5) + 1}`);
        await sendRawMessage(psid, batch);
        await sleep(600); // slight delay
      }
    }
  } catch (err) {
    console.error("[Messenger] Error in handleIncomingMessage:", err);
    await sendRawMessage(psid, "Sorry, an error occurred while processing your message.");
  }
}

/* Helper: format ISO -> dd-mm-yyyy, hh:mm AM/PM in BDT (UTC+6) */
function formatIsoToReadableBDT(iso) {
  try {
    if (!iso) return "N/A";
    const d = new Date(iso);
    // convert UTC to BDT by adding 6 hours
    const utc = d.getTime();
    const bdt = new Date(utc + 6 * 60 * 60 * 1000);
    const day = String(bdt.getDate()).padStart(2, "0");
    const month = String(bdt.getMonth() + 1).padStart(2, "0");
    const year = bdt.getFullYear();
    let hours = bdt.getHours();
    const minutes = String(bdt.getMinutes()).padStart(2, "0");
    const ampm = hours >= 12 ? "PM" : "AM";
    hours = hours % 12 || 12;
    return `${day}-${month}-${year}, ${hours}:${minutes} ${ampm}`;
  } catch (err) {
    console.error("[Messenger] formatIsoToReadableBDT error:", err);
    return iso;
  }
}
