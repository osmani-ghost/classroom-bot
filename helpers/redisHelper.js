import fetch from "node-fetch";

const REDIS_URL = process.env.REDIS_REST_URL;
const REDIS_TOKEN = process.env.REDIS_REST_TOKEN;

function logRedis(action, info) {
  console.log(`[Redis][${action}]`, info || "");
}

async function redisCommand(command, ...args) {
  if (!REDIS_URL || !REDIS_TOKEN) {
    throw new Error("Redis URL or Token is missing.");
  }

  // SET uses POST body
  if (command.toLowerCase() === "set") {
    const [key, value] = args;
    logRedis("SET", { key, preview: (value || "").toString().slice(0, 200) });
    const response = await fetch(`${REDIS_URL}/set/${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
      body: value,
    });
    const text = await response.text();
    if (!response.ok) {
      console.error("[Redis][SET] Failed:", text);
      throw new Error(`Redis SET failed: ${text}`);
    }
    try {
      return JSON.parse(text);
    } catch {
      return { result: text };
    }
  }

  // GET/KEYS and others via GET
  logRedis(command.toUpperCase(), { args });
  const response = await fetch(`${REDIS_URL}/${command}/${args.map(encodeURIComponent).join("/")}`, {
    headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
  });
  const text = await response.text();
  if (!response.ok) {
    console.warn(`[Redis][${command}] Non-OK response:`, text);
    return { result: null };
  }
  try {
    return JSON.parse(text);
  } catch {
    return { result: text };
  }
}

// ---- USER + MAPPINGS ----
export async function saveUser(googleId, userData) {
  logRedis("saveUser", { googleId, psid: userData?.psid });
  await redisCommand("set", `user:google:${googleId}`, JSON.stringify(userData));
  await redisCommand("set", `user:psid:${userData.psid}`, JSON.stringify({ googleId }));
}

export async function getUser(googleId) {
  const result = await redisCommand("get", `user:google:${googleId}`);
  const val = result?.result;
  logRedis("getUser", { googleId, found: !!val });
  return val ? JSON.parse(val) : null;
}

export async function getAllUserGoogleIds() {
  const result = await redisCommand("keys", "user:google:*");
  const list = (result && Array.isArray(result.result)) ? result.result : [];
  const ids = list.map((k) => k.replace("user:google:", ""));
  logRedis("getAllUserGoogleIds", { count: ids.length });
  return ids;
}

export async function isPsidRegistered(psid) {
  const result = await redisCommand("get", `user:psid:${psid}`);
  const found = !!(result && result.result);
  logRedis("isPsidRegistered", { psid, found });
  return found;
}

export async function getGoogleIdByPsid(psid) {
  const result = await redisCommand("get", `user:psid:${psid}`);
  const val = result?.result;
  const parsed = val ? JSON.parse(val) : null;
  logRedis("getGoogleIdByPsid", { psid, hasMapping: !!parsed });
  return parsed; // { googleId }
}

// ---- REMINDER TRACKING ----
export async function reminderAlreadySent(assignmentId, googleId, hours) {
  const key = `reminder:${assignmentId}:${googleId}`;
  const result = await redisCommand("get", key);
  const recordString = result ? result.result : null;
  const record = recordString ? JSON.parse(recordString) : { remindersSent: [] };
  const already = record.remindersSent.includes(hours);
  logRedis("reminderAlreadySent", { key, hours, already });
  return already;
}

export async function markReminderSent(assignmentId, googleId, hours) {
  const key = `reminder:${assignmentId}:${googleId}`;
  const result = await redisCommand("get", key);
  const recordString = result ? result.result : null;
  let record = recordString ? JSON.parse(recordString) : { remindersSent: [] };
  if (!record.remindersSent.includes(hours)) {
    record.remindersSent.push(hours);
  }
  await redisCommand("set", key, JSON.stringify(record));
  logRedis("markReminderSent", { key, hours, finalRecord: record });
}

// ---- NEW POSTS (Announcements/Materials) TRACKING ----
export async function getLastCheckedTime(courseId) {
  const key = `lastpost:${courseId}`;
  const result = await redisCommand("get", key);
  const ts = result ? result.result : null;
  logRedis("getLastCheckedTime", { key, ts });
  return ts;
}

export async function setLastCheckedTime(courseId, time) {
  const key = `lastpost:${courseId}`;
  await redisCommand("set", key, time);
  logRedis("setLastCheckedTime", { key, time });
}

// ---- NEW ASSIGNMENTS TRACKING ----
export async function getLastCheckedAssignmentsTime(courseId) {
  const key = `lastassign:${courseId}`;
  const result = await redisCommand("get", key);
  const ts = result ? result.result : null;
  logRedis("getLastCheckedAssignmentsTime", { key, ts });
  return ts;
}

export async function setLastCheckedAssignmentsTime(courseId, time) {
  const key = `lastassign:${courseId}`;
  await redisCommand("set", key, time);
  logRedis("setLastCheckedAssignmentsTime", { key, time });
}

// ---- MATERIALS STATE CONTEXT (per PSID) ----
// context:<psid> = { stage: "courseSelection"|"materialSelection"|"detail", selectedCourse: "CSE220", page: 1 }
export async function getContext(psid) {
  const key = `context:${psid}`;
  const result = await redisCommand("get", key);
  const json = result?.result;
  const val = json ? JSON.parse(json) : null;
  logRedis("getContext", { key, exists: !!val });
  return val;
}

export async function setContext(psid, ctx) {
  const key = `context:${psid}`;
  const finalCtx = { stage: "courseSelection", page: 1, selectedCourse: null, ...ctx };
  await redisCommand("set", key, JSON.stringify(finalCtx));
  logRedis("setContext", { key, ctx: finalCtx });
  return finalCtx;
}

export async function resetContext(psid) {
  const key = `context:${psid}`;
  await redisCommand("set", key, "");
  logRedis("resetContext", { key });
}
