import { fetchCourses, fetchAssignments, fetchStudents, isTurnedIn, fetchAnnouncements, fetchMaterials } from "./classroomHelper.js";
import { sendMessageToGoogleUser } from "./messengerHelper.js";
import { reminderAlreadySent, markReminderSent, getLastCheckedTime, setLastCheckedTime } from "./redisHelper.js";

// নতুন কনটেন্ট (পোস্ট ও ম্যাটেরিয়াল) চেক করার ফাংশন
async function checkNewContent() {
    console.log("📢 Checking for new content (Announcements & Materials)...");
    const courses = await fetchCourses();

    for (const course of courses) {
        const lastChecked = await getLastCheckedTime(course.id);
        
        const announcements = await fetchAnnouncements(course.id);
        const materials = await fetchMaterials(course.id);

        const allContent = [...announcements, ...materials]
            .sort((a, b) => new Date(a.updateTime) - new Date(b.updateTime)); // পুরনো থেকে নতুন সাজানো

        let newestContentTime = lastChecked;
        
        for (const content of allContent) {
            if (!lastChecked || new Date(content.updateTime) > new Date(lastChecked)) {
                console.log(`✨ New content found in ${course.name}: "${content.title || content.text}"`);
                const students = await fetchStudents(course.id);

                for (const student of students) {
                    const message = content.title
                        ? `📚 New Material in ${course.name}:\n"${content.title}"`
                        : `📢 New Announcement in ${course.name}:\n"${content.text}"`;
                    await sendMessageToGoogleUser(student.userId, message);
                }
                newestContentTime = content.updateTime;
            }
        }
        
        if (newestContentTime) {
            await setLastCheckedTime(course.id, newestContentTime);
        }
    }
}

// অ্যাসাইনমেন্ট রিমাইন্ডার চেক করার ফাংশন (আপডেট করা)
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

      if (diffHours < 0 || diffHours > 24) continue;

      const reminders = [1, 2, 6, 12, 24]; // ১ ঘণ্টাও যোগ করা হয়েছে
      for (const student of students) {
        const googleId = student.userId;
        const turnedIn = await isTurnedIn(course.id, a.id, googleId);
        if (turnedIn) continue;

        for (const h of reminders) {
          if (diffHours <= h && !(await reminderAlreadySent(a.id, googleId, `${h}h`))) {
            await sendMessageToGoogleUser(googleId, `📝 Reminder: Your assignment "${a.title}" is due in about ${h} hours for ${course.name}.`);
            await markReminderSent(a.id, googleId, `${h}h`);
            break; 
          }
        }
      }
    }
  }
}

// মূল ক্রন ফাংশন যা দুটি কাজই করবে
export async function runCronJobs() {
    await checkReminders();
    await checkNewContent();
}