import { fetchCourses, fetchAssignments, fetchStudents, isTurnedIn } from "./classroomHelper.js";
import { sendMessage } from "./messengerHelper.js";
import { reminderAlreadySent, markReminderSent, mapClassroomToPSID } from "./reminderDBHelper.js";

export async function checkReminders() {
  console.log("⏰ Cron job started...");
  const courses = await fetchCourses();
  const now = new Date();
  const psidMap = await mapClassroomToPSID();

  for (const course of courses) {
    const students = await fetchStudents(course.id);
    const assignments = await fetchAssignments(course.id);

    for (const assignment of assignments) {
      if (!assignment.dueDate) continue;

      const due = new Date(
        assignment.dueDate.year,
        assignment.dueDate.month - 1,
        assignment.dueDate.day,
        assignment.dueDate.hours || 0,
        assignment.dueDate.minutes || 0
      );

      const diffHours = (due - now) / 1000 / 60 / 60;
      const reminders = ["24h", "12h", "6h", "2h"];

      for (const student of students) {
        const turnedIn = await isTurnedIn(course.id, assignment.id, student.userId);
        if (turnedIn) continue;

        const psid = psidMap[student.userId];
        if (!psid) continue;

        for (const r of reminders) {
          const h = parseInt(r.replace("h", ""));
          if (diffHours <= h && !(await reminderAlreadySent(assignment.id, student.userId, r))) {
            await sendMessage(psid, `📝 Reminder: "${assignment.title}" is due in ${r} for ${course.name}`);
            await markReminderSent(assignment.id, student.userId, r);
          }
        }
      }
    }
  }
  console.log("✅ Cron job finished.");
}
