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
  redisCommand,
} from "./redisHelper.js";

// =========================
// Create OAuth2 client for user
// =========================
function createOAuth2ClientForUser(refreshToken) {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  return oauth2Client;
}

// =========================
// Format Date + Time → AM/PM BDT
// =========================
function formatDueDateTime(dueDate, dueTime) {
  if (!dueDate) return "End of day";

  const utcDate = new Date(
    Date.UTC(
      dueDate.year,
      dueDate.month - 1,
      dueDate.day,
      dueTime?.hours || 23,
      dueTime?.minutes || 0
    )
  );
  utcDate.setHours(utcDate.getHours() + 6); // UTC → BDT

  const day = utcDate.getDate().toString().padStart(2, "0");
  const month = (utcDate.getMonth() + 1).toString().padStart(2, "0");
  const year = utcDate.getFullYear();

  let hours = utcDate.getHours();
  const minutes = utcDate.getMinutes().toString().padStart(2, "0");
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12 || 12;

  return `${day}-${month}-${year}, ${hours}:${minutes} ${ampm}`;
}

// =========================
// Save assignment/content into Redis
// =========================
async function saveAssignmentToRedis(course, assignment) {
  const key = `assignment:${course.id}:${assignment.id}`;
  const data = {
    courseName: course.name,
    title: assignment.title,
    dueDate: assignment.dueDate,
    dueTime: assignment.dueTime,
    link: assignment.alternateLink || `https://classroom.google.com/c/${course.id}/a/${assignment.id}/details`,
    type: "assignment",
  };
  console.log(`[Cron][Redis] Saving assignment ${assignment.title} to Redis...`);
  await redisCommand("set", key, JSON.stringify(data));
}

async function saveContentToRedis(course, item, type) {
  const key = `${type}:${course.id}:${item.id}`;
  const data = {
    courseName: course.name,
    title: item.title || item.text,
    link: item.alternateLink || "Link not available",
    type,
    updateTime: item.updateTime,
  };
  console.log(`[Cron][Redis] Saving ${type} for ${course.name}: ${data.title}`);
  await redisCommand("set", key, JSON.stringify(data));
}

// =========================
// Check new content
// =========================
async function checkNewContent(oauth2Client, googleId, courses) {
  console.log(`[Cron] Checking new content for user: ${googleId}`);

  for (const course of courses) {
    if (course.ownerId === googleId) continue;

    const lastCheckedString = await getLastCheckedTime(course.id);
    const announcements = await fetchAnnouncements(oauth2Client, course.id);
    const materials = await fetchMaterials(oauth2Client, course.id);
    const allContent = [...announcements, ...materials].sort(
      (a, b) => new Date(b.updateTime) - new Date(a.updateTime)
    );

    for (const content of allContent) {
      await saveContentToRedis(
        course,
        content,
        content.title ? "material" : "announcement"
      );
    }

    if (!lastCheckedString) {
      console.log(`[Cron][DEBUG] First run → saving initial content only.`);
    } else {
      console.log(`[Cron][DEBUG] Checking for new content after: ${lastCheckedString}`);
    }

    if (allContent.length > 0) {
      const latestContentTime = allContent[0].updateTime;
      await setLastCheckedTime(course.id, new Date(latestContentTime).toISOString());
    }
  }
}

// =========================
// Assignment reminders
// =========================
async function checkReminders(oauth2Client, googleId, courses) {
  console.log(`[Cron] Checking assignment reminders for user: ${googleId}`);
  const now = new Date();

  for (const course of courses) {
    if (course.ownerId === googleId) continue;

    const assignments = await fetchAssignments(oauth2Client, course.id);
    for (const a of assignments) {
      if (!a.dueDate || !a.dueTime) continue;

      await saveAssignmentToRedis(course, a);

      const due = new Date(
        Date.UTC(a.dueDate.year, a.dueDate.month - 1, a.dueDate.day, a.dueTime.hours, a.dueTime.minutes || 0)
      );
      const diffHours = (due.getTime() - now.getTime()) / (1000 * 60 * 60);

      if (diffHours <= 0 || diffHours > 24.5) continue;

      const turnedIn = await isTurnedIn(oauth2Client, course.id, a.id, "me");
      if (turnedIn) continue;

      const reminders = [24, 12, 6, 2];
      for (const h of reminders) {
        const alreadySent = await reminderAlreadySent(a.id, googleId, `${h}h`);
        if (diffHours <= h && !alreadySent) {
          const formattedTime = formatDueDateTime(a.dueDate, a.dueTime);
          const link = a.alternateLink || `https://classroom.google.com/c/${course.id}/a/${a.id}/details`;
          const message = `📌 Assignment Reminder\nCourse: ${course.name}\nTitle: ${a.title}\nDue: ${formattedTime}\nLink: ${link}`;
          console.log(`[Cron][SEND] ${message}`);
          await sendMessageToGoogleUser(googleId, message);
          await markReminderSent(a.id, googleId, `${h}h`);
          break;
        }
      }
    }
  }
}

// =========================
// Main cron runner
// =========================
export async function runCronJobs() {
  console.log("⏰ Cron job started for all registered users...");
  const allGoogleIds = await getAllUserGoogleIds();
  console.log(`[Cron] Found ${allGoogleIds.length} registered users.`);

  for (const googleId of allGoogleIds) {
    const user = await getUser(googleId);
    if (!user || !user.refreshToken) continue;

    const userOAuthClient = createOAuth2ClientForUser(user.refreshToken);
    const courses = await fetchCourses(userOAuthClient);

    await checkReminders(userOAuthClient, googleId, courses);
    await checkNewContent(userOAuthClient, googleId, courses);
  }

  console.log("⏰ Cron job finished for all users.");
}
