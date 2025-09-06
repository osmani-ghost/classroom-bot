import { fetchCourses, fetchAssignments, fetchStudents, isTurnedIn, fetchAnnouncements, fetchMaterials } from "./classroomHelper.js";
import { sendMessageToGoogleUser } from "./messengerHelper.js";
import { reminderAlreadySent, markReminderSent, getLastCheckedTime, setLastCheckedTime } from "./redisHelper.js";

// নতুন কনটেন্ট (পোস্ট ও ম্যাটেরিয়াল) চেক করার ফাংশন
async function checkNewContent() {
    console.log("📢 Checking for new content (Announcements & Materials)...");
    const courses = await fetchCourses();

    for (const course of courses) {
        const lastCheckedString = await getLastCheckedTime(course.id);
        const lastCheckedDate = lastCheckedString ? new Date(lastCheckedString) : null;
        
        const announcements = await fetchAnnouncements(course.id);
        const materials = await fetchMaterials(course.id);

        const allContent = [...announcements, ...materials]
            .sort((a, b) => new Date(b.updateTime) - new Date(a.updateTime)); // নতুন থেকে পুরনো সাজানো

        if (allContent.length === 0) continue;

        const latestContentTime = allContent[0].updateTime;

        // প্রথমবার চললে, শুধু সর্বশেষ সময় সেভ করবে
        if (!lastCheckedDate) {
            await setLastCheckedTime(course.id, latestContentTime);
            console.log(`First run for ${course.name}. Initializing last checked time.`);
            continue;
        }

        // পরেরবার থেকে শুধু নতুন কনটেন্ট পাঠাবে
        for (const content of allContent) {
            if (new Date(content.updateTime) > lastCheckedDate) {
                console.log(`✨ New content found in ${course.name}: "${content.title || content.text}"`);
                const students = await fetchStudents(course.id);
                for (const student of students) {
                    const message = content.title
                        ? `📚 New Material in ${course.name}:\n"${content.title}"`
                        : `📢 New Announcement in ${course.name}:\n"${content.text}"`;
                    await sendMessageToGoogleUser(student.userId, message);
                }
            } else {
                break;
            }
        }
        
        await setLastCheckedTime(course.id, latestContentTime);
    }
}

// অ্যাসাইনমেন্ট রিমাইন্ডার চেক করার ফাংশন
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

      if (diffHours < 0 || diffHours > 24.5) continue;

      const reminders = [1, 2, 6, 12, 24]; 
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