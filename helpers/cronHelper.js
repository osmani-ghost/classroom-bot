// classroom/helpers/cronHelper.js
// Cron logic that scans every registered user:
// - New assignments posted (immediate notifications when a new assignment appears)
// - New content (announcements & materials)
// - Reminder flow (36h, 12h, 6h, 2h) and missing assignment alert (1 minute after deadline)
// Uses Redis via redisHelper and notifier via messengerHelper

import { google } from "googleapis";
import {
  fetchCourses,
  fetchAssignments,
  isTurnedIn,
  fetchAnnouncements,
  fetchMaterials,
} from "./classroomHelper.js";

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

import { sendMessageToGoogleUser } from "./messengerHelper.js";

function log(label, details) {
  console.log(`[Cron][${label}]`, details || "");
}

function createOAuth2Client(refreshToken) {
  log("OAuthClient", "creating from refresh token");
  const client = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, process.env.GOOGLE_REDIRECT_URI);
  client.setCredentials({ refresh_token: refreshToken });
  return client;
}

function formatDueDateTime(dueDate, dueTime) {
  if (!dueDate) return "End of day";
  const d = new Date(Date.UTC(dueDate.year, dueDate.month - 1, dueDate.day, dueTime?.hours ?? 23, dueTime?.minutes ?? 0));
  // convert to BDT
  d.setHours(d.getHours() + 6);
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  let hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, "0");
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12 || 12;
  return `${day}-${month}-${year}, ${hours}:${minutes} ${ampm}`;
}

// Check new announcements/materials since last checked time per COURSE
async function checkNewContentForUser(oauthClient, googleId, courses) {
  log("checkNewContentForUser", { googleId, courseCount: courses.length });
  for (const course of courses) {
    // Skip courses owned by the user (teacher) - optional but preserved from previous logic
    if (course.ownerId === googleId) continue;

    const lastChecked = await getLastCheckedTime(course.id);
    const announcements = await fetchAnnouncements(oauthClient, course.id);
    const materials = await fetchMaterials(oauthClient, course.id);
    const all = [...(announcements || []), ...(materials || [])].sort((a, b) => new Date(b.updateTime) - new Date(a.updateTime));
    if (!all || all.length === 0) continue;
    const latestTime = all[0].updateTime;

    if (!lastChecked) {
      // first-run: scan last 2 hours
      const now = Date.now();
      for (const c of all) {
        const t = new Date(c.updateTime).getTime();
        if (t > now - 2 * 60 * 60 * 1000) {
          const link = c.alternateLink || course.alternateLink || "https://classroom.google.com";
          const message = c.title
            ? `📌 New Material\nCourse: ${course.name}\nTitle: ${c.title}\n🔗 ${link}`
            : `📌 New Announcement\nCourse: ${course.name}\nText: ${c.text || "(No text)"}\n🔗 ${link}`;
          await sendMessageToGoogleUser(googleId, message);
        }
      }
      await setLastCheckedTime(course.id, new Date(latestTime).toISOString());
      continue;
    }

    // subsequent runs - notify new ones only
    for (const c of all) {
      const t = new Date(c.updateTime).getTime();
      if (t > new Date(lastChecked).getTime()) {
        const link = c.alternateLink || course.alternateLink || "https://classroom.google.com";
        const message = c.title
          ? `📌 New Material\nCourse: ${course.name}\nTitle: ${c.title}\n🔗 ${link}`
          : `📌 New Announcement\nCourse: ${course.name}\nText: ${c.text || "(No text)"}\n🔗 ${link}`;
        await sendMessageToGoogleUser(googleId, message);
      } else {
        break;
      }
    }
    await setLastCheckedTime(course.id, new Date(latestTime).toISOString());
  }
}

// Check new assignments posted (immediate notification when posted)
async function checkNewAssignmentsPostedForUser(oauthClient, googleId, courses) {
  log("checkNewAssignmentsPostedForUser", { googleId, courseCount: courses.length });
  for (const course of courses) {
    if (course.ownerId === googleId) continue;

    const lastChecked = await getLastCheckedAssignmentsTime(course.id);
    const assignments = await fetchAssignments(oauthClient, course.id);
    if (!assignments || assignments.length === 0) continue;
    const latest = assignments[0].updateTime || assignments[0].creationTime;

    if (!lastChecked) {
      const now = Date.now();
      for (const a of assignments) {
        const t = new Date(a.updateTime || a.creationTime || 0).getTime();
        if (t > now - 2 * 60 * 60 * 1000) {
          const when = a.dueDate ? formatDueDateTime(a.dueDate, a.dueTime) : "No due date set";
          const link = a.alternateLink || course.alternateLink || "https://classroom.google.com";
          const msg = `📌 New Assignment Posted\nCourse: ${course.name}\nTitle: ${a.title}\nDue: ${when}\n🔗 ${link}`;
          await sendMessageToGoogleUser(googleId, msg);
        }
      }
      await setLastCheckedAssignmentsTime(course.id, new Date(latest).toISOString());
      continue;
    }

    for (const a of assignments) {
      const t = new Date(a.updateTime || a.creationTime || 0).getTime();
      if (t > new Date(lastChecked).getTime()) {
        const when = a.dueDate ? formatDueDateTime(a.dueDate, a.dueTime) : "No due date set";
        const link = a.alternateLink || course.alternateLink || "https://classroom.google.com";
        const msg = `📌 New Assignment Posted\nCourse: ${course.name}\nTitle: ${a.title}\nDue: ${when}\n🔗 ${link}`;
        await sendMessageToGoogleUser(googleId, msg);
      } else {
        break;
      }
    }
    await setLastCheckedAssignmentsTime(course.id, new Date(latest).toISOString());
  }
}

// Assignment reminders & missing alerts
async function checkRemindersForUser(oauthClient, googleId, courses) {
  log("checkRemindersForUser", { googleId, courseCount: courses.length });
  const now = Date.now();

  for (const course of courses) {
    if (course.ownerId === googleId) continue;

    const assignments = await fetchAssignments(oauthClient, course.id);
    if (!assignments || assignments.length === 0) continue;

    for (const a of assignments) {
      // only consider ones with dueDate
      if (!a.dueDate) continue;

      const dueUtc = Date.UTC(a.dueDate.year, a.dueDate.month - 1, a.dueDate.day, a.dueTime?.hours ?? 23, a.dueTime?.minutes ?? 0);
      // diff in minutes
      const diffMin = (new Date(dueUtc).getTime() - now) / (1000 * 60);
      const diffHours = diffMin / 60;

      // skip very old items (older than 14 days past due)
      if (diffMin < -60 * 24 * 14) continue;

      // skip if already turned in
      const turnedIn = await isTurnedIn(oauthClient, course.id, a.id, "me");
      if (turnedIn) continue;

      // Missing: send once when > 1 minute past due
      const alreadyMissing = await reminderAlreadySent(a.id, googleId, "missing");
      if (diffMin <= -1 && !alreadyMissing) {
        const formatted = a.dueDate ? formatDueDateTime(a.dueDate, a.dueTime) : "No due date set";
        const link = a.alternateLink || course.alternateLink || "https://classroom.google.com";
        const message = `⚠️ Assignment Missing\nCourse: ${course.name}\nTitle: ${a.title}\nDeadline was: ${formatted}\n🔗 ${link}`;
        await sendMessageToGoogleUser(googleId, message);
        await markReminderSent(a.id, googleId, "missing");
      }

      // Scheduled reminders only for future within 72h window
      if (diffHours <= 0 || diffHours > 72) {
        // skip past due (we handled missing) or too far in future
        continue;
      }

      // Checkpoints: 36h, 12h, 6h, 2h
      const checkpoints = [36, 12, 6, 2];
      for (const h of checkpoints) {
        const tag = `${h}h`;
        const already = await reminderAlreadySent(a.id, googleId, tag);
        // send when diffHours is approx equal to h (±0.5h)
        if (Math.abs(diffHours - h) <= 0.5 && !already) {
          const formatted = a.dueDate ? formatDueDateTime(a.dueDate, a.dueTime) : "No due date set";
          const link = a.alternateLink || course.alternateLink || "https://classroom.google.com";
          const message = `⏰ Assignment Reminder (${h}h left)\nCourse: ${course.name}\nTitle: ${a.title}\nDue: ${formatted}\n🔗 ${link}`;
          await sendMessageToGoogleUser(googleId, message);
          await markReminderSent(a.id, googleId, tag);
          break; // only one checkpoint per run
        }
      }
    }
  }
}

export async function runCronJobs() {
  log("runCronJobs", "Starting cron for all users");
  const ids = await getAllUserGoogleIds();
  log("runCronJobs", { userCount: ids.length });

  for (const gid of ids) {
    try {
      const user = await getUser(gid);
      if (!user || !user.refreshToken) {
        log("runCronJobs", `Skipping googleId=${gid} due to missing user/refreshToken`);
        continue;
      }
      const oauth = createOAuth2Client(user.refreshToken);
      const courses = await fetchCourses(oauth);

      // Reminders
      await checkRemindersForUser(oauth, gid, courses);

      // New assignments posted
      await checkNewAssignmentsPostedForUser(oauth, gid, courses);

      // New announcements/materials
      await checkNewContentForUser(oauth, gid, courses);
    } catch (err) {
      console.error("[Cron] Error processing user", gid, err);
    }
  }

  log("runCronJobs", "Finished all users");
}
