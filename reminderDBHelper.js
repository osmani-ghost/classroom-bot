export async function reminderAlreadySent(assignmentId, studentId, hours) {
  const key = `${assignmentId}:${studentId}`;
  let record;
  try {
    record = (await redisGet(key)) || { remindersSent: [] }; // যদি null আসে, default empty array
  } catch (err) {
    console.error("❌ Redis GET failed for key:", key, err);
    record = { remindersSent: [] };
  }

  // Safety check
  if (!record.remindersSent) record.remindersSent = [];

  return record.remindersSent.includes(hours);
}

export async function markReminderSent(assignmentId, studentId, hours) {
  const key = `${assignmentId}:${studentId}`;
  let record;
  try {
    record = (await redisGet(key)) || { remindersSent: [] };
  } catch (err) {
    console.error("❌ Redis GET failed for key:", key, err);
    record = { remindersSent: [] };
  }

  if (!record.remindersSent) record.remindersSent = [];

  if (!record.remindersSent.includes(hours)) record.remindersSent.push(hours);

  try {
    await redisSet(key, record);
  } catch (err) {
    console.error("❌ Redis SET failed for key:", key, err);
  }
}
