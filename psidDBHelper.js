import fetch from "node-fetch";

const REDIS_URL = process.env.REDIS_REST_URL;
const REDIS_TOKEN = process.env.REDIS_REST_TOKEN;

async function redisGet(key) {
  const res = await fetch(`${REDIS_URL}/${key}`, {
    headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
  });
  if (!res.ok) return null;
  const text = await res.text();
  if (!text || text === "null") return null;
  try { return JSON.parse(text); } catch { return null; }
}

async function redisSet(key, value) {
  await fetch(`${REDIS_URL}/${key}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${REDIS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(value),
  });
}

// Save PSID for a studentId
export async function registerPSID(studentId, psid) {
  const key = `psid:${studentId}`;
  await redisSet(key, { psid });
}

// Get all registered PSIDs
export async function getAllPSIDs() {
  const key = `psid:all`;
  const record = (await redisGet(key)) || { psids: [] };
  return record.psids;
}

export async function addPSIDToAll(psid) {
  const key = `psid:all`;
  let record = (await redisGet(key)) || { psids: [] };
  if (!record.psids.includes(psid)) record.psids.push(psid);
  await redisSet(key, record);
}
