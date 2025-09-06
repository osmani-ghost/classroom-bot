import { google } from "googleapis";
import {
  fetchCourses,
  fetchAssignments,
  isTurnedIn,
  fetchAnnouncements,
  fetchMaterials,
} from "./classroomHelper.js";
import { sendMessageToGoogleUser } from "./messengerHelper.js";
import {
  getAllUserGoogleIds,
  getUser,
  reminderAlreadySent,
  markReminderSent,
  getLastCheckedTime,
  setLastCheckedTime,
} from "./redisHelper.js";

// ইউজারের জন্য ব্যক্তিগত ক্লায়েন্ট তৈরি করে
function createOAuth2ClientForUser(refreshToken) {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  return oauth2Client;
}

// সময় + তারিখকে AM/PM ফরম্যাটে সাজায় (BDT +6)
function formatDueDateTime(dueDate, dueTime) {
  if (!dueDate) return "End of day";

  let hours = (dueTime?.hours || 23) + 6; // UTC to BDT
  const minutes = dueTime?.minutes || 0;
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12;
  hours = hours ? hours : 12;
  const minutesStr = minutes < 10 ? "0" + minutes : minutes;

  const dateStr = `${dueDate.day.toString().padStart(2, "0")}-${dueDate.month
    .toString()
    .padStart(2, "0")}-${dueDate.year}`;

  return `${dateStr}, ${hours}:${minutesStr} ${ampm}`;
}

// নতুন কনটেন্ট চেক করার ফাংশন
async function checkNewContent(oauth2Client, googleId, courses) {
  console.log(`[Cron] Checking new content for user: ${googleId}`);
  for (const course of courses) {
    if (course.ownerId === googleId) continue; // teacher skip

    const lastCheckedString = await getLastCheckedTime(course.id);
    const announcements = await fetchAnnouncements(oauth2Client, course.id);
    const materials = await fetchMaterials(oauth2Client, course.id);
    const allContent = [...announcements, ...materials].sort(
      (a, b) => new Date(b.updateTime) - new Date(a.updateTime)
    );

    if (allContent.length === 0) continue;
    const latestContentTime = allContent[0].updateTime;

    // ✅ প্রথমবার হলে → শুধু শেষ 2 ঘন্টার কনটেন্ট পাঠাবে
    if (!lastCheckedString) {
      console.log(
        `[Cron][FIRST RUN] Course=${course.name}, sending content from last 2 hours`
      );
      const now = new Date();
      let sentSomething = false;
      for (const content of allContent) {
        const contentTime = new Date(content.updateTime);
        console.log(
          `[Cron][DEBUG][FIRST RUN] content.updateTime=${contentTime.toISOString()}`
        );
        if (contentTime > new Date(now.getTime() - 2 * 60 * 60 * 1000)) {
          const message = content.title
            ? `📚 New Material in ${course.name}:\n"${content.title}"`
            : `📢 New Announcement in ${course.name}:\n"${content.text}"`;
          console.log(`[Cron][SEND-FIRST] ${message}`);
          await sendMessageToGoogleUser(googleId, message);
          sentSomething = true;
        } else {
          break;
        }
      }
      // 👉 এখানে ফিক্স: শুধু সর্বশেষ content time দিয়ে সেট করো
      if (sentSomething) {
        await setLastCheckedTime(course.id, latestContentTime);
        console.log(
          `[Cron][FIRST RUN] Updated lastCheckedTime=${latestContentTime}`
        );
      }
      continue;
    }

    // ✅ পরেরবার → শুধু নতুন কনটেন্ট পাঠাবে
    for (const content of allContent) {
      const contentTime = new Date(content.updateTime);
      console.log(
        `[Cron][DEBUG] Comparing content.updateTime=${contentTime.toISOString()} with lastChecked=${lastCheckedString}`
      );
      if (contentTime > new Date(lastCheckedString)) {
        const message = content.title
          ? `📚 New Material in ${course.name}:\n"${content.title}"`
          : `📢 New Announcement in ${course.name}:\n"${content.text}"`;
        console.log(`[Cron][SEND] ${message}`);
        await sendMessageToGoogleUser(googleId, message);
      } else {
        console.log("[Cron][BREAK] No newer content found.");
        break;
      }
    }
    await setLastCheckedTime(course.id, latestContentTime);
  }
}


// অ্যাসাইনমেন্ট রিমাইন্ডার চেক করার ফাংশন
async function checkReminders(oauth2Client, googleId, courses) {
  console.log(`[Cron] Checking reminders for user: ${googleId}`);
  const now = new Date();
  for (const course of courses) {
    if (course.ownerId === googleId) continue; // teacher skip

    const assignments = await fetchAssignments(oauth2Client, course.id);
    console.log(
      `[Cron][DEBUG] Course ${course.name} -> Assignments: ${assignments.length}`
    );

    for (const a of assignments) {
      if (!a.dueDate || !a.dueTime) continue;
      const due = new Date(
        Date.UTC(
          a.dueDate.year,
          a.dueDate.month - 1,
          a.dueDate.day,
          a.dueTime.hours,
          a.dueTime.minutes || 0
        )
      );
      const diffHours = (due.getTime() - now.getTime()) / (1000 * 60 * 60);

      console.log(
        `[Cron][DEBUG] Assignment "${a.title}" due=${due}, diffHours=${diffHours.toFixed(
          2
        )}`
      );

      if (diffHours < 0 || diffHours > 24.5) continue;

      const turnedIn = await isTurnedIn(oauth2Client, course.id, a.id, "me");
      console.log(`[Cron][DEBUG] TurnedIn=${turnedIn}`);
      if (turnedIn) continue;

      const reminders = [1, 2, 6, 12, 24];
      for (const h of reminders) {
        if (
          diffHours <= h &&
          !(await reminderAlreadySent(a.id, googleId, `${h}h`))
        ) {
          const formattedTime = formatDueDateTime(a.dueDate, a.dueTime);
          const message = `📝 Reminder: Your assignment "${a.title}" is due for the course ${course.name}.\nLast submission: ${formattedTime}`;
          console.log(`[Cron][SEND] ${message}`);
          await sendMessageToGoogleUser(googleId, message);
          await markReminderSent(a.id, googleId, `${h}h`);
          break;
        }
      }
    }
  }
}

// মূল ক্রন ফাংশন
export async function runCronJobs() {
  console.log("⏰ Cron job started for all registered users...");
  const allGoogleIds = await getAllUserGoogleIds();
  console.log(`[Cron] Found ${allGoogleIds.length} registered users to check.`);

  for (const googleId of allGoogleIds) {
    const user = await getUser(googleId);
    if (!user || !user.refreshToken) continue;

    const userOAuthClient = createOAuth2ClientForUser(user.refreshToken);
    const courses = await fetchCourses(userOAuthClient);

    await checkReminders(userOAuthClient, googleId, courses);
    await checkNewContent(userOAuthClient, googleId, courses);
  }
}
