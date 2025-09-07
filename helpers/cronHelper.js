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
import { buildClassroomLink } from "./linkHelper.js"; // ✅ NEW

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

    console.log(`[Cron][DEBUG] Course=${course.name}(${course.id}) announcements=${announcements.length}, materials=${materials.length}`);

    const allContent = [
      ...announcements.map(a => ({ ...a, __type: "announcement" })),
      ...materials.map(m => ({ ...m, __type: "material" })),
    ].sort((a, b) => new Date(b.updateTime) - new Date(a.updateTime));

    if (allContent.length === 0) {
      console.log(`[Cron][DEBUG] No content in ${course.name}.`);
      continue;
    }
    const latestContentTime = allContent[0].updateTime;

    // ===== First run → last 2 hours
    if (!lastCheckedString) {
      console.log(
        `[Cron][DEBUG] First run for ${course.name}, sending last 2h content...`
      );
      const now = new Date();
      for (const content of allContent) {
        const contentTime = new Date(content.updateTime);
        const inWindow = contentTime > new Date(now.getTime() - 2 * 60 * 60 * 1000);
        console.log(`[Cron][DEBUG] contentId=${content.id} type=${content.__type} update=${content.updateTime} inLast2h=${inWindow}`);
        if (inWindow) {
          const link = buildClassroomLink({
            courseId: course.id,
            itemId: content.id,
            type: content.__type,
          });
          const message =
            content.__type === "material"
              ? `📌 Material\nCourse: ${course.name}\nTitle: ${content.title}\nLink: ${link}`
              : `📌 Announcement\nCourse: ${course.name}\nText: ${content.text}\nLink: ${link}`;
          console.log(`[Cron][SEND] ${message}`);
          await sendMessageToGoogleUser(googleId, message);
        }
      }
      await setLastCheckedTime(
        course.id,
        new Date(latestContentTime).toISOString()
      );
      continue;
    }

    // ===== Normal run → only new content
    console.log(
      `[Cron][DEBUG] LastChecked for ${course.name}: ${lastCheckedString}`
    );
    for (const content of allContent) {
      const contentTime = new Date(content.updateTime);
      const isNewer = contentTime > new Date(lastCheckedString);
      console.log(`[Cron][DEBUG] Compare contentId=${content.id} type=${content.__type} update=${content.updateTime} > lastChecked=${lastCheckedString} => ${isNewer}`);
      if (isNewer) {
        const link = buildClassroomLink({
          courseId: course.id,
          itemId: content.id,
          type: content.__type,
        });
        const message =
          content.__type === "material"
            ? `📌 Material\nCourse: ${course.name}\nTitle: ${content.title}\nLink: ${link}`
            : `📌 Announcement\nCourse: ${course.name}\nText: ${content.text}\nLink: ${link}`;
        console.log(`[Cron][SEND] ${message}`);
        await sendMessageToGoogleUser(googleId, message);
      } else {
        console.log("[Cron][BREAK] No newer content found beyond this point.");
        break;
      }
    }

    await setLastCheckedTime(
      course.id,
      new Date(latestContentTime).toISOString()
    );
    console.log(
      `[Cron][DEBUG] LastChecked updated for ${course.name}: ${latestContentTime}`
    );
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
        `[Cron][DEBUG] Assignment "${a.title}" id=${a.id} courseId=${course.id} due=${due.toISOString()}, diffHours=${diffHours.toFixed(2)}`
      );

      if (diffHours <= 0 || diffHours > 24.5) {
        console.log(`[Cron][DEBUG] Skipping reminder window. diffHours=${diffHours.toFixed(2)}`);
        continue; // ignore past/far future
      }

      const turnedIn = await isTurnedIn(oauth2Client, course.id, a.id, "me");
      console.log(`[Cron][DEBUG] TurnedIn=${turnedIn}`);
      if (turnedIn) continue;

      const reminders = [24, 12, 6, 2]; // windows
      for (const h of reminders) {
        const alreadySent = await reminderAlreadySent(a.id, googleId, `${h}h`);
        console.log(
          `[Cron][DEBUG] Checking reminder ${h}h: alreadySent=${alreadySent}`
        );
        if (diffHours <= h && !alreadySent) {
          const formattedTime = formatDueDateTime(a.dueDate, a.dueTime);
          const link = buildClassroomLink({
            courseId: course.id,
            itemId: a.id,
            type: "assignment",
          });
          const message =
            `📌 Assignment Reminder\n` +
            `Course: ${course.name}\n` +
            `Title: ${a.title}\n` +
            `Due: ${formattedTime}\n` +
            `Link: ${link}`;
          console.log(`[Cron][SEND] ${message}`);
          await sendMessageToGoogleUser(googleId, message);
          await markReminderSent(a.id, googleId, `${h}h`);
          break; // prevent multiple reminders in same run
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
    const user = await getUser(googleId);
    if (!user || !user.refreshToken) continue;

    console.log(
      `[Cron][DEBUG] User ${googleId} has ${user.courses?.length || 0} courses.`
    );

    const userOAuthClient = createOAuth2ClientForUser(user.refreshToken);
    const courses = await fetchCourses(userOAuthClient);

    console.log("[Cron] =========================");
    await checkReminders(userOAuthClient, googleId, courses);
    console.log("[Cron] =========================");
    await checkNewContent(userOAuthClient, googleId, courses);
  }

  console.log("⏰ Cron job finished for all users.");
}
