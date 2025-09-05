import { fetchCourses, fetchAssignments, fetchStudents, isTurnedIn } from "./classroomHelper.js";
import { sendMessage } from "./messengerHelper.js";
import { reminderAlreadySent, markReminderSent } from "./reminderDBHelper.js";

export async function checkReminders() {
  try {
    const now = new Date();
    const courses = await fetchCourses();

    for (const course of courses) {
      const students = await fetchStudents(course.id);
      const assignments = await fetchAssignments(course.id);

      for (const a of assignments) {
        if (!a.dueDate) continue;

        // Convert to UTC
        const due = new Date(Date.UTC(
          a.dueDate.year,
          a.dueDate.month - 1,
          a.dueDate.day,
          a.dueDate.hours || 0,
          a.dueDate.minutes || 0
        ));

        const diffHours = (due - now) / 1000 / 60 / 60;
        const reminders = ["24h", "12h", "6h", "2h"];

        for (const student of students) {
          const turnedIn = await isTurnedIn(course.id, a.id, student.userId);
          if (turnedIn) continue; // skip reminder if submitted

          for (const r of reminders) {
            const h = parseInt(r.replace("h", ""));
            if (diffHours <= h && !(await reminderAlreadySent(a.id, student.userId, r))) {
              await sendMessage(student.userId, `📝 Reminder: "${a.title}" is due in ${r} for ${course.name}`);
              await markReminderSent(a.id, student.userId, r);
            }
          }
        }
      }
    }
    console.log("⏰ Cron job completed successfully");
  } catch (err) {
    console.error("❌ Cron job failed:", err);
  }
}
