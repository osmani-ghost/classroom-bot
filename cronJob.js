import { fetchCourses, fetchAssignments, fetchStudents, isTurnedIn } from "./classroomHelper.js";
import { sendMessage } from "./messengerHelper.js";
import { reminderAlreadySent, markReminderSent } from "./reminderDBHelper.js";

export async function checkReminders(fbUserIds = []) {
  console.log("⏰ Cron job started...");
  const courses = await fetchCourses();
  const now = new Date();
  console.log(`📚 Total courses fetched: ${courses.length}`);

  for (const course of courses) {
    const students = await fetchStudents(course.id);
    const assignments = await fetchAssignments(course.id);

    for (const a of assignments) {
      if (!a.dueDate) continue;

      const due = new Date(
        a.dueDate.year,
        a.dueDate.month - 1,
        a.dueDate.day,
        a.dueDate.hours || 0,
        a.dueDate.minutes || 0
      );
      const diffHours = (due - now) / 1000 / 60 / 60;

      const reminders = ["24h", "12h", "6h", "2h"];

      for (const student of students) {
        const turnedIn = await isTurnedIn(course.id, a.id, student.userId);
        if (turnedIn) continue;

        for (const r of reminders) {
          const h = parseInt(r.replace("h", ""));
          if (diffHours <= h && !(await reminderAlreadySent(a.id, student.userId, r))) {
            // Send to all registered FB IDs
            for (const fbId of fbUserIds) {
              await sendMessage(
                fbId,
                `📝 Reminder: "${a.title}" is due in ${r} for ${course.name}`
              );
            }
            await markReminderSent(a.id, student.userId, r);
          }
        }
      }
    }
  }

  console.log("✅ Cron job finished.");
}
