import fetch from "node-fetch";

const REDIS_URL = process.env.REDIS_REST_URL;
const REDIS_TOKEN = process.env.REDIS_REST_TOKEN;

async function redisCommand(command, ...args) {
  if (!REDIS_URL || !REDIS_TOKEN) {
    console.error("❌ Redis URL or Token is missing.");
    return null;
  }
  const response = await fetch(`${REDIS_URL}/${command}/${args.join("/")}`, {
    headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
  });
  if (!response.ok) return null;
  return response.json();
}

// ---- ম্যাপিং ফাংশন ----
export async function getPsidForGoogleId(googleId) {
  const key = `mapping:google:${googleId}`;
  const result = await redisCommand("get", key);
  return result ? JSON.parse(result.result) : null;
}

export async function mapGoogleIdToPsid(googleId, psid) {
  const googleKey = `mapping:google:${googleId}`;
  await redisCommand("set", googleKey, JSON.stringify({ psid }));
  const psidKey = `mapping:psid:${psid}`;
  await redisCommand("set", psidKey, JSON.stringify({ googleId }));
  console.log(`✅ Mapping saved: Google ID ${googleId} <-> PSID ${psid}`);
}

export async function isPsidMapped(psid) {
    const key = `mapping:psid:${psid}`;
    const result = await redisCommand('get', key);
    return !!(result && result.result);
}

// ---- রিমাইন্ডার ট্র্যাকিং ফাংশন ----
export async function reminderAlreadySent(assignmentId, googleId, hours) {
  const key = `reminder:${assignmentId}:${googleId}`;
  const result = await redisCommand("get", key);
  const recordString = result ? result.result : null;
  const record = recordString ? JSON.parse(recordString) : { remindersSent: [] };
  return record.remindersSent.includes(hours);
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
}

// ---- নতুন পোস্ট ট্র্যাকিং ফাংশন ----
export async function getLastCheckedTime(courseId) {
  const key = `lastpost:${courseId}`;
  const result = await redisCommand("get", key);
  return result ? result.result : null;
}

export async function setLastCheckedTime(courseId, time) {
  const key = `lastpost:${courseId}`;
  await redisCommand("set", key, time);
}