import fetch from "node-fetch";

const REDIS_URL = process.env.REDIS_REST_URL;
const REDIS_TOKEN = process.env.REDIS_REST_TOKEN;

// Redis GET
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

// Redis SET
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

// Check if reminder already sent
export async function reminderAlreadySent(assignmentId, studentId, hours) {
  const key = `${assignmentId}:${studentId}`;
  const record = (await redisGet(key)) || { remindersSent: [] };
  // ensure remindersSent is always an array
  if (!Array.isArray(record.remindersSent)) record.remindersSent = [];
  return record.remindersSent.includes(hours);
  console.log("Checking Redis for key:", key);

}

// Mark reminder as sent
export async function markReminderSent(assignmentId, studentId, hours) {
  const key = `${assignmentId}:${studentId}`;
  let record = (await redisGet(key)) || { remindersSent: [] };
  if (!Array.isArray(record.remindersSent)) record.remindersSent = [];
  record.remindersSent.push(hours);
  await redisSet(key, record);
  console.log("Checking Redis for key:", key);

}
