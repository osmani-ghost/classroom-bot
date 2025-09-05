import { redisGet, redisSet } from "./helpers/reminderDBHelper.js";

const STUDENTS_KEY = "registered_students";

export async function registerStudent(senderId) {
  let list = (await redisGet(STUDENTS_KEY)) || [];
  if (!list.includes(senderId)) {
    list.push(senderId);
    await redisSet(STUDENTS_KEY, list);
  }
}

export async function getAllStudents() {
  return (await redisGet(STUDENTS_KEY)) || [];
}
