import { fetchCourses, fetchAssignments, isTurnedIn } from "./classroomHelper.js";
import { sendMessage } from "./messengerHelper.js";
import { reminderAlreadySent, markReminderSent } from "./reminderDBHelper.js";

// STUDENTS array
const STUDENTS = [
  { senderId: "24423234430632948", courses: ["769869403822"] },
];

export async function checkReminders() {
  const courses = await fetchCourses();
  const now = new Date();

  for (const student of STUDENTS) {
    for (const courseId of student.courses) {
      const course = courses.find(c => c.id === courseId);
      if (!course) continue;

      const assignments = await fetchAssignments(courseId);

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

        // ✅ Check submission status
        const turnedIn = await isTurnedIn(courseId, a.id, student.senderId);
        if (turnedIn) continue; // skip reminder if already submitted

        // Reminder schedule
        const reminders = ["24h", "12h", "6h", "2h"];
        for (const r of reminders) {
          const h = parseInt(r.replace("h", ""));
          if (diffHours <= h && !await reminderAlreadySent(a.id, student.senderId, r)) {
            await sendMessage(
              student.senderId,
              `📝 Reminder: "${a.title}" is due in ${r} for ${course.name}`
            );
            await markReminderSent(a.id, student.senderId, r);
          }
        }
      }
    }
  }
}
