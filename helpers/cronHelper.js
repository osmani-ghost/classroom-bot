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

  let hours = (dueTime?.hours || 23) + 6; // UTC → BDT
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

// নতুন কনটেন্ট চেক
async function checkNewContent(oauth2Client, googleId, courses) {
  console.log(`[Cron] Checking new content for user: ${googleId}`);

  for (const course of courses) {
    if (course.ownerId === googleId) continue; // teacher skip

    const lastCheckedString = await getLastCheckedTime(course.id);
    const announcements = await fetchAnnouncements(oauth2Client, course.id);
    const materials = await fetchMaterials(oauth2Client, course.id);

    console.log(
      `[Cron][DEBUG] Course ${course.name} -> Announcements: ${announcements.length}, Materials: ${materials.length}`
    );

    const allContent = [...announcements, ...materials].sort(
      (a, b) => new Date(b.updateTime) - new Date(a.updateTime)
    );

    if (allContent.length === 0) continue;
    const latestContentTime = allContent[0].updateTime;

    // প্রথমবার → last 2h কন্টেন্ট পাঠাবে
    if (!lastCheckedString) {
      console.log(`[Cron][DEBUG] First run for ${course.name}, sending last 2h only...`);
      const now = new Date();
      for (const content of allContent) {
        const contentTime = new Date(content.updateTime);
        if (contentTime > new Date(now.getTime() - 2 * 60 * 60 * 1000)) {
          const message = content.title
            ? `📚 New Material in ${course.name}:\n"${content.title}"`
            : `📢 New Announcement in ${course.name}:\n"${content.text}"`;
          console.log(`[Cron][SEND] ${message}`);
          await sendMessageToGoogleUser(googleId, message);
        } else {
          console.log(`[Cron][SKIP] Old content skipped (${content.updateTime})`);
        }
      }
      // save একটু পিছিয়ে, যাতে exact timestamp miss না হয়
      await setLastCheckedTime(
        course.id,
        new Date(new Date(latestContentTime).getTime() - 1).toISOString()
      );
      continue;
    }

    // পরেরবার → শুধু নতুন কন্টেন্ট
    for (const content of allContent) {
      console.log(`[Cron][DEBUG] Comparing ${content.updateTime} >= ${lastCheckedString}`);
      if (new Date(content.updateTime) >= new Date(lastCheckedString)) {
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

    await setLastCheckedTime(
      course.id,
      new Date(new Date(latestContentTime).getTime() - 1).toISOString()
    );
  }
}

// অ্যাসাইনমেন্ট রিমাইন্ডার
async function checkReminders(oauth2Client, googleId, courses) {
  console.log(`[Cron] Checking reminders for user: ${googleId}`);
  const now = new Date();

  for (const course of courses) {
    if (course.ownerId === googleId) continue; // teacher skip

    const assignments = await fetchAssignments(oauth2Client, course.id);
    console.log(`[Cron][DEBUG] Course ${course.name} -> Assignments: ${assignments.length}`);

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
        `[Cron][DEBUG] Assignment "${a.title}" due=${due}, diffHours=${diffHours.toFixed(2)}`
      );

      if (diffHours < 0 || diffHours > 24.5) continue;

      const turnedIn = await isTurnedIn(oauth2Client, course.id, a.id, "me");
      console.log(`[Cron][DEBUG] TurnedIn=${turnedIn}`);
      if (turnedIn) continue;

      const reminders = [1, 2, 6, 12, 24];
      for (const h of reminders) {
        if (diffHours <= h && !(await reminderAlreadySent(a.id, googleId, `${h}h`))) {
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
