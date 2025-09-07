import fetch from "node-fetch";

const REDIS_URL = process.env.REDIS_REST_URL;
const REDIS_TOKEN = process.env.REDIS_REST_TOKEN;

if (!REDIS_URL || !REDIS_TOKEN) {
  console.warn("⚠️ REDIS_REST_URL or REDIS_REST_TOKEN missing from environment. Redis ops will fail.");
}

async function redisCommand(command, ...args) {
  if (!REDIS_URL || !REDIS_TOKEN) throw new Error("Redis URL or Token is missing.");

  // SET
  if (command.toLowerCase() === "set") {
    const [key, value] = args;
    const response = await fetch(`${REDIS_URL}/set/${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${REDIS_TOKEN}`, "Content-Type": "application/json" },
      body: typeof value === "string" ? value : JSON.stringify(value),
    });
    if (!response.ok) throw new Error(`Redis SET command failed: ${await response.text()}`);
    return response.json();
  }

  // GET, KEYS
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
  await redisCommand("set", `user:google:${googleId}`, JSON.stringify(userData));
  if (userData.psid) {
    await redisCommand("set", `user:psid:${userData.psid}`, JSON.stringify({ googleId }));
  }
}

export async function getUser(googleId) {
  const result = await redisCommand("get", `user:google:${googleId}`);
  if (!result?.result) return null;
  return JSON.parse(result.result);
}

export async function getUserByPsid(psid) {
  const result = await redisCommand("get", `user:psid:${psid}`);
  if (!result?.result) return null;
  const obj = JSON.parse(result.result);
  return obj.googleId ? await getUser(obj.googleId) : null;
}

export async function getAllUserGoogleIds() {
  const result = await redisCommand("keys", "user:google:*");
  if (result?.result) return result.result.map(k => k.replace("user:google:", ""));
  return [];
}

export async function isPsidRegistered(psid) {
  const result = await redisCommand("get", `user:psid:${psid}`);
  return !!result?.result;
}

// ------------------ Reminder tracking ------------------
export async function reminderAlreadySent(assignmentId, googleId, hours) {
  const key = `reminder:${assignmentId}:${googleId}`;
  const result = await redisCommand("get", key);
  const record = result?.result ? JSON.parse(result.result) : { remindersSent: [] };
  return record.remindersSent.includes(hours);
}

export async function markReminderSent(assignmentId, googleId, hours) {
  const key = `reminder:${assignmentId}:${googleId}`;
  const result = await redisCommand("get", key);
  let record = result?.result ? JSON.parse(result.result) : { remindersSent: [] };
  if (!record.remindersSent.includes(hours)) record.remindersSent.push(hours);
  await redisCommand("set", key, JSON.stringify(record));
}

// ------------------ Last checked times ------------------
export async function getLastCheckedTime(courseId) {
  const result = await redisCommand("get", `lastpost:${courseId}`);
  return result?.result || null;
}

export async function setLastCheckedTime(courseId, time) {
  await redisCommand("set", `lastpost:${courseId}`, time);
}

export async function getLastAssignmentTime(courseId) {
  const result = await redisCommand("get", `lastassignment:${courseId}`);
  return result?.result || null;
}

export async function setLastAssignmentTime(courseId, time) {
  await redisCommand("set", `lastassignment:${courseId}`, time);
}

// ------------------ Indexed items ------------------
export async function saveIndexedItem(googleId, item) {
  const id = item.id || `synthetic-${item.type}-${Math.random().toString(36).slice(2,9)}`;
  const type = item.type || "unknown";
  const courseId = item.courseId || "unknown";
  const key = `index:item:${googleId}:${type}:${courseId}:${id}`;
  const payload = {
    ...item,
    id, type, courseId,
    keywords: generateKeywords(item.title || "", item.description || ""),
  };
  await redisCommand("set", key, JSON.stringify(payload));

  // update user's list
  const listKey = `index:items:google:${googleId}`;
  const existing = await redisCommand("get", listKey);
  let arr = existing?.result ? JSON.parse(existing.result) : [];
  if (!arr.includes(key)) arr.push(key);
  await redisCommand("set", listKey, JSON.stringify(arr));
}

export async function getAllIndexedKeysForUser(googleId) {
  const result = await redisCommand("get", `index:items:google:${googleId}`);
  return result?.result ? JSON.parse(result.result) : [];
}

export async function getIndexedItemByKey(key) {
  const result = await redisCommand("get", key);
  return result?.result ? JSON.parse(result.result) : null;
}

// search with filters
export async function searchIndexedItems(googleId, filters = {}) {
  const keys = await getAllIndexedKeysForUser(googleId);
  const results = [];
  for (const key of keys) {
    const item = await getIndexedItemByKey(key);
    if (!item) continue;
    let pass = true;

    if (filters.type && filters.type.toLowerCase() !== item.type.toLowerCase()) pass = false;
    if (filters.course && !(item.courseName || "").toLowerCase().includes(filters.course.toLowerCase())) pass = false;

    if (filters.dateRange) {
      const from = new Date(filters.dateRange.from);
      const to = new Date(filters.dateRange.to);
      let checkDate = item.dueDate ? new Date(Date.UTC(item.dueDate.year, item.dueDate.month-1, item.dueDate.day, item.dueTime?.hours??23, item.dueTime?.minutes??59)) : new Date(item.createdTime);
      if (!(checkDate >= from && checkDate <= to)) pass = false;
    }

    if (filters.keywords && filters.keywords.length > 0) {
      const text = `${item.title} ${item.description} ${(item.keywords||[]).join(" ")}`.toLowerCase();
      if (!filters.keywords.some(k => text.includes(k.toLowerCase()))) pass = false;
    }

    if (pass) results.push(item);
  }

  // dedupe
  const seen = new Set();
  return results.filter(r => {
    const k = r.link || `${r.id}:${r.title}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ------------------ Keyword helper ------------------
export function generateKeywords(title="", desc="") {
  const text = `${title} ${desc}`.toLowerCase();
  const words = text.replace(/[^a-z0-9\s]/g," ").split(/\s+/).filter(Boolean);
  const stop = new Set(["the","and","or","of","in","on","a","an","to","for","with","by","from","this","that","is","are","be"]);
  const kws = [];
  for (const w of words) if(w.length>2 && !stop.has(w) && !kws.includes(w)) kws.push(w);
  const autos = ["lab","report","midterm","final","project","homework","hw","assignment","quiz"];
  for(const a of autos) if(text.includes(a) && !kws.includes(a)) kws.push(a);
  return kws.slice(0,30);
}
