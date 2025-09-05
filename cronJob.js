import { fetchCourses, fetchAssignments, fetchStudents, isTurnedIn } from "./classroomHelper.js";
import { sendMessage } from "./messengerHelper.js";
import { reminderAlreadySent, markReminderSent } from "./reminderDBHelper.js";

export async function checkReminders() {
  console.log("⏰ Cron job started...");
  const courses = await fetchCourses();
  const now = new Date();

  console.log(`📚 Total courses fetched: ${courses.length}`);

  for (const course of courses) {
    console.log(`\n🔹 Course: ${course.name} (ID: ${course.id})`);

    const students = await fetchStudents(course.id);
    console.log(`👥 Students in ${course.name}: ${students.length}`);

    const assignments = await fetchAssignments(course.id);
    console.log(`📌 Assignments in ${course.name}: ${assignments.length}`);

    for (const a of assignments) {
      if (!a.dueDate) {
        console.log(`⏭ Skipping "${a.title}" (no due date)`);
        continue;
      }

      const due = new Date(
        a.dueDate.year,
        a.dueDate.month - 1,
        a.dueDate.day,
        a.dueDate.hours || 0,
        a.dueDate.minutes || 0
      );

      const diffHours = (due - now) / 1000 / 60 / 60;
      console.log(`📌 Assignment: "${a.title}" | Due: ${due} | Hours left: ${diffHours.toFixed(2)}`);

      for (const student of students) {
        const turnedIn = await isTurnedIn(course.id, a.id, student.userId);
        console.log(`👤 Student: ${student.userId} | Turned in: ${turnedIn}`);

        if (turnedIn) {
          console.log(`✅ Skipping ${student.userId}, already turned in.`);
          continue;
        }

        const reminders = ["24h", "12h", "6h", "2h"];
        for (const r of reminders) {
          const h = parseInt(r.replace("h", ""));
          if (diffHours <= h && !(await reminderAlreadySent(a.id, student.userId, r))) {
            console.log(`➡️ Sending reminder (${r}) for "${a.title}" to student ${student.userId}`);
            await sendMessage(
              student.userId,
              `📝 Reminder: "${a.title}" is due in ${r} for ${course.name}`
            );
            await markReminderSent(a.id, student.userId, r);
          }
        }
      }
    }
  }

  console.log("✅ Cron job finished.");
}
