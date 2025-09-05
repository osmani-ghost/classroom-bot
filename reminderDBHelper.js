import fs from "fs";

const DB_FILE = "./reminderDB.json";

export function loadDB() {
  if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, "[]");
  const data = fs.readFileSync(DB_FILE, "utf8");
  return JSON.parse(data);
}

export function saveDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

export function reminderAlreadySent(assignmentId, studentId, hours) {
  const db = loadDB();
  const record = db.find(
    (r) => r.assignmentId === assignmentId && r.studentId === studentId
  );
  return record ? record.remindersSent.includes(hours) : false;
}

export function markReminderSent(assignmentId, studentId, hours) {
  const db = loadDB();
  let record = db.find(
    (r) => r.assignmentId === assignmentId && r.studentId === studentId
  );
  if (!record) {
    record = { assignmentId, studentId, remindersSent: [] };
    db.push(record);
  }
  record.remindersSent.push(hours);
  saveDB(db);
}
