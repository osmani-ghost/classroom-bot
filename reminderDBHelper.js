import fetch from "node-fetch";

const REDIS_URL = process.env.REDIS_REST_URL;
const REDIS_TOKEN = process.env.REDIS_REST_TOKEN;

async function redisGet(key) {
  const res = await fetch(`${REDIS_URL}/${key}`, {
    headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
  });
  const text = await res.text();
  if (!text || text === "null") return null;
  return JSON.parse(text);
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

export async function reminderAlreadySent(assignmentId, studentId, hours) {
  const key = `${assignmentId}:${studentId}`;
  const record = (await redisGet(key)) || { remindersSent: [] };
  return record.remindersSent.includes(hours);
}

export async function markReminderSent(assignmentId, studentId, hours) {
  const key = `${assignmentId}:${studentId}`;
  let record = (await redisGet(key)) || { remindersSent: [] };
  record.remindersSent.push(hours);
  await redisSet(key, record);
}
