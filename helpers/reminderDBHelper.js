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
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
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

// Reminders tracking
export async function reminderAlreadySent(assignmentId, studentId, hours) {
  const key = `reminder:${assignmentId}:${studentId}`;
  const record = (await redisGet(key)) || { remindersSent: [] };
  if (!Array.isArray(record.remindersSent)) record.remindersSent = [];
  return record.remindersSent.includes(hours);
}

export async function markReminderSent(assignmentId, studentId, hours) {
  const key = `reminder:${assignmentId}:${studentId}`;
  const record = (await redisGet(key)) || { remindersSent: [] };
  if (!Array.isArray(record.remindersSent)) record.remindersSent = [];
  record.remindersSent.push(hours);
  await redisSet(key, record);
}

// PSID ↔ Classroom mapping
export async function mapClassroomToPSID() {
  const keysRes = await fetch(`${REDIS_URL}?scan=1`, {
    headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
  });
  const data = await keysRes.json();
  const mapping = {};
  for (const key of data.keys || []) {
    const value = await redisGet(key);
    if (value?.psid && value?.classroomId) {
      mapping[value.classroomId] = value.psid;
    }
  }
  return mapping;
}
