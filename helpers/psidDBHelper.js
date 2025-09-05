import fetch from "node-fetch";

const REDIS_URL = process.env.REDIS_REST_URL;
const REDIS_TOKEN = process.env.REDIS_REST_TOKEN;

async function redisGet(key) {
  const res = await fetch(`${REDIS_URL}/${key}`, {
    headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
  });
  if (!res.ok) return null;
  const text = await res.text();
  return text && text !== "null" ? JSON.parse(text) : null;
}

async function redisSet(key, value) {
  await fetch(`${REDIS_URL}/${key}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });
}

// Map Classroom userId to Messenger PSID
export async function registerPSID(classroomUserId, psid) {
  await redisSet(`psid:${classroomUserId}`, { psid });
}

// Get PSID from Classroom userId
export async function getPSID(classroomUserId) {
  const data = await redisGet(`psid:${classroomUserId}`);
  return data?.psid || null;
}

// Get all registered PSIDs
export async function getAllPSIDs() {
  const keysRes = await fetch(`${REDIS_URL}?scan=psid:*`, {
    headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
  });
  const keys = (await keysRes.json()) || [];
  const psids = [];
  for (const k of keys) {
    const d = await redisGet(k);
    if (d?.psid) psids.push(d.psid);
  }
  return psids;
}
