import fetch from "node-fetch";

const REDIS_URL = process.env.REDIS_REST_URL;
const REDIS_TOKEN = process.env.REDIS_REST_TOKEN;

if (!REDIS_URL || !REDIS_TOKEN) {
  console.warn("⚠️ REDIS_REST_URL or REDIS_REST_TOKEN missing from environment. Redis ops will fail.");
}

async function redisCommand(command, ...args) {
  if (!REDIS_URL || !REDIS_TOKEN) {
    throw new Error("Redis URL or Token is missing.");
  }

  // SET: POST body
  if (command.toLowerCase() === "set") {
    const [key, value] = args;
    console.log(`[Redis][COMMAND] SET ${key} -> ${String(value).substring(0, 800)}`);
    const response = await fetch(`${REDIS_URL}/set/${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${REDIS_TOKEN}`, "Content-Type": "application/json" },
      body: typeof value === "string" ? value : JSON.stringify(value),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Redis SET command failed: ${text}`);
    }
    return response.json();
  }

  // GET, KEYS etc
  console.log(`[Redis][COMMAND] ${command.toUpperCase()} ${args.join(" ")}`);
  const response = await fetch(`${REDIS_URL}/${command}/${args.map(a => encodeURIComponent(a)).join("/")}`, {
    headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
  });
  if (!response.ok) {
    const txt = await response.text();
    console.warn(`[Redis] ${command} returned error: ${txt}`);
    return { result: null };
  }
  return response.json();
}

// ------------------ User functions ------------------
export async function saveUser(googleId, userData) {
  console.log(`[Redis] saveUser ${googleId} -> ${JSON.stringify(userData).substring(0, 500)}`);
  await redisCommand("set", `user:google:${googleId}`, JSON.stringify(userData));
  if (userData.psid) {
    await redisCommand("set", `user:psid:${userData.psid}`, JSON.stringify({ googleId }));
  }
}

export async function getUser(googleId) {
  const result = await redisCommand("get", `user:google:${googleId}`);
  if (!result || !result.result) return null;
  try {
    return JSON.parse(result.result);
  } catch (e) {
    console.error("[Redis] Failed to parse getUser result:", e);
    return null;
  }
}

export async function getUserByPsid(psid) {
  const result = await redisCommand("get", `user:psid:${psid}`);
  if (!result || !result.result) return null;
  try {
    const obj = JSON.parse(result.result);
    if (!obj.googleId) return null;
    return await getUser(obj.googleId);
  } catch (e) {
    console.error("[Redis] getUserByPsid parse error:", e);
    return null;
  }
}

export async function getAllUserGoogleIds() {
  const result = await redisCommand("keys", "user:google:*");
  if (result && Array.isArray(result.result)) {
    console.log(`[Redis] Found user keys: ${result.result.length}`);
    return result.result.map(key => key.replace("user:google:", ""));
  }
  return [];
}

export async function isPsidRegistered(psid) {
  const result = await redisCommand("get", `user:psid:${psid}`);
  return !!(result && result.result);
}

// ------------------ Reminder tracking ------------------
export async function reminderAlreadySent(assignmentId, googleId, hours) {
  const key = `reminder:${assignmentId}:${googleId}`;
  const result = await redisCommand("get", key);
  const recordString = result && result.result ? result.result : null;
  const record = recordString ? JSON.parse(recordString) : { remindersSent: [] };
  return record.remindersSent.includes(hours);
}

export async function markReminderSent(assignmentId, googleId, hours) {
  const key = `reminder:${assignmentId}:${googleId}`;
  const result = await redisCommand("get", key);
  const recordString = result && result.result ? result.result : null;
  let record = recordString ? JSON.parse(recordString) : { remindersSent: [] };
  if (!record.remindersSent.includes(hours)) {
    record.remindersSent.push(hours);
  }
  await redisCommand("set", key, JSON.stringify(record));
}

// ------------------ Last checked times (per course) ------------------
export async function getLastCheckedTime(courseId) {
  const key = `lastpost:${courseId}`;
  const result = await redisCommand("get", key);
  return result ? result.result : null;
}

export async function setLastCheckedTime(courseId, time) {
  const key = `lastpost:${courseId}`;
  console.log(`[Redis] setLastCheckedTime ${courseId} -> ${time}`);
  await redisCommand("set", key, time);
}

// ------------------ Last assignment checked time (per course) ------------------
export async function getLastAssignmentTime(courseId) {
  const key = `lastassignment:${courseId}`;
  const result = await redisCommand("get", key);
  return result ? result.result : null;
}

export async function setLastAssignmentTime(courseId, time) {
  const key = `lastassignment:${courseId}`;
  console.log(`[Redis] setLastAssignmentTime ${courseId} -> ${time}`);
  await redisCommand("set", key, time);
}

// ------------------ Index storage & search ------------------
// Keys: index:item:{googleId}:{type}:{courseId}:{itemId}
// Index list key: index:items:google:{googleId} -> JSON array of keys

export async function saveIndexedItem(googleId, item, isMeta = false) {
  try {
    if (isMeta && item.__meta) {
      const metaKey = `index:meta:google:${googleId}`;
      console.log(`[Redis][INDEX] Saving meta for ${googleId}: ${JSON.stringify(item).substring(0,200)}`);
      await redisCommand("set", metaKey, JSON.stringify(item));
      return;
    }

    // normalize minimal fields
    item = item || {};
    const id = item.id || `synthetic-${item.type || "item"}-${Math.random().toString(36).slice(2,9)}`;
    const type = item.type || "unknown";
    const courseId = item.courseId || "unknown";
    const title = item.title || (item.raw && item.raw.title) || (item.raw && item.raw.text) || "Untitled";
    const createdTime = item.createdTime || new Date().toISOString();
    const link = item.link || (item.raw && item.raw.alternateLink) || null;

    const key = `index:item:${googleId}:${type}:${courseId}:${id}`;
    const payload = {
      id,
      type,
      courseId,
      courseName: item.courseName || null,
      title,
      description: item.description || "",
      createdTime,
      dueDate: item.dueDate || null,
      dueTime: item.dueTime || null,
      link,
      keywords: generateKeywords(title, item.description || ""),
      raw: item.raw || null,
    };

    console.log(`[Redis][INDEX] Setting ${key} -> ${JSON.stringify(payload).substring(0,500)}`);
    await redisCommand("set", key, JSON.stringify(payload));

    // Add to user's index list
    const listKey = `index:items:google:${googleId}`;
    const existingListResp = await redisCommand("get", listKey);
    let existingList = [];
    if (existingListResp && existingListResp.result) {
      try {
        existingList = JSON.parse(existingListResp.result);
      } catch (e) {
        console.error("[Redis][INDEX] Failed to parse existing list - resetting it.", e);
        existingList = [];
      }
    }
    if (!existingList.includes(key)) {
      existingList.push(key);
      await redisCommand("set", listKey, JSON.stringify(existingList));
    }
  } catch (err) {
    console.error("[Redis][INDEX] saveIndexedItem failed:", err);
  }
}

export async function getIndexedItemByKey(key) {
  const result = await redisCommand("get", key);
  if (!result || !result.result) return null;
  try {
    return JSON.parse(result.result);
  } catch (e) {
    console.error("[Redis] getIndexedItemByKey parse error:", e);
    return null;
  }
}

export async function getAllIndexedKeysForUser(googleId) {
  const listKey = `index:items:google:${googleId}`;
  const result = await redisCommand("get", listKey);
  if (!result || !result.result) return [];
  try {
    const arr = JSON.parse(result.result);
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    console.error("[Redis] getAllIndexedKeysForUser parse error:", e);
    return [];
  }
}

/**
 * filters:
 *  - type: "assignment" | "material" | "announcement"
 *  - course: substring match of course name
 *  - dateRange: { from: ISOstring, to: ISOstring } -> will check dueDate for assignments or createdTime if dueDate missing
 *  - keywords: array of keywords
 */
export async function searchIndexedItems(googleId, filters = {}) {
  console.log(`[Redis][SEARCH] Searching items for ${googleId} with filters: ${JSON.stringify(filters)}`);
  const keys = await getAllIndexedKeysForUser(googleId);
  const results = [];
  for (const key of keys) {
    try {
      const item = await getIndexedItemByKey(key);
      if (!item) continue;

      let pass = true;

      // type filter
      if (filters.type && filters.type.toLowerCase() !== item.type.toLowerCase()) pass = false;

      // course filter (substring)
      if (filters.course) {
        const courseLower = (item.courseName || "").toLowerCase();
        if (!courseLower.includes(filters.course.toLowerCase())) pass = false;
      }

      // date filter: if type is assignment and item has dueDate -> compare dueDate; else fallback to createdTime
      if (filters.dateRange) {
        const from = new Date(filters.dateRange.from);
        const to = new Date(filters.dateRange.to);
        let checkDate = null;
        if (item.dueDate && item.dueDate.year) {
          // build UTC date using dueTime if exists (else end of day)
          const h = item.dueTime?.hours ?? 23;
          const m = item.dueTime?.minutes ?? 59;
          checkDate = new Date(Date.UTC(item.dueDate.year, item.dueDate.month - 1, item.dueDate.day, h, m));
        } else {
          // fallback to createdTime
          checkDate = new Date(item.createdTime);
        }
        // Convert to local/UTC-dependent comparison: we will compare by timestamps
        if (!(checkDate >= from && checkDate <= to)) pass = false;
      }

      // keyword filter: check title, description, keywords
      if (filters.keywords && filters.keywords.length > 0) {
        const text = `${item.title} ${item.description} ${(item.keywords || []).join(" ")}`.toLowerCase();
        const kws = filters.keywords.map(k => k.toLowerCase());
        const anyMatch = kws.some(k => text.includes(k));
        if (!anyMatch) pass = false;
      }

      if (pass) results.push(item);
    } catch (e) {
      console.error("[Redis][SEARCH] Error getting item:", e);
    }
  }

  // dedupe by link or id
  const seen = new Set();
  const deduped = [];
  for (const r of results) {
    const key = r.link || `${r.id}:${r.title}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(r);
    }
  }

  console.log(`[Redis][SEARCH] Found ${deduped.length} results for ${googleId}`);
  return deduped;
}

// basic keyword generator
export function generateKeywords(title = "", description = "") {
  const text = `${title} ${description}`.toLowerCase();
  const rawWords = text.replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
  const stop = new Set(["the","and","or","of","in","on","a","an","to","for","with","by","from","this","that","is","are","be"]);
  const keywords = [];
  for (const w of rawWords) {
    if (w.length <= 2) continue;
    if (stop.has(w)) continue;
    if (!keywords.includes(w)) keywords.push(w);
  }
  const autos = ["lab", "report", "midterm", "final", "project", "homework", "hw", "assignment", "quiz"];
  for (const a of autos) {
    if (text.includes(a) && !keywords.includes(a)) keywords.push(a);
  }
  return keywords.slice(0, 30);
}
