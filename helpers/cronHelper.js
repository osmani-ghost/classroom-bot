import {
  fetchCourses,
  fetchAssignments,
  fetchStudents,
  isTurnedIn,
} from "./classroomHelper.js";
import { sendMessageToGoogleUser } from "./messengerHelper.js";
import { reminderAlreadySent, markReminderSent } from "./redisHelper.js";

export async function checkReminders() {
  console.log("⏰ Cron job started...");
  const courses = await fetchCourses();
  const now = new Date();

  for (const course of courses) {
    const students = await fetchStudents(course.id);
    const assignments = await fetchAssignments(course.id);

    for (const a of assignments) {
      if (!a.dueDate) continue;

      const due = new Date(
        a.dueDate.year,
        a.dueDate.month - 1,
        a.dueDate.day,
        a.dueDate.hours || 23,
        a.dueDate.minutes || 59
      );

      const diffHours = (due.getTime() - now.getTime()) / (1000 * 60 * 60);
      if (diffHours < 0) continue; // Skip overdue assignments

      const reminders = ["24h", "12h", "6h", "2h"];
      for (const student of students) {
        const googleId = student.userId;
        const turnedIn = await isTurnedIn(course.id, a.id, googleId);
        if (turnedIn) continue;

        for (const r of reminders) {
          const h = parseInt(r.replace("h", ""));
          if (
            diffHours <= h &&
            !(await reminderAlreadySent(a.id, googleId, r))
          ) {
            console.log(
              `➡️ Sending reminder (${r}) for "${a.title}" to student ${googleId}`
            );

            await sendMessageToGoogleUser(
              googleId,
              `📝 Reminder: Your assignment "${a.title}" is due in about ${r} for the course ${course.name}.`
            );

            await markReminderSent(a.id, googleId, r);
          }
        }
      }
    }
  }

  console.log("✅ Cron job finished.");
}
