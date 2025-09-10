// classroom/helpers/redisHelper.js
// Minimal Upstash REST Redis helper for required operations (set/get/keys)
// Exposes user mapping, reminder tracking, last checked times, and per-PSID context

import fetch from "node-fetch";

const REDIS_URL = process.env.REDIS_REST_URL;
const REDIS_TOKEN = process.env.REDIS_REST_TOKEN;

function log(action, payload) {
  console.log(`[Redis][${action}]`, payload || "");
}

async function redisGet(key) {
  if (!REDIS_URL || !REDIS_TOKEN) {
    throw new Error("Missing REDIS_REST_URL or REDIS_REST_TOKEN");
  }
  const url = `${REDIS_URL}/get/${encodeURIComponent(key)}`;
  log("GET", { key });
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${REDIS_TOKEN}` } });
  const text = await resp.text();
  try {
    const json = JSON.parse(text);
    return json;
  } catch {
    return { result: text };
  }
}

async function redisSet(key, value) {
  if (!REDIS_URL || !REDIS_TOKEN) {
    throw new Error("Missing REDIS_REST_URL or REDIS_REST_TOKEN");
  }
  const url = `${REDIS_URL}/set/${encodeURIComponent(key)}`;
  log("SET", { key, preview: String(value).slice(0, 200) });
  const resp = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
    body: value,
  });
  const text = await resp.text();
  try {
    return JSON.parse(text);
  } catch {
    return { result: text };
  }
}

async function redisKeys(pattern) {
  if (!REDIS_URL || !REDIS_TOKEN) {
    throw new Error("Missing REDIS_REST_URL or REDIS_REST_TOKEN");
  }
  const url = `${REDIS_URL}/keys/${encodeURIComponent(pattern)}`;
  log("KEYS", { pattern });
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${REDIS_TOKEN}` } });
  const text = await resp.text();
  try {
    return JSON.parse(text);
  } catch {
    return { result: text };
  }
}

// ---- Users ----
export async function saveUser(googleId, userData) {
  log("saveUser", { googleId, psid: userData?.psid });
  await redisSet(`user:google:${googleId}`, JSON.stringify(userData));
  await redisSet(`user:psid:${userData.psid}`, JSON.stringify({ googleId }));
}

export async function getUser(googleId) {
  const r = await redisGet(`user:google:${googleId}`);
  const val = r?.result;
  log("getUser", { googleId, found: !!val });
  return val ? JSON.parse(val) : null;
}

export async function getAllUserGoogleIds() {
  const r = await redisKeys("user:google:*");
  const list = Array.isArray(r?.result) ? r.result : [];
  const ids = list.map((k) => k.replace("user:google:", ""));
  log("getAllUserGoogleIds", { count: ids.length });
  return ids;
}

export async function isPsidRegistered(psid) {
  const r = await redisGet(`user:psid:${psid}`);
  const found = !!(r && r.result);
  log("isPsidRegistered", { psid, found });
  return found;
}

export async function getGoogleIdByPsid(psid) {
  const r = await redisGet(`user:psid:${psid}`);
  const val = r?.result;
  const parsed = val ? JSON.parse(val) : null;
  log("getGoogleIdByPsid", { psid, hasMapping: !!parsed });
  return parsed; // { googleId }
}

// ---- Reminder tracking ----
export async function reminderAlreadySent(assignmentId, googleId, tag) {
  const key = `reminder:${assignmentId}:${googleId}`;
  const r = await redisGet(key);
  const json = r?.result ? JSON.parse(r.result) : { remindersSent: [] };
  const exists = Array.isArray(json.remindersSent) && json.remindersSent.includes(tag);
  log("reminderAlreadySent", { key, tag, exists });
  return exists;
}

export async function markReminderSent(assignmentId, googleId, tag) {
  const key = `reminder:${assignmentId}:${googleId}`;
  const r = await redisGet(key);
  const json = r?.result ? JSON.parse(r.result) : { remindersSent: [] };
  if (!json.remindersSent.includes(tag)) {
    json.remindersSent.push(tag);
  }
  await redisSet(key, JSON.stringify(json));
  log("markReminderSent", { key, tag, final: json });
}

// ---- Last-checked for content (announcements/materials) ----
export async function getLastCheckedTime(courseId) {
  const key = `lastpost:${courseId}`;
  const r = await redisGet(key);
  const ts = r?.result || null;
  log("getLastCheckedTime", { key, ts });
  return ts;
}
export async function setLastCheckedTime(courseId, timeStr) {
  const key = `lastpost:${courseId}`;
  await redisSet(key, timeStr);
  log("setLastCheckedTime", { key, timeStr });
}

// ---- Last-checked for assignments posted ----
export async function getLastCheckedAssignmentsTime(courseId) {
  const key = `lastassign:${courseId}`;
  const r = await redisGet(key);
  const ts = r?.result || null;
  log("getLastCheckedAssignmentsTime", { key, ts });
  return ts;
}
export async function setLastCheckedAssignmentsTime(courseId, timeStr) {
  const key = `lastassign:${courseId}`;
  await redisSet(key, timeStr);
  log("setLastCheckedAssignmentsTime", { key, timeStr });
}

// ---- Context per PSID ----
export async function getContext(psid) {
  const key = `context:${psid}`;
  const r = await redisGet(key);
  const val = r?.result ? JSON.parse(r.result) : null;
  log("getContext", { key, exists: !!val });
  return val;
}

export async function setContext(psid, ctx) {
  const key = `context:${psid}`;
  const final = { stage: "courseSelection", page: 1, selectedCourse: null, flow: null, ...ctx };
  await redisSet(key, JSON.stringify(final));
  log("setContext", { key, ctx: final });
  return final;
}

export async function resetContext(psid) {
  const key = `context:${psid}`;
  await redisSet(key, "");
  log("resetContext", { key });
}
