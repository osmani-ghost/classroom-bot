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
// Create OAuth2 client for user
// =========================
function createOAuth2ClientForUser(refreshToken) {
  console.log("[DEBUG] Creating OAuth2 client...");
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  console.log("[DEBUG] OAuth2 client created successfully.");
  return oauth2Client;
}

// =========================
// Format Date + Time → AM/PM BDT
// =========================
function formatDueDateTime(dueDate, dueTime) {
  console.log("[DEBUG] Formatting dueDate and dueTime:", dueDate, dueTime);

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
  console.log("[DEBUG] Raw UTC Date:", utcDate);

  utcDate.setHours(utcDate.getHours() + 6); // convert to BDT
  console.log("[DEBUG] Converted to BDT:", utcDate);

  const day = utcDate.getDate().toString().padStart(2, "0");
  const month = (utcDate.getMonth() + 1).toString().padStart(2, "0");
  const year = utcDate.getFullYear();

  let hours = utcDate.getHours();
  const minutes = utcDate.getMinutes().toString().padStart(2, "0");
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12 || 12;

  const formatted = `${day}-${month}-${year}, ${hours}:${minutes} ${ampm}`;
  console.log("[DEBUG] Final formatted time:", formatted);
  return formatted;
}

// =========================
// Check new content (Announcements & Materials)
// =========================
async function checkNewContent(oauth2Client, googleId, courses) {
  console.log(`[Cron] Checking new content for user: ${googleId}`);

  for (const course of courses) {
    console.log(`[Cron][DEBUG] Processing course: ${course.name} (${course.id})`);

    if (course.ownerId === googleId) {
      console.log(`[Cron][DEBUG] Skipping teacher course: ${course.name}`);
      continue;
    }

    const lastCheckedString = await getLastCheckedTime(course.id);
    console.log(`[Cron][DEBUG] lastChecked from Redis: ${lastCheckedString}`);

    const announcements = await fetchAnnouncements(oauth2Client, course.id);
    const materials = await fetchMaterials(oauth2Client, course.id);
    console.log(`[Cron][DEBUG] Announcements fetched: ${announcements.length}`);
    console.log(`[Cron][DEBUG] Materials fetched: ${materials.length}`);

    const allContent = [...announcements, ...materials].sort(
      (a, b) => new Date(b.updateTime) - new Date(a.updateTime)
    );
    console.log(`[Cron][DEBUG] Total combined content items: ${allContent.length}`);

    if (allContent.length === 0) {
      console.log(`[Cron][DEBUG] No content found for ${course.name}`);
      continue;
    }

    const latestContentTime = allContent[0].updateTime;
    console.log(`[Cron][DEBUG] Latest content time: ${latestContentTime}`);

    if (!lastCheckedString) {
      console.log(`[Cron][DEBUG] First run for ${course.name}, sending last 2h content...`);
      const now = new Date();
      for (const content of allContent) {
        const contentTime = new Date(content.updateTime);
        console.log(`[Cron][DEBUG] Checking content=${content.title || content.text}, time=${contentTime}`);
        if (contentTime > new Date(now.getTime() - 2 * 60 * 60 * 1000)) {
          const message = content.title
            ? `📚 New Material in ${course.name}:\n"${content.title}"`
            : `📢 New Announcement in ${course.name}:\n"${content.text}"`;
          console.log(`[Cron][SEND] ${message}`);
          await sendMessageToGoogleUser(googleId, message);
        }
      }
      await setLastCheckedTime(course.id, new Date(latestContentTime).toISOString());
      console.log(`[Cron][DEBUG] First run -> lastChecked updated to ${latestContentTime}`);
      continue;
    }

    console.log(`[Cron][DEBUG] Normal run for ${course.name}, comparing updates...`);
    for (const content of allContent) {
      const contentTime = new Date(content.updateTime);
      console.log(`[Cron][DEBUG] Comparing contentTime=${contentTime} > lastChecked=${lastCheckedString}`);
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
  console.log(`[Cron][DEBUG] Current time: ${now}`);

  for (const course of courses) {
    console.log(`[Cron][DEBUG] Processing course for reminders: ${course.name}`);

    if (course.ownerId === googleId) {
      console.log(`[Cron][DEBUG] Skipping teacher course: ${course.name}`);
      continue;
    }

    const assignments = await fetchAssignments(oauth2Client, course.id);
    console.log(`[Cron][DEBUG] Course ${course.name} -> Assignments: ${assignments.length}`);

    for (const a of assignments) {
      console.log(`[Cron][DEBUG] Checking assignment: ${a.title}`);

      if (!a.dueDate || !a.dueTime) {
        console.log(`[Cron][DEBUG] Skipping ${a.title} (no dueDate/dueTime)`);
        continue;
      }

      const due = new Date(
        Date.UTC(
          a.dueDate.year,
          a.dueDate.month - 1,
          a.dueDate.day,
          a.dueTime.hours,
          a.dueTime.minutes || 0
        )
      );
      console.log(`[Cron][DEBUG] Raw Due UTC: ${due}`);

      const diffHours = (due.getTime() - now.getTime()) / (1000 * 60 * 60);
      console.log(`[Cron][DEBUG] Assignment "${a.title}" due=${due}, diffHours=${diffHours.toFixed(2)}`);

      if (diffHours <= 0 || diffHours > 24.5) {
        console.log(`[Cron][DEBUG] Skipping ${a.title}, not in reminder window.`);
        continue;
      }

      const turnedIn = await isTurnedIn(oauth2Client, course.id, a.id, "me");
      console.log(`[Cron][DEBUG] TurnedIn=${turnedIn}`);
      if (turnedIn) {
        console.log(`[Cron][DEBUG] Skipping ${a.title}, already submitted.`);
        continue;
      }

      const reminders = [24, 12, 6, 2];
      for (const h of reminders) {
        const alreadySent = await reminderAlreadySent(a.id, googleId, `${h}h`);
        console.log(`[Cron][DEBUG] Checking reminder ${h}h for ${a.title}: alreadySent=${alreadySent}`);
        if (diffHours <= h && !alreadySent) {
          const formattedTime = formatDueDateTime(a.dueDate, a.dueTime);
          const message = `📝 Reminder: Your assignment "${a.title}" is due for the course ${course.name}.\nLast submission: ${formattedTime}`;
          console.log(`[Cron][SEND] ${message}`);
          await sendMessageToGoogleUser(googleId, message);
          await markReminderSent(a.id, googleId, `${h}h`);
          console.log(`[Cron][DEBUG] Reminder ${h}h marked as sent for ${a.title}`);
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
  console.log(`[Cron] Found ${allGoogleIds.length} registered users to check.`);

  for (const googleId of allGoogleIds) {
    console.log(`[Cron][DEBUG] Starting for GoogleId=${googleId}`);
    const user = await getUser(googleId);
    console.log(`[Cron][DEBUG] User object fetched:`, user);

    if (!user || !user.refreshToken) {
      console.log(`[Cron][WARN] Skipping user ${googleId}, invalid user/refreshToken`);
      continue;
    }

    console.log(`[Cron][DEBUG] User ${googleId} has ${user.courses?.length || 0} courses.`);

    const userOAuthClient = createOAuth2ClientForUser(user.refreshToken);
    const courses = await fetchCourses(userOAuthClient);
    console.log(`[Cron][DEBUG] Courses fetched for ${googleId}: ${courses.length}`);

    console.log("[Cron] =========================");
    await checkReminders(userOAuthClient, googleId, courses);
    console.log("[Cron] =========================");
    await checkNewContent(userOAuthClient, googleId, courses);
  }

  console.log("⏰ Cron job finished for all users.");
}
