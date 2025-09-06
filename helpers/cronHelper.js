import { fetchCourses, fetchAssignments, fetchStudents, isTurnedIn, fetchAnnouncements } from "./classroomHelper.js";
import { sendMessageToGoogleUser } from "./messengerHelper.js";
import { reminderAlreadySent, markReminderSent, getLastCheckedPostTime, setLastCheckedPostTime } from "./redisHelper.js";

async function checkReminders() {
  console.log("⏰ Checking for assignment reminders...");
  const courses = await fetchCourses();
  const now = new Date();

  for (const course of courses) {
    const students = await fetchStudents(course.id);
    const assignments = await fetchAssignments(course.id);

    for (const a of assignments) {
      if (!a.dueDate) continue;

      const due = new Date(a.dueDate.year, a.dueDate.month - 1, a.dueDate.day, a.dueDate.hours || 23, a.dueDate.minutes || 59);
      const diffHours = (due.getTime() - now.getTime()) / (1000 * 60 * 60);
      if (diffHours < 0 || diffHours > 24) continue; // শুধু আগামী ২৪ ঘণ্টার অ্যাসাইনমেন্ট চেক করবে

      const reminders = [2, 6, 12, 24]; // ছোট থেকে বড় চেক করবে
      for (const student of students) {
        const googleId = student.userId;
        const turnedIn = await isTurnedIn(course.id, a.id, googleId);
        if (turnedIn) continue;

        for (const h of reminders) {
          if (diffHours <= h && !(await reminderAlreadySent(a.id, googleId, `${h}h`))) {
            await sendMessageToGoogleUser(googleId, `📝 Reminder: Your assignment "${a.title}" is due in about ${h} hours for ${course.name}.`);
            await markReminderSent(a.id, googleId, `${h}h`);
            break; // একটি রিমাইন্ডার পাঠানোর পর পরের গুলো চেক করবে না
          }
        }
      }
    }
  }
}

async function checkNewPosts() {
    console.log("📢 Checking for new teacher posts...");
    const courses = await fetchCourses();

    for (const course of courses) {
        const lastChecked = await getLastCheckedPostTime(course.id);
        const announcements = await fetchAnnouncements(course.id);

        if (announcements.length > 0) {
            const latestPost = announcements[0]; // যেহেতু নতুন পোস্ট আগে আসে
            if (!lastChecked || new Date(latestPost.updateTime) > new Date(lastChecked)) {
                
                console.log(`✨ New post found in ${course.name}: "${latestPost.text}"`);
                const students = await fetchStudents(course.id);

                for (const student of students) {
                    await sendMessageToGoogleUser(student.userId, `📢 New announcement in ${course.name}:\n\n"${latestPost.text}"`);
                }
                
                await setLastCheckedPostTime(course.id, latestPost.updateTime);
            }
        }
    }
}

export async function runCronJobs() {
    await checkReminders();
    await checkNewPosts();
}