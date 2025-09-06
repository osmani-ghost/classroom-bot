// import { fetchCourses, fetchAssignments, fetchStudents, isTurnedIn, fetchAnnouncements, fetchMaterials } from "./classroomHelper.js";
// import { sendMessageToGoogleUser } from "./messengerHelper.js";
// import { reminderAlreadySent, markReminderSent, getLastCheckedTime, setLastCheckedTime } from "./redisHelper.js";

// // নতুন কনটেন্ট (পোস্ট ও ম্যাটেরিয়াল) চেক করার ফাংশন
// async function checkNewContent() {
//     console.log("📢 Checking for new content (Announcements & Materials)...");
//     const courses = await fetchCourses();

//     for (const course of courses) {
//         const lastChecked = await getLastCheckedTime(course.id);
        
//         const announcements = await fetchAnnouncements(course.id);
//         const materials = await fetchMaterials(course.id);

//         const allContent = [...announcements, ...materials]
//             .sort((a, b) => new Date(a.updateTime) - new Date(b.updateTime)); // পুরনো থেকে নতুন সাজানো

//         let newestContentTime = lastChecked;
        
//         for (const content of allContent) {
//             if (!lastChecked || new Date(content.updateTime) > new Date(lastChecked)) {
//                 console.log(`✨ New content found in ${course.name}: "${content.title || content.text}"`);
//                 const students = await fetchStudents(course.id);

//                 for (const student of students) {
//                     const message = content.title
//                         ? `📚 New Material in ${course.name}:\n"${content.title}"`
//                         : `📢 New Announcement in ${course.name}:\n"${content.text}"`;
//                     await sendMessageToGoogleUser(student.userId, message);
//                 }
//                 newestContentTime = content.updateTime;
//             }
//         }
        
//         if (newestContentTime) {
//             await setLastCheckedTime(course.id, newestContentTime);
//         }
//     }
// }

// // অ্যাসাইনমেন্ট রিমাইন্ডার চেক করার ফাংশন (আপডেট করা)
// async function checkReminders() {
//   console.log("⏰ Checking for assignment reminders...");
//   const courses = await fetchCourses();
//   const now = new Date();

//   for (const course of courses) {
//     const students = await fetchStudents(course.id);
//     const assignments = await fetchAssignments(course.id);

//     for (const a of assignments) {
//       if (!a.dueDate) continue;

//       const due = new Date(a.dueDate.year, a.dueDate.month - 1, a.dueDate.day, a.dueDate.hours || 23, a.dueDate.minutes || 59);
//       const diffHours = (due.getTime() - now.getTime()) / (1000 * 60 * 60);

//       if (diffHours < 0 || diffHours > 24) continue;

//       const reminders = [1, 2, 6, 12, 24]; // ১ ঘণ্টাও যোগ করা হয়েছে
//       for (const student of students) {
//         const googleId = student.userId;
//         const turnedIn = await isTurnedIn(course.id, a.id, googleId);
//         if (turnedIn) continue;

//         for (const h of reminders) {
//           if (diffHours <= h && !(await reminderAlreadySent(a.id, googleId, `${h}h`))) {
//             await sendMessageToGoogleUser(googleId, `📝 Reminder: Your assignment "${a.title}" is due in about ${h} hours for ${course.name}.`);
//             await markReminderSent(a.id, googleId, `${h}h`);
//             break; 
//           }
//         }
//       }
//     }
//   }
// }

// // মূল ক্রন ফাংশন যা দুটি কাজই করবে
// export async function runCronJobs() {
//     await checkReminders();
//     await checkNewContent();
// }

import { fetchCourses, fetchAssignments, fetchStudents, isTurnedIn, fetchAnnouncements, fetchMaterials } from "./classroomHelper.js";
import { sendMessageToGoogleUser } from "./messengerHelper.js";
import { reminderAlreadySent, markReminderSent, getLastCheckedTime, setLastCheckedTime } from "./redisHelper.js";

// নতুন কনটেন্ট (পোস্ট ও ম্যাটেরিয়াল) চেক করার ফাংশন
async function checkNewContent() {
    console.log("📢 Checking for new content (Announcements & Materials)...");
    const courses = await fetchCourses();

    for (const course of courses) {
        const lastCheckedString = await getLastCheckedTime(course.id);
        const lastCheckedDate = lastCheckedString ? new Date(lastCheckedString) : null;

        const announcements = await fetchAnnouncements(course.id);
        const materials = await fetchMaterials(course.id);

        const allContent = [...announcements, ...materials]
            .sort((a, b) => new Date(a.updateTime) - new Date(b.updateTime)); // পুরনো থেকে নতুন সাজানো

        let newestContentTime = null;

        for (const content of allContent) {
            const contentTime = new Date(content.updateTime);
            // প্রথমবার চললে, কোনো নোটিফিকেশন না পাঠিয়ে শুধু সর্বশেষ সময় সেভ করবে
            if (!lastCheckedDate) {
                newestContentTime = content.updateTime;
                continue; // প্রথমবার কোনো কিছু না পাঠিয়ে লুপের পরের ধাপে যাও
            }
            
            // পরেরবার থেকে শুধু নতুন কনটেন্ট পাঠাবে
            if (contentTime > lastCheckedDate) {
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
        
        // যদি নতুন কোনো কনটেন্ট পাওয়া যায় বা প্রথমবার চলে, তাহলে নতুন সময় সেভ করবে
        if (newestContentTime) {
            await setLastCheckedTime(course.id, newestContentTime);
            console.log(`Updated last checked time for ${course.name} to ${newestContentTime}`);
        }
    }
}

// অ্যাসাইনমেন্ট রিমাইন্ডার চেক করার ফাংশন (সুপার ডিবাগ লগিং সহ)
async function checkReminders() {
  console.log("⏰ Checking for assignment reminders...");
  const courses = await fetchCourses();
  const now = new Date();
  console.log(`CURRENT SERVER TIME (UTC): ${now.toISOString()}`);


  for (const course of courses) {
    const students = await fetchStudents(course.id);
    const assignments = await fetchAssignments(course.id);

    for (const a of assignments) {
      if (!a.dueDate) continue;

      // ক্লাসরুমের সময়কে UTC হিসেবে ধরা হচ্ছে
      const due = new Date(Date.UTC(a.dueDate.year, a.dueDate.month - 1, a.dueDate.day, a.dueDate.hours || 23, a.dueDate.minutes || 59));
      const diffHours = (due.getTime() - now.getTime()) / (1000 * 60 * 60);

      console.log(`\n--- Checking Assignment: "${a.title}" in "${course.name}" ---`);
      console.log(`DUE DATE (UTC): ${due.toISOString()}`);
      console.log(`HOURS LEFT (Calculated): ${diffHours.toFixed(2)}`);

      if (diffHours < 0) {
        console.log("STATUS: Overdue. Skipping.");
        continue;
      }
      if (diffHours > 24) {
          console.log("STATUS: Due date is more than 24 hours away. Skipping.");
          continue;
      }
      
      const reminders = [1, 2, 6, 12, 24]; 
      for (const student of students) {
        const googleId = student.userId;
        const turnedIn = await isTurnedIn(course.id, a.id, googleId);
        
        console.log(`STUDENT: ${googleId} | TURNED IN: ${turnedIn}`);
        if (turnedIn) continue;

        for (const h of reminders) {
          const alreadySent = await reminderAlreadySent(a.id, googleId, `${h}h`);
          console.log(`Checking ${h}h reminder... | diffHours <= ${h}? ${diffHours <= h} | Already Sent? ${alreadySent}`);
          if (diffHours <= h && !alreadySent) {
            console.log(`✅ SENDING reminder (${h}h) for "${a.title}" to student ${googleId}`);
            await sendMessageToGoogleUser(googleId, `📝 Reminder: Your assignment "${a.title}" is due in about ${h} hours for ${course.name}.`);
            await markReminderSent(a.id, googleId, `${h}h`);
            break; 
          }
        }
      }
    }
  }
}

// মূল ক্রন ফাংশন
export async function runCronJobs() {
    await checkReminders();
    await checkNewContent();
}