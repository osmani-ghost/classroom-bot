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

// =========================
// OAuth client for each user
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
// Format BDT due date/time
// =========================
function formatDueDateTime(dueDate, dueTime) {
  if (!dueDate) return "End of day";

  // Convert UTC to BDT (+6)
  let hours = ((dueTime?.hours || 23) + 6) % 24;
  const minutes = dueTime?.minutes || 0;
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12 || 12;
  const minutesStr = minutes < 10 ? "0" + minutes : minutes;

  const dateStr = `${dueDate.day.toString().padStart(2, "0")}-${dueDate.month
    .toString()
    .padStart(2, "0")}-${dueDate.year}`;

  return `${dateStr}, ${hours}:${minutesStr} ${ampm}`;
}

// =========================
// Check new content (Announcements & Materials)
// =========================
async function checkNewContent(oauth2Client, googleId, courses) {
  console.log(`[Cron] Checking new content for user: ${googleId}`);

  for (const course of courses) {
    if (course.ownerId === googleId) {
      console.log(`[Cron][DEBUG] Skipping teacher course: ${course.name}`);
      continue;
    }

    const lastCheckedString = await getLastCheckedTime(course.id);
    const announcements = await fetchAnnouncements(oauth2Client, course.id);
    const materials = await fetchMaterials(oauth2Client, course.id);

    const allContent = [...announcements, ...materials].sort(
      (a, b) => new Date(b.updateTime) - new Date(a.updateTime)
    );

    if (allContent.length === 0) {
      console.log(`[Cron][DEBUG] No content for course: ${course.name}`);
      continue;
    }

    const latestContentTime = allContent[0].updateTime;

    // First run → only last 2 hours
    if (!lastCheckedString) {
      console.log(`[Cron][DEBUG] First run for ${course.name}, sending last 2h content...`);
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
          console.log(`[Cron][DEBUG] Content older than 2h, skipping: ${content.title || content.text}`);
        }
      }
      // Save lastChecked slightly before latest to catch edge cases
      await setLastCheckedTime(
        course.id,
        new Date(new Date(latestContentTime).getTime() - 1).toISOString()
      );
      continue;
    }

    // Normal run → only new content since lastChecked
    console.log(`[Cron][DEBUG] LastChecked for ${course.name}: ${lastCheckedString}`);
    for (const content of allContent) {
      const contentTime = new Date(content.updateTime);
      console.log(`[Cron][DEBUG] Comparing content.updateTime=${contentTime} >= lastChecked=${lastCheckedString}`);
      if (contentTime > new Date(lastCheckedString)) {
        const message = content.title
          ? `📚 New Material in ${course.name}:\n"${content.title}"`
          : `📢 New Announcement in ${course.name}:\n"${content.text}"`;
        console.log(`[Cron][SEND] ${message}`);
        await sendMessageToGoogleUser(googleId, message);
      } else {
        console.log("[Cron][BREAK] No newer content found beyond this point.");
        break;
      }
    }

    // Update lastChecked for next cron run
    await setLastCheckedTime(course.id, new Date(latestContentTime).toISOString());
    console.log(`[Cron][DEBUG] LastChecked updated for ${course.name}: ${latestContentTime}`);
  }
}

// =========================
// Assignment reminders
// =========================
async function checkReminders(oauth2Client, googleId, courses) {
  console.log(`[Cron] Checking assignment reminders for user: ${googleId}`);
  const now = new Date();

  for (const course of courses) {
    if (course.ownerId === googleId) {
      console.log(`[Cron][DEBUG] Skipping teacher course: ${course.name}`);
      continue;
    }

    const assignments = await fetchAssignments(oauth2Client, course.id);
    console.log(`[Cron][DEBUG] Course ${course.name} -> Assignments: ${assignments.length}`);

    for (const a of assignments) {
      if (!a.dueDate || !a.dueTime) continue;

      // Convert UTC Classroom due time
      const dueUTC = new Date(
        Date.UTC(
          a.dueDate.year,
          a.dueDate.month - 1,
          a.dueDate.day,
          a.dueTime.hours,
          a.dueTime.minutes || 0
        )
      );

      const diffHours = (dueUTC.getTime() - now.getTime()) / (1000 * 60 * 60);
      console.log(`[Cron][DEBUG] Assignment "${a.title}" due=${dueUTC}, diffHours=${diffHours.toFixed(2)}`);

      const turnedIn = await isTurnedIn(oauth2Client, course.id, a.id, "me");
      console.log(`[Cron][DEBUG] TurnedIn=${turnedIn}`);
      if (turnedIn) continue;

      // Reminder windows: 24h, 12h, 6h, 2h, 0h (exact due time)
      const reminders = [24, 12, 6, 2, 0];
      for (const h of reminders) {
        const alreadySent = await reminderAlreadySent(a.id, googleId, `${h}h`);
        console.log(`[Cron][DEBUG] Checking reminder ${h}h: alreadySent=${alreadySent}`);
        if ((diffHours <= h) && !alreadySent && diffHours >= 0) {
          const formattedTime = formatDueDateTime(a.dueDate, a.dueTime);
          const message = `📝 Reminder: Your assignment "${a.title}" is due for the course ${course.name}.\nLast submission: ${formattedTime}`;
          console.log(`[Cron][SEND] ${message}`);
          await sendMessageToGoogleUser(googleId, message);
          await markReminderSent(a.id, googleId, `${h}h`);
          break; // only one reminder per run
        } else if (diffHours <= 0 && !alreadySent) {
          // last moment reminder
          const formattedTime = formatDueDateTime(a.dueDate, a.dueTime);
          const message = `📝 FINAL Reminder: Your assignment "${a.title}" is due NOW for course ${course.name}!\nSubmission time: ${formattedTime}`;
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
// Main cron
// =========================
export async function runCronJobs() {
  console.log("⏰ Cron job started for all registered users...");
  const allGoogleIds = await getAllUserGoogleIds();
  console.log(`[Cron] Found ${allGoogleIds.length} registered users to check.`);

  for (const googleId of allGoogleIds) {
    const user = await getUser(googleId);
    if (!user || !user.refreshToken) {
      console.log(`[Cron][DEBUG] No refresh token for user ${googleId}, skipping.`);
      continue;
    }

    const userOAuthClient = createOAuth2ClientForUser(user.refreshToken);
    const courses = await fetchCourses(userOAuthClient);
    console.log(`[Cron][DEBUG] User ${googleId} has ${courses.length} courses.`);

    console.log("[Cron] =========================");
    await checkReminders(userOAuthClient, googleId, courses);

    console.log("[Cron] =========================");
    await checkNewContent(userOAuthClient, googleId, courses);
  }

  console.log("⏰ Cron job finished for all users.");
}
