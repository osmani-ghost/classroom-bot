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
  for (const course of courses) {
    if (!course || course.ownerId === googleId) continue;
    const lastCheckedString = await getLastCheckedTime(course.id);
    const announcements = await fetchAnnouncements(oauth2Client, course.id);
    const materials = await fetchMaterials(oauth2Client, course.id);
    const allContent = [...(announcements || []), ...(materials || [])].sort(
      (a, b) => new Date(b.updateTime || b.creationTime) - new Date(a.updateTime || a.creationTime)
    );
    if (allContent.length === 0) continue;
    const latestContentTime = allContent[0].updateTime || allContent[0].creationTime;

    for (const content of allContent) {
      const contentTime = new Date(content.updateTime || content.creationTime);
      if (!lastCheckedString || contentTime > new Date(lastCheckedString)) {
        const link = content.alternateLink || "Link not available";
        const message = content.title
          ? `📌 Material\nCourse: ${course.name}\nTitle: ${content.title}\nLink: ${link}`
          : `📌 Announcement\nCourse: ${course.name}\nText: ${content.text}\nLink: ${link}`;
        await sendMessageToGoogleUser(googleId, message);

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
      } else break;
    }
    await setLastCheckedTime(course.id, new Date(latestContentTime).toISOString());
  }
}

// =========================
// Check new assignments
// =========================
async function checkNewAssignments(oauth2Client, googleId, courses) {
  for (const course of courses) {
    if (!course || course.ownerId === googleId) continue;
    const lastAssignmentString = await getLastAssignmentTime(course.id);
    const assignments = await fetchAssignments(oauth2Client, course.id);
    if (!assignments?.length) continue;

    const sorted = assignments.sort(
      (a, b) => new Date(b.creationTime || b.updateTime) - new Date(a.creationTime || a.updateTime)
    );
    const newestTime = sorted[0]?.creationTime || sorted[0]?.updateTime || new Date().toISOString();

    for (const a of sorted) {
      const aTime = new Date(a.creationTime || a.updateTime);
      if (!lastAssignmentString || aTime > new Date(lastAssignmentString)) {
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

        if (lastAssignmentString) {
          const formattedDue = a.dueDate ? formatDueDateTime(a.dueDate, a.dueTime) : "No due date";
          const link = a.alternateLink || "Link not available";
          const message = `📌 New Assignment Posted\nCourse: ${course.name}\nTitle: ${a.title}\nDue: ${formattedDue}\nLink: ${link}`;
          await sendMessageToGoogleUser(googleId, message);
        }
      } else break;
    }
    await setLastAssignmentTime(course.id, new Date(newestTime).toISOString());
  }
}

// =========================
// Assignment reminders
// =========================
async function checkReminders(oauth2Client, googleId, courses) {
  const now = new Date();
  for (const course of courses) {
    if (!course || course.ownerId === googleId) continue;
    const assignments = await fetchAssignments(oauth2Client, course.id);

    for (const a of assignments || []) {
      if (!a?.dueDate) continue;
      const due = new Date(
        Date.UTC(
          a.dueDate.year,
          a.dueDate.month - 1,
          a.dueDate.day,
          a.dueTime?.hours || 23,
          a.dueTime?.minutes || 0
        )
      );
      const diffHours = (due - now) / (1000 * 60 * 60);
      if (diffHours <= 0 || diffHours > 24.5) continue;
      if (await isTurnedIn(oauth2Client, course.id, a.id, "me")) continue;

      for (const h of [24, 12, 6, 2]) {
        if (diffHours <= h && !(await reminderAlreadySent(a.id, googleId, `${h}h`))) {
          const formattedTime = formatDueDateTime(a.dueDate, a.dueTime);
          const link = a.alternateLink || "Link not available";
          const message = `📌 Assignment Reminder\nCourse: ${course.name}\nTitle: ${a.title}\nDue: ${formattedTime}\nLink: ${link}`;
          await sendMessageToGoogleUser(googleId, message);
          await markReminderSent(a.id, googleId, `${h}h`);
          break;
        }
      }
    }
  }
}

// =========================
// Main cron runner (Parallel per user)
// =========================
export async function runCronJobs() {
  console.log("⏰ Cron job started for all registered users...");
  const allGoogleIds = await getAllUserGoogleIds();
  console.log(`[Cron] Found ${allGoogleIds.length} registered users.`);

  await Promise.all(
    allGoogleIds.map(async (googleId) => {
      try {
        const user = await getUser(googleId);
        if (!user?.refreshToken) return;

        const oauthClient = createOAuth2ClientForUser(user.refreshToken);
        const courses = await fetchCourses(oauthClient);

        await checkReminders(oauthClient, googleId, courses);
        await checkNewContent(oauthClient, googleId, courses);
        await checkNewAssignments(oauthClient, googleId, courses);

        console.log(`[Cron] Finished processing user: ${googleId}`);
      } catch (err) {
        console.error(`[Cron][ERROR] User ${googleId} ->`, err);
      }
    })
  );

  console.log("⏰ Cron job finished for all users.");
}
