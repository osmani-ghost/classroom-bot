import fetch from "node-fetch";

const REDIS_URL = process.env.REDIS_REST_URL || process.env.REDIS_URL;
const REDIS_TOKEN = process.env.REDIS_REST_TOKEN || process.env.REDIS_TOKEN;

async function redisCommand(command, ...args) {
  if (!REDIS_URL || !REDIS_TOKEN) {
    throw new Error("Redis URL or Token is missing.");
  }

  // SET command uses POST body for value
  if (command.toLowerCase() === "set") {
    const [key, value] = args;
    console.log(`[Redis] SET -> key=${key} bodyPreview=${String(value).slice(0, 80)}`);
    const response = await fetch(`${REDIS_URL}/set/${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
      body: value,
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Redis SET command failed: ${text}`);
    }
    const json = await response.json();
    console.log("[Redis] SET response:", json);
    return json;
  }

  // Generic GET/KEYS/DEL/exists
  const url = `${REDIS_URL}/${command}/${args.map(encodeURIComponent).join("/")}`;
  console.log(`[Redis] ${command.toUpperCase()} -> ${url}`);
  const response = await fetch(url, { headers: { Authorization: `Bearer ${REDIS_TOKEN}` } });
  if (!response.ok) {
    // Return null-like shape so callers can handle absent keys
    console.warn(`[Redis] ${command} returned non-200: ${response.status}`);
    return { result: null };
  }
  const json = await response.json();
  return json;
}

// ---- User management ----
export async function saveUser(googleId, userData) {
  console.log(`[Redis] saveUser -> googleId=${googleId}, psid=${userData.psid}`);
  await redisCommand("set", `user:google:${googleId}`, JSON.stringify(userData));
  await redisCommand("set", `user:psid:${userData.psid}`, JSON.stringify({ googleId }));
  return true;
}

export async function getUser(googleId) {
  console.log(`[Redis] getUser -> googleId=${googleId}`);
  const result = await redisCommand("get", `user:google:${googleId}`);
  if (result && result.result) {
    try {
      return JSON.parse(result.result);
    } catch (err) {
      console.error("[Redis] getUser JSON parse error:", err);
      return null;
    }
  }
  return null;
}

export async function getAllUserGoogleIds() {
  console.log("[Redis] getAllUserGoogleIds()");
  const result = await redisCommand("keys", "user:google:*");
  if (result && Array.isArray(result.result)) {
    return result.result.map((key) => key.replace("user:google:", ""));
  }
  return [];
}

export async function isPsidRegistered(psid) {
  console.log(`[Redis] isPsidRegistered -> psid=${psid}`);
  const result = await redisCommand("get", `user:psid:${psid}`);
  return !!(result && result.result);
}

// ---- Reminder tracking ----
export async function reminderAlreadySent(assignmentId, googleId, hours) {
  const key = `reminder:${assignmentId}:${googleId}`;
  console.log(`[Redis] reminderAlreadySent -> key=${key}, hours=${hours}`);
  const result = await redisCommand("get", key);
  const recordString = result ? result.result : null;
  const record = recordString ? JSON.parse(recordString) : { remindersSent: [] };
  return record.remindersSent.includes(hours);
}

export async function markReminderSent(assignmentId, googleId, hours) {
  const key = `reminder:${assignmentId}:${googleId}`;
  console.log(`[Redis] markReminderSent -> key=${key}, hours=${hours}`);
  const result = await redisCommand("get", key);
  const recordString = result ? result.result : null;
  let record = recordString ? JSON.parse(recordString) : { remindersSent: [] };
  if (!record.remindersSent.includes(hours)) {
    record.remindersSent.push(hours);
  }
  await redisCommand("set", key, JSON.stringify(record));
}

// ---- New post tracking ----
export async function getLastCheckedTime(courseId) {
  const key = `lastpost:${courseId}`;
  console.log(`[Redis] getLastCheckedTime -> courseId=${courseId}`);
  const result = await redisCommand("get", key);
  return result ? result.result : null;
}

export async function setLastCheckedTime(courseId, time) {
  const key = `lastpost:${courseId}`;
  console.log(`[Redis] setLastCheckedTime -> ${courseId} = ${time}`);
  await redisCommand("set", key, time);
}

// ---- Items indexing & search (Feature 2 Part A + C) ----
export async function saveItemForPsid(psid, itemObj) {
  const key = `user:${psid}:item:${itemObj.id}`;
  console.log(`[Redis] saveItemForPsid -> psid=${psid}, itemId=${itemObj.id}`);
  const payload = JSON.stringify(itemObj);
  await redisCommand("set", key, payload);
  return true;
}

export async function itemExistsForPsid(psid, itemId) {
  const key = `user:${psid}:item:${itemId}`;
  console.log(`[Redis] itemExistsForPsid -> checking key=${key}`);
  const result = await redisCommand("get", key);
  return !!(result && result.result);
}

/* Fetch all items for psid */
export async function getAllItemsForPsid(psid) {
  console.log(`[Redis] getAllItemsForPsid -> psid=${psid}`);
  const keysResult = await redisCommand("keys", `user:${psid}:item:*`);
  const keys = (keysResult && Array.isArray(keysResult.result)) ? keysResult.result : [];
  console.log(`[Redis] Found ${keys.length} keys for psid=${psid}`);
  const items = [];
  for (const key of keys) {
    try {
      const res = await redisCommand("get", key);
      if (res && res.result) {
        items.push(JSON.parse(res.result));
      }
    } catch (err) {
      console.error(`[Redis] Error fetching item ${key}:`, err);
    }
  }
  return items;
}

/* Search items for user with simple filters:
   filters = { type: "assignment"|"material"|"announcement" | null, course: "physics", timeframe: "today"|"tomorrow"|"thisweek"|"lastweek", raw: originalText }
*/
export async function searchItemsForPsid(psid, filters = {}) {
  console.log(`[Redis] searchItemsForPsid -> psid=${psid}, filters=${JSON.stringify(filters)}`);
  const allItems = await getAllItemsForPsid(psid);
  if (!allItems || allItems.length === 0) {
    console.log("[Redis] No items available to search.");
    return [];
  }

  // Helper date boundaries in BDT (UTC+6)
  function startOfDayBDT(d) {
    const dt = new Date(d);
    const utc = dt.getTime() - 6 * 60 * 60 * 1000; // convert BDT -> UTC
    const dateUTC = new Date(utc);
    dateUTC.setUTCHours(0, 0, 0, 0);
    return new Date(dateUTC.getTime() + 6 * 60 * 60 * 1000);
  }
  function endOfDayBDT(d) {
    const s = startOfDayBDT(d);
    return new Date(s.getTime() + 24 * 60 * 60 * 1000 - 1);
  }
  function startOfWeekBDT(d) {
    const dt = new Date(d);
    const day = dt.getDay(); // 0 Sunday
    const sunday = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate() - day);
    return startOfDayBDT(sunday);
  }
  function endOfWeekBDT(d) {
    const s = startOfWeekBDT(d);
    return new Date(s.getTime() + 7 * 24 * 60 * 60 * 1000 - 1);
  }

  const now = new Date();
  const todayStart = startOfDayBDT(now);
  const todayEnd = endOfDayBDT(now);
  const tomorrowStart = startOfDayBDT(new Date(now.getTime() + 24 * 60 * 60 * 1000));
  const tomorrowEnd = endOfDayBDT(new Date(now.getTime() + 24 * 60 * 60 * 1000));
  const thisWeekStart = startOfWeekBDT(now);
  const thisWeekEnd = endOfWeekBDT(now);
  const lastWeekStart = startOfWeekBDT(new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000));
  const lastWeekEnd = endOfWeekBDT(new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000));

  const typeFilter = filters.type || null;
  const courseHint = filters.course ? filters.course.toLowerCase() : null;
  const timeframe = filters.timeframe || null;
  const raw = filters.raw || "";

  // keyword tokens from raw
  const rawTokens = raw.replace(/[^\w\s]/g, " ").split(/\s+/).filter(Boolean).map((s) => s.toLowerCase());

  const results = allItems.filter((item) => {
    try {
      // type filter
      if (typeFilter && item.type !== typeFilter) return false;

      // course filter (fuzzy contains)
      if (courseHint) {
        const cname = (item.courseName || "").toLowerCase();
        if (!cname.includes(courseHint) && !(item.keywords || []).some((k) => k.includes(courseHint))) {
          return false;
        }
      }

      // timeframe filter
      if (timeframe) {
        if (item.type === "assignment") {
          const due = item.dueDate ? new Date(item.dueDate) : null;
          if (!due) return false;
          if (timeframe === "today" && !(due >= todayStart && due <= todayEnd)) return false;
          if (timeframe === "tomorrow" && !(due >= tomorrowStart && due <= tomorrowEnd)) return false;
          if (timeframe === "thisweek" && !(due >= thisWeekStart && due <= thisWeekEnd)) return false;
          if (timeframe === "lastweek" && !(due >= lastWeekStart && due <= lastWeekEnd)) return false;
        } else {
          // announcements/materials -> use createdAt
          const created = item.createdAt ? new Date(item.createdAt) : null;
          if (!created) return false;
          if (timeframe === "today" && !(created >= todayStart && created <= todayEnd)) return false;
          if (timeframe === "tomorrow" && !(created >= tomorrowStart && created <= tomorrowEnd)) return false;
          if (timeframe === "thisweek" && !(created >= thisWeekStart && created <= thisWeekEnd)) return false;
          if (timeframe === "lastweek" && !(created >= lastWeekStart && created <= lastWeekEnd)) return false;
        }
      }

      // raw token matching against title/keywords/courseName
      if (rawTokens.length > 0) {
        const hay = `${item.title || ""} ${(item.keywords || []).join(" ")} ${item.courseName || ""}`.toLowerCase();
        const matchesAny = rawTokens.some((t) => hay.includes(t));
        if (!matchesAny) return false;
      }

      return true;
    } catch (err) {
      console.error("[Redis] Error filtering item:", err);
      return false;
    }
  });

  // sort by relevant date: for assignments -> dueDate asc; for others -> createdAt desc
  results.sort((a, b) => {
    try {
      const aKey = a.type === "assignment" ? a.dueDate || a.createdAt : a.createdAt;
      const bKey = b.type === "assignment" ? b.dueDate || b.createdAt : b.createdAt;
      if (!aKey && !bKey) return 0;
      if (!aKey) return 1;
      if (!bKey) return -1;
      const ad = new Date(aKey);
      const bd = new Date(bKey);
      // assignments: earliest first; announcements/materials: newest first
      if (a.type === "assignment" && b.type === "assignment") {
        return ad - bd;
      }
      if (a.type !== "assignment" && b.type !== "assignment") {
        return bd - ad;
      }
      // mixed types -> prioritize assignments with earlier due date
      return ad - bd;
    } catch (err) {
      return 0;
    }
  });

  console.log(`[Redis] searchItemsForPsid -> found ${results.length} matching items`);
  return results;
}
