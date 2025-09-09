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
  getLastCheckedAssignmentsTime,
  setLastCheckedAssignmentsTime,
} from "./redisHelper.js";

// =========================
// Create OAuth2 client for user
// =========================
function createOAuth2ClientForUser(refreshToken) {
  console.debug("[Cron][OAuth2] Creating OAuth2 client.");
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
      dueTime?.hours ?? 23,
      dueTime?.minutes ?? 0
    )
  );
  utcDate.setHours(utcDate.getHours() + 6); // UTC → BDT

  const day = String(utcDate.getDate()).padStart(2, "0");
  const month = String(utcDate.getMonth() + 1).padStart(2, "0");
  const year = utcDate.getFullYear();

  let hours = utcDate.getHours();
  const minutes = String(utcDate.getMinutes()).padStart(2, "0");
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12 || 12;

  return `${day}-${month}-${year}, ${hours}:${minutes} ${ampm}`;
}

// =========================
// New Content (Announcements & Materials)
// =========================
async function checkNewContent(oauth2Client, googleId, courses) {
  console.debug(`[Cron] Checking new announcements/materials for user: ${googleId}`);

  for (const course of courses) {
    if (course.ownerId === googleId) {
      continue;
    }

    const lastCheckedString = await getLastCheckedTime(course.id);

    const announcements = await fetchAnnouncements(oauth2Client, course.id);
    const materials = await fetchMaterials(oauth2Client, course.id);
    const allContent = [...announcements, ...materials].sort(
      (a, b) => new Date(b.updateTime) - new Date(a.updateTime)
    );

    if (allContent.length === 0) continue;
    const latestContentTime = allContent[0].updateTime;

    if (!lastCheckedString) {
      // first run: scan last 2 hours
      const now = new Date();
      for (const content of allContent) {
        const contentTime = new Date(content.updateTime);
        if (contentTime > new Date(now.getTime() - 2 * 60 * 60 * 1000)) {
          const link = content.alternateLink || course.alternateLink || "https://classroom.google.com";
          const message = content.title
            ? `📌 New Material\nCourse: ${course.name}\nTitle: ${content.title}\nLink: ${link}`
            : `📌 New Announcement\nCourse: ${course.name}\nText: ${content.text || "(No text)"}\nLink: ${link}`;
          await sendMessageToGoogleUser(googleId, message);
        }
      }
      await setLastCheckedTime(course.id, new Date(latestContentTime).toISOString());
      continue;
    }

    for (const content of allContent) {
      const contentTime = new Date(content.updateTime);
      if (contentTime > new Date(lastCheckedString)) {
        const link = content.alternateLink || course.alternateLink || "https://classroom.google.com";
        const message = content.title
          ? `📌 New Material\nCourse: ${course.name}\nTitle: ${content.title}\nLink: ${link}`
          : `📌 New Announcement\nCourse: ${course.name}\nText: ${content.text || "(No text)"}\nLink: ${link}`;
        await sendMessageToGoogleUser(googleId, message);
      } else {
        break;
      }
    }

    await setLastCheckedTime(course.id, new Date(latestContentTime).toISOString());
  }
}

// =========================
// New Assignment Notifications (Immediate when posted)
// =========================
async function checkNewAssignmentsPosted(oauth2Client, googleId, courses) {
  console.debug(`[Cron] Checking NEW assignments posted for user: ${googleId}`);

  for (const course of courses) {
    if (course.ownerId === googleId) {
      continue;
    }

    const lastChecked = await getLastCheckedAssignmentsTime(course.id);

    const assignments = await fetchAssignments(oauth2Client, course.id);
    if (!assignments || assignments.length === 0) {
      continue;
    }
    const latestTime = assignments[0].updateTime || assignments[0].creationTime;

    if (!lastChecked) {
      // first run: scan last 2 hours
      const now = new Date();
      for (const a of assignments) {
        const t = new Date(a.updateTime || a.creationTime || 0);
        if (t > new Date(now.getTime() - 2 * 60 * 60 * 1000)) {
          const when = a.dueDate ? formatDueDateTime(a.dueDate, a.dueTime) : "No due date set";
          const link = a.alternateLink || course.alternateLink || "https://classroom.google.com";
          const message = `📌 New Assignment Posted\nCourse: ${course.name}\nTitle: ${a.title}\nDue: ${when}\nLink: ${link}`;
          await sendMessageToGoogleUser(googleId, message);
        }
      }
      await setLastCheckedAssignmentsTime(course.id, new Date(latestTime).toISOString());
      continue;
    }

    for (const a of assignments) {
      const t = new Date(a.updateTime || a.creationTime || 0);
      if (t > new Date(lastChecked)) {
        const when = a.dueDate ? formatDueDateTime(a.dueDate, a.dueTime) : "No due date set";
        const link = a.alternateLink || course.alternateLink || "https://classroom.google.com";
        const message = `📌 New Assignment Posted\nCourse: ${course.name}\nTitle: ${a.title}\nDue: ${when}\nLink: ${link}`;
        await sendMessageToGoogleUser(googleId, message);
      } else {
        break;
      }
    }

    await setLastCheckedAssignmentsTime(course.id, new Date(latestTime).toISOString());
  }
}

// =========================
// Assignment reminders (36h, 12h, 6h, 2h) + Missing (1 minute after due)
// skip submitted, prevent duplicates
// =========================
async function checkReminders(oauth2Client, googleId, courses) {
  console.debug(`[Cron] Checking assignment reminders for user: ${googleId}`);
  const now = new Date();

  for (const course of courses) {
    if (course.ownerId === googleId) {
      continue;
    }

    const assignments = await fetchAssignments(oauth2Client, course.id);
    if (!assignments || assignments.length === 0) continue;

    for (const a of assignments) {
      if (!a.dueDate) continue;

      const due = new Date(
        Date.UTC(
          a.dueDate.year,
          a.dueDate.month - 1,
          a.dueDate.day,
          a.dueTime?.hours ?? 23,
          a.dueTime?.minutes ?? 0
        )
      );
      // do time math in minutes for precision
      const diffMinutes = (due.getTime() - now.getTime()) / (1000 * 60);
      const diffHours = diffMinutes / 60;

      // If due is far in future (more than 72h), skip — we only remind within reasonable window.
      if (diffMinutes <= -1 && diffMinutes < -60 * 24 * 14) {
        // very old; skip
        continue;
      }

      // Check if already turned in
      const turnedIn = await isTurnedIn(oauth2Client, course.id, a.id, "me");
      if (turnedIn) continue;

      // 1) Missing (send once when >1 minute past due)
      const alreadyMissingSent = await reminderAlreadySent(a.id, googleId, "missing");
      if (diffMinutes <= -1 && !alreadyMissingSent) {
        // send missing notification
        const formattedTime = a.dueDate ? formatDueDateTime(a.dueDate, a.dueTime) : "No due date set";
        const link = a.alternateLink || course.alternateLink || "https://classroom.google.com";
        const message = `⚠️ Assignment Missing\nCourse: ${course.name}\nTitle: ${a.title}\nDeadline was: ${formattedTime}\nLink: ${link}`;
        await sendMessageToGoogleUser(googleId, message);
        await markReminderSent(a.id, googleId, "missing");
        // don't continue — we still may want to mark other reminders (but missing is final)
      }

      // 2) Scheduled reminders — only when due is in future (and within 72h)
      if (diffHours <= 0 || diffHours > 72) {
        // skip reminders if past due (we handled missing above) or too far (>72h)
        continue;
      }

      // reminder checkpoints (36h, 12h, 6h, 2h)
      const reminders = [36, 12, 6, 2];
      for (const h of reminders) {
        const tag = `${h}h`;
        const alreadySent = await reminderAlreadySent(a.id, googleId, tag);
        // send when diffHours is roughly equal to h (±0.5 hour)
        if (Math.abs(diffHours - h) <= 0.5 && !alreadySent) {
          const formattedTime = formatDueDateTime(a.dueDate, a.dueTime);
          const link = a.alternateLink || course.alternateLink || "https://classroom.google.com";
          const message = `📌 Assignment Reminder (${h}h left)\nCourse: ${course.name}\nTitle: ${a.title}\nDue: ${formattedTime}\nLink: ${link}`;
          await sendMessageToGoogleUser(googleId, message);
          await markReminderSent(a.id, googleId, tag);
          break; // only one reminder tag at a time
        }
      }
    }
  }
}

// =========================
// Main cron runner
// =========================
export async function runCronJobs() {
  console.info("⏰ [Cron] Job started for all registered users...");
  const allGoogleIds = await getAllUserGoogleIds();
  console.info(`[Cron] Found ${allGoogleIds.length} registered users.`);

  for (const googleId of allGoogleIds) {
    const user = await getUser(googleId);
    if (!user || !user.refreshToken) {
      continue;
    }

    const userOAuthClient = createOAuth2ClientForUser(user.refreshToken);
    const courses = await fetchCourses(userOAuthClient);

    // Reminders (36h,12h,6h,2h) + missing
    await checkReminders(userOAuthClient, googleId, courses);

    // New assignments posted
    await checkNewAssignmentsPosted(userOAuthClient, googleId, courses);

    // New content (announcements & materials)
    await checkNewContent(userOAuthClient, googleId, courses);
  }

  console.info("⏰ [Cron] Job finished for all users.");
}
