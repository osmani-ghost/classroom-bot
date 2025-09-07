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
  getLastAssignmentTime,
  setLastAssignmentTime,
  saveIndexedItem,
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
// Check new content (Announcements & Materials)
// =========================
async function checkNewContent(oauth2Client, googleId, courses) {
  console.log(`[Cron] Checking new content for user: ${googleId}`);

  for (const course of courses) {
    if (!course) continue;
    if (course.ownerId === googleId) {
      console.log(`[Cron][DEBUG] Skipping teacher course: ${course.name}`);
      continue;
    }

    const lastCheckedString = await getLastCheckedTime(course.id);
    const announcements = await fetchAnnouncements(oauth2Client, course.id);
    const materials = await fetchMaterials(oauth2Client, course.id);
    const allContent = [...(announcements || []), ...(materials || [])].sort(
      (a, b) => new Date(b.updateTime || b.creationTime) - new Date(a.updateTime || a.creationTime)
    );

    if (allContent.length === 0) continue;
    const latestContentTime = allContent[0].updateTime || allContent[0].creationTime;

    if (!lastCheckedString) {
      console.log(`[Cron][DEBUG] First run for ${course.name}, sending last 2h content...`);
      const now = new Date();
      for (const content of allContent) {
        const contentTime = new Date(content.updateTime || content.creationTime);
        if (contentTime > new Date(now.getTime() - 2 * 60 * 60 * 1000)) {
          const link = content.alternateLink || "Link not available";
          const message = content.title
            ? `📌 Material\nCourse: ${course.name}\nTitle: ${content.title}\nLink: ${link}`
            : `📌 Announcement\nCourse: ${course.name}\nText: ${content.text}\nLink: ${link}`;
          console.log(`[Cron][SEND] ${message}`);
          await sendMessageToGoogleUser(googleId, message);

          // Save to index
          await saveIndexedItem(googleId, {
            id: content.id,
            type: content.title ? "material" : "announcement",
            courseId: course.id,
            courseName: course.name,
            title: content.title || content.text || "Material/Announcement",
            description: content.description || content.text || "",
            createdTime: content.updateTime || content.creationTime || new Date().toISOString(),
            link: content.alternateLink || null,
            raw: content,
          });
        }
      }
      await setLastCheckedTime(course.id, new Date(latestContentTime).toISOString());
      continue;
    }

    console.log(`[Cron][DEBUG] LastChecked for ${course.name}: ${lastCheckedString}`);
    for (const content of allContent) {
      const contentTime = new Date(content.updateTime || content.creationTime);
      if (contentTime > new Date(lastCheckedString)) {
        const link = content.alternateLink || "Link not available";
        const message = content.title
          ? `📌 Material\nCourse: ${course.name}\nTitle: ${content.title}\nLink: ${link}`
          : `📌 Announcement\nCourse: ${course.name}\nText: ${content.text}\nLink: ${link}`;
        console.log(`[Cron][SEND] ${message}`);
        await sendMessageToGoogleUser(googleId, message);

        // Save to index
        await saveIndexedItem(googleId, {
          id: content.id,
          type: content.title ? "material" : "announcement",
          courseId: course.id,
          courseName: course.name,
          title: content.title || content.text || "Material/Announcement",
          description: content.description || content.text || "",
          createdTime: content.updateTime || content.creationTime || new Date().toISOString(),
          link: content.alternateLink || null,
          raw: content,
        });
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
// Check new assignments (IMMEDIATE NOTIFICATIONS)
// =========================
async function checkNewAssignments(oauth2Client, googleId, courses) {
  console.log(`[Cron] Checking new assignments for user: ${googleId}`);
  for (const course of courses) {
    if (!course) continue;
    if (course.ownerId === googleId) {
      console.log(`[Cron][DEBUG] Skipping teacher course: ${course.name}`);
      continue;
    }
    const lastAssignmentString = await getLastAssignmentTime(course.id);
    const assignments = await fetchAssignments(oauth2Client, course.id);
    if (!assignments || assignments.length === 0) continue;

    const sorted = assignments.sort((a, b) => new Date(b.creationTime || b.updateTime) - new Date(a.creationTime || a.updateTime));
    const newest = sorted[0];
    const newestTime = newest?.creationTime || newest?.updateTime || new Date().toISOString();

    if (!lastAssignmentString) {
      console.log(`[Cron][DEBUG] First-run assignment indexing for ${course.name}. Indexing recent assignments but not notifying old ones.`);
      for (const a of sorted.slice(0, 30)) {
        if (!a) continue;
        await saveIndexedItem(googleId, {
          id: a.id,
          type: "assignment",
          courseId: course.id,
          courseName: course.name,
          title: a.title || a.alternateLink || "Untitled",
          description: a.description || "",
          createdTime: a.creationTime || a.updateTime || new Date().toISOString(),
          dueDate: a.dueDate || null,
          dueTime: a.dueTime || null,
          link: a.alternateLink || null,
          raw: a,
        });
      }
      await setLastAssignmentTime(course.id, new Date(newestTime).toISOString());
      continue;
    }

    console.log(`[Cron][DEBUG] LastAssignment for ${course.name}: ${lastAssignmentString}`);
    for (const a of sorted) {
      if (!a) continue;
      const aTime = new Date(a.creationTime || a.updateTime);
      if (aTime > new Date(lastAssignmentString)) {
        console.log(`[Cron][NEW ASSIGNMENT] ${course.name}: ${a.title} created at ${aTime.toISOString()}`);
        await saveIndexedItem(googleId, {
          id: a.id,
          type: "assignment",
          courseId: course.id,
          courseName: course.name,
          title: a.title || a.alternateLink || "Untitled",
          description: a.description || "",
          createdTime: a.creationTime || a.updateTime || new Date().toISOString(),
          dueDate: a.dueDate || null,
          dueTime: a.dueTime || null,
          link: a.alternateLink || null,
          raw: a,
        });

        const formattedDue = a.dueDate ? formatDueDateTime(a.dueDate, a.dueTime) : "No due date";
        const link = a.alternateLink || "Link not available";
        const message = `📌 New Assignment Posted\nCourse: ${course.name}\nTitle: ${a.title}\nDue: ${formattedDue}\nLink: ${link}`;
        console.log(`[Cron][SEND] New assignment message -> ${message}`);
        await sendMessageToGoogleUser(googleId, message);
      } else {
        console.log(`[Cron][DEBUG] Assignment ${a.title} is not newer than lastAssignment; stopping further checks.`);
        break;
      }
    }
    await setLastAssignmentTime(course.id, new Date(newestTime).toISOString());
  }
}

// =========================
// Assignment reminders
// =========================
async function checkReminders(oauth2Client, googleId, courses) {
  console.log(`[Cron] Checking assignment reminders for user: ${googleId}`);
  const now = new Date();

  for (const course of courses) {
    if (!course) continue;
    if (course.ownerId === googleId) {
      console.log(`[Cron][DEBUG] Skipping teacher course: ${course.name}`);
      continue;
    }

    const assignments = await fetchAssignments(oauth2Client, course.id);
    console.log(`[Cron][DEBUG] Course ${course.name} -> Assignments: ${assignments.length}`);

    for (const a of assignments || []) {
      if (!a || !a.dueDate) continue;

      const due = new Date(
        Date.UTC(
          a.dueDate.year,
          a.dueDate.month - 1,
          a.dueDate.day,
          a.dueTime?.hours || 23,
          a.dueTime?.minutes || 0
        )
      );
      const diffHours = (due.getTime() - now.getTime()) / (1000 * 60 * 60);

      console.log(`[Cron][DEBUG] Assignment "${a.title}" due=${due.toISOString()}, diffHours=${diffHours.toFixed(2)}`);

      if (diffHours <= 0 || diffHours > 24.5) continue; // ignore past/far future

      const turnedIn = await isTurnedIn(oauth2Client, course.id, a.id, "me");
      console.log(`[Cron][DEBUG] TurnedIn=${turnedIn}`);
      if (turnedIn) continue;

      const reminders = [24, 12, 6, 2];
      for (const h of reminders) {
        const alreadySent = await reminderAlreadySent(a.id, googleId, `${h}h`);
        console.log(`[Cron][DEBUG] Checking reminder ${h}h: alreadySent=${alreadySent}`);
        if (diffHours <= h && !alreadySent) {
          const formattedTime = formatDueDateTime(a.dueDate, a.dueTime);
          const link = a.alternateLink || "Link not available";
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
  console.log(`[Cron] Found ${allGoogleIds.length} registered users to check.`);

  for (const googleId of allGoogleIds) {
    const user = await getUser(googleId);
    if (!user || !user.refreshToken) {
      console.log(`[Cron] Skipping user ${googleId} because no refresh token or user record.`);
      continue;
    }

    console.log(`[Cron][DEBUG] User ${googleId} will be processed.`);

    const userOAuthClient = createOAuth2ClientForUser(user.refreshToken);
    const courses = await fetchCourses(userOAuthClient);

    console.log("[Cron] =========================");
    await checkReminders(userOAuthClient, googleId, courses);
    console.log("[Cron] =========================");
    await checkNewContent(userOAuthClient, googleId, courses);
    console.log("[Cron] =========================");
    await checkNewAssignments(userOAuthClient, googleId, courses);
    console.log("[Cron] =========================");
  }

  console.log("⏰ Cron job finished for all users.");
}
