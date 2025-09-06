import fetch from "node-fetch";

const REDIS_URL = process.env.REDIS_REST_URL;
const REDIS_TOKEN = process.env.REDIS_REST_TOKEN;

async function redisCommand(command, ...args) {
  if (!REDIS_URL || !REDIS_TOKEN) {
    console.error("❌ Redis URL or Token is missing in environment variables.");
    return null;
  }
  const response = await fetch(`${REDIS_URL}/${command}/${args.join('/')}`, {
    headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
  });
  if (!response.ok) return null;
  return response.json();
}

// ---- ম্যাপিং ফাংশন ----
export async function getPsidForGoogleId(googleId) {
  const key = `mapping:google:${googleId}`;
  const result = await redisCommand('get', key);
  return result ? JSON.parse(result.result) : null;
}

export async function mapGoogleIdToPsid(googleId, psid) {
  const key = `mapping:google:${googleId}`;
  await redisCommand('set', key, JSON.stringify({ psid }));
  console.log(`✅ Mapping saved: Google ID ${googleId} -> PSID ${psid}`);
}

// ---- রিমাইন্ডার ট্র্যাকিং ফাংশন ----
export async function reminderAlreadySent(assignmentId, googleId, hours) {
  const key = `reminder:${assignmentId}:${googleId}`;
  const result = await redisCommand('get', key);
  const record = result ? JSON.parse(result.result) : { remindersSent: [] };
  return record.remindersSent.includes(hours);
}

export async function markReminderSent(assignmentId, googleId, hours) {
  const key = `reminder:${assignmentId}:${googleId}`;
  const result = await redisCommand('get', key);
  let record = result ? JSON.parse(result.result) : { remindersSent: [] };
  if (!record.remindersSent.includes(hours)) {
    record.remindersSent.push(hours);
  }
  await redisCommand('set', key, JSON.stringify(record));
}