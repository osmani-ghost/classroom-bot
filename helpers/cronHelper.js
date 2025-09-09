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
  console.log("[Cron][OAuth2] Creating OAuth2 client using refresh token.");
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
  console.log(`[Cron] Checking new announcements/materials for user: ${googleId}`);

  for (const course of courses) {
    if (course.ownerId === googleId) {
      console.log(`[Cron][Content] Skipping teacher-owned course: ${course.name}`);
      continue;
    }

    const lastCheckedString = await getLastCheckedTime(course.id);
    console.log(`[Cron][Content] lastChecked=${lastCheckedString} for course=${course.name} (${course.id})`);

    const announcements = await fetchAnnouncements(oauth2Client, course.id);
    const materials = await fetchMaterials(oauth2Client, course.id);
    const allContent = [...announcements, ...materials].sort(
      (a, b) => new Date(b.updateTime) - new Date(a.updateTime)
    );

    if (allContent.length === 0) continue;
    const latestContentTime = allContent[0].updateTime;

    if (!lastCheckedString) {
      console.log(`[Cron][Content] First run for ${course.name}, scanning last 2h.`);
      const now = new Date();
      for (const content of allContent) {
        const contentTime = new Date(content.updateTime);
        if (contentTime > new Date(now.getTime() - 2 * 60 * 60 * 1000)) {
          const link = content.alternateLink || course.alternateLink || "https://classroom.google.com";
          const message = content.title
            ? `📌 New Material\nCourse: ${course.name}\nTitle: ${content.title}\nLink: ${link}`
            : `📌 New Announcement\nCourse: ${course.name}\nText: ${content.text || "(No text)"}\nLink: ${link}`;
          console.log(`[Cron][Content][SEND]`, message);
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
        console.log(`[Cron][Content][SEND]`, message);
        await sendMessageToGoogleUser(googleId, message);
      } else {
        console.log("[Cron][Content] Reached items older than lastChecked. Breaking.");
        break;
      }
    }

    await setLastCheckedTime(course.id, new Date(latestContentTime).toISOString());
    console.log(`[Cron][Content] Updated lastChecked for ${course.name}: ${latestContentTime}`);
  }
}

// =========================
// New Assignment Notifications (Immediate when posted)
// =========================
async function checkNewAssignmentsPosted(oauth2Client, googleId, courses) {
  console.log(`[Cron] Checking NEW assignments posted for user: ${googleId}`);

  for (const course of courses) {
    if (course.ownerId === googleId) {
      console.log(`[Cron][NewAssignments] Skipping teacher-owned course: ${course.name}`);
      continue;
    }

    const lastChecked = await getLastCheckedAssignmentsTime(course.id);
    console.log(`[Cron][NewAssignments] lastAssignmentChecked=${lastChecked} for course=${course.name} (${course.id})`);

    const assignments = await fetchAssignments(oauth2Client, course.id); 
    if (!assignments || assignments.length === 0) {
      console.log(`[Cron][NewAssignments] No coursework found for ${course.name}.`);
      continue;
    }
    const latestTime = assignments[0].updateTime || assignments[0].creationTime;

    if (!lastChecked) {
      console.log(`[Cron][NewAssignments] First run for ${course.name}, scanning last 2h.`);
      const now = new Date();
      for (const a of assignments) {
        const t = new Date(a.updateTime || a.creationTime || 0);
        if (t > new Date(now.getTime() - 2 * 60 * 60 * 1000)) {
          const when = a.dueDate ? formatDueDateTime(a.dueDate, a.dueTime) : "No due date set";
          const link = a.alternateLink || course.alternateLink || "https://classroom.google.com";
          const message = `📌 New Assignment Posted\nCourse: ${course.name}\nTitle: ${a.title}\nDue: ${when}\nLink: ${link}`;
          console.log(`[Cron][NewAssignments][SEND]`, message);
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
        console.log(`[Cron][NewAssignments][SEND]`, message);
        await sendMessageToGoogleUser(googleId, message);
      } else {
        console.log("[Cron][NewAssignments] Reached items older than lastAssignmentChecked. Breaking.");
        break;
      }
    }

    await setLastCheckedAssignmentsTime(course.id, new Date(latestTime).toISOString());
    console.log(`[Cron][NewAssignments] Updated lastAssignmentChecked for ${course.name}: ${latestTime}`);
  }
}

// =========================
// Assignment reminders (36h, 12h, 6h, 2h) — skip submitted, ignore overdue >24.5h, prevent duplicates
// Also send a one-time "missing" alert 1 minute after deadline if still not turned in.
// =========================
async function checkReminders(oauth2Client, googleId, courses) {
  console.log(`[Cron] Checking assignment reminders for user: ${googleId}`);
  const now = new Date();

  for (const course of courses) {
    if (course.ownerId === googleId) {
      console.log(`[Cron][Reminders] Skipping teacher-owned course: ${course.name}`);
      continue;
    }

    const assignments = await fetchAssignments(oauth2Client, course.id);
    console.log(`[Cron][Reminders] Course ${course.name} -> Assignments: ${assignments.length}`);

    for (const a of assignments) {
      if (!a.dueDate) continue; // ignore assignments with no due date for reminders

      const due = new Date(
        Date.UTC(
          a.dueDate.year,
          a.dueDate.month - 1,
          a.dueDate.day,
          a.dueTime?.hours ?? 23,
          a.dueTime?.minutes ?? 0
        )
      );
      const diffHours = (due.getTime() - now.getTime()) / (1000 * 60 * 60);

      console.log(`[Cron][Reminders] "${a.title}" due=${due.toISOString()}, diffHours=${diffHours.toFixed(2)}`);

      // Ignore if far in future or already past long time (>24.5h ago)
      if (diffHours > 24.5) {
        console.log("[Cron][Reminders] ⏭️ Skipping because too far in the future (>24.5h).");
        continue;
      }

      // Check if assignment is already turned in
      let turnedIn = false;
      try {
        turnedIn = await isTurnedIn(oauth2Client, course.id, a.id, "me");
      } catch (err) {
        console.error(`[Cron][Reminders] Error checking turned-in for ${a.id}`, err);
      }
      console.log(`[Cron][Reminders] Submission status=TURNED_IN? ${turnedIn}`);
      if (turnedIn) {
        console.log("[Cron][Reminders] ✅ Skipping because already TURNED_IN.");
        continue;
      }

      // Reminder windows
      const reminders = [36, 12, 6, 2]; // added 36h
      for (const h of reminders) {
        const alreadySent = await reminderAlreadySent(a.id, googleId, `${h}h`);
        console.log(`[Cron][Reminders] Check reminder ${h}h: alreadySent=${alreadySent}`);

        // Use +/- 0.5 hour tolerance for matching window (30 minutes)
        if (Math.abs(diffHours - h) <= 0.5 && !alreadySent) {
          const formattedTime = formatDueDateTime(a.dueDate, a.dueTime);
          const link = a.alternateLink || course.alternateLink || "https://classroom.google.com";
          const message = `📌 Assignment Reminder (${h}h left)\nCourse: ${course.name}\nTitle: ${a.title}\nDue: ${formattedTime}\nLink: ${link}`;
          console.log(`[Cron][Reminders][SEND]`, message);
          await sendMessageToGoogleUser(googleId, message);
          await markReminderSent(a.id, googleId, `${h}h`);
          break;
        }
      }

      // ===== Missing / Late notification (send once, 1 minute after deadline) =====
      // If due has passed and it's been at least 1 minute, send a missing alert (one-time).
      const overdueMinutes = (now.getTime() - due.getTime()) / (1000 * 60);
      if (overdueMinutes >= 1 && overdueMinutes < 60 * 24) {
        // check if missing already sent
        const alreadyMissing = await reminderAlreadySent(a.id, googleId, "missing");
        console.log(`[Cron][Reminders] overdueMinutes=${overdueMinutes.toFixed(2)}, alreadyMissing=${alreadyMissing}`);
        if (!alreadyMissing && !turnedIn) {
          const formattedTime = formatDueDateTime(a.dueDate, a.dueTime);
          const link = a.alternateLink || course.alternateLink || "https://classroom.google.com";
          const message = `⚠️ Assignment Missing / Late\nCourse: ${course.name}\nTitle: ${a.title}\nDeadline was: ${formattedTime}\nLink: ${link}`;
          console.log(`[Cron][Reminders][MISSING SEND]`, message);
          await sendMessageToGoogleUser(googleId, message);
          await markReminderSent(a.id, googleId, "missing");
        }
      }
    }
  }
}

// =========================
// Main cron runner
// =========================
export async function runCronJobs() {
  console.log("⏰ [Cron] Job started for all registered users...");
  const allGoogleIds = await getAllUserGoogleIds();
  console.log(`[Cron] Found ${allGoogleIds.length} registered users to check.`);

  for (const googleId of allGoogleIds) {
    const user = await getUser(googleId);
    if (!user || !user.refreshToken) {
      console.log("[Cron] Skipping user without refreshToken:", googleId);
      continue;
    }

    console.log(`[Cron] === User: ${googleId} ===`);
    const userOAuthClient = createOAuth2ClientForUser(user.refreshToken);
    const courses = await fetchCourses(userOAuthClient);
    console.log(`[Cron] User has ${courses.length} ACTIVE courses.`);

    console.log("[Cron] ---- Reminders pass ----");
    await checkReminders(userOAuthClient, googleId, courses);

    console.log("[Cron] ---- New Assignments pass ----");
    await checkNewAssignmentsPosted(userOAuthClient, googleId, courses);

    console.log("[Cron] ---- New Content pass ----");
    await checkNewContent(userOAuthClient, googleId, courses);

    console.log(`[Cron] === Done: ${googleId} ===`);
  }

  console.log("⏰ [Cron] Job finished for all users.");
}
