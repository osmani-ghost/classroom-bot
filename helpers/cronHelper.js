import { google } from "googleapis";
import {
  fetchCourses,
  fetchAssignments,
  isTurnedIn,
  fetchAnnouncements,
  fetchMaterials,
  generateKeywordsFromText,
} from "./classroomHelper.js";
import { sendMessageToGoogleUser } from "./messengerHelper.js";
import {
  getAllUserGoogleIds,
  getUser,
  reminderAlreadySent,
  markReminderSent,
  getLastCheckedTime,
  setLastCheckedTime,
  itemExistsForPsid,
  saveItemForPsid,
} from "./redisHelper.js";

// Create OAuth2 client for user
function createOAuth2ClientForUser(refreshToken) {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  return oauth2Client;
}

// Format Date + Time → AM/PM BDT
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
  const day = String(utcDate.getDate()).padStart(2, "0");
  const month = String(utcDate.getMonth() + 1).padStart(2, "0");
  const year = utcDate.getFullYear();
  let hours = utcDate.getHours();
  const minutes = String(utcDate.getMinutes()).padStart(2, "0");
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12 || 12;
  return `${day}-${month}-${year}, ${hours}:${minutes} ${ampm}`;
}

// Check new content (Announcements & Materials)
async function checkNewContent(oauth2Client, googleId, courses) {
  console.log(`[Cron] Checking new content for user: ${googleId}`);
  const user = await getUser(googleId);
  const psid = user?.psid;
  for (const course of courses) {
    if (course.ownerId === googleId) {
      console.log(`[Cron][DEBUG] Skipping teacher course: ${course.name}`);
      continue;
    }
    const lastCheckedString = await getLastCheckedTime(course.id);
    console.log(`[Cron][DEBUG] LastChecked for ${course.name}: ${lastCheckedString}`);
    const announcements = await fetchAnnouncements(oauth2Client, course.id);
    const materials = await fetchMaterials(oauth2Client, course.id);
    const allContent = [...announcements, ...materials].sort(
      (a, b) => new Date(b.updateTime) - new Date(a.updateTime)
    );
    if (allContent.length === 0) {
      console.log(`[Cron][DEBUG] No announcements/materials for course ${course.name}`);
      continue;
    }
    const latestContentTime = allContent[0].updateTime;
    if (!lastCheckedString) {
      console.log(`[Cron][DEBUG] First run for ${course.name}, sending last 2h content...`);
      const now = new Date();
      for (const content of allContent) {
        const contentTime = new Date(content.updateTime);
        if (contentTime > new Date(now.getTime() - 2 * 60 * 60 * 1000)) {
          const link = content.alternateLink || "Link not available";
          const message = content.title
            ? `📌 Material\nCourse: ${course.name}\nTitle: ${content.title}\nLink: ${link}`
            : `📌 Announcement\nCourse: ${course.name}\nText: ${content.text}\nLink: ${link}`;
          console.log(`[Cron][SEND] ${message}`);
          await sendMessageToGoogleUser(googleId, message);
        }
      }
      await setLastCheckedTime(course.id, new Date(latestContentTime).toISOString());
      continue;
    }

    for (const content of allContent) {
      const contentTime = new Date(content.updateTime);
      if (contentTime > new Date(lastCheckedString)) {
        const link = content.alternateLink || "Link not available";
        const message = content.title
          ? `📌 Material\nCourse: ${course.name}\nTitle: ${content.title}\nLink: ${link}`
          : `📌 Announcement\nCourse: ${course.name}\nText: ${content.text}\nLink: ${link}`;
        console.log(`[Cron][SEND] New content found -> ${message}`);
        await sendMessageToGoogleUser(googleId, message);

        // Save to Redis index as new item (ongoing sync)
        try {
          const itemObj = {
            id: content.id,
            title: content.title || (content.text ? content.text.slice(0, 80) : "Untitled"),
            type: content.title ? "material" : "announcement",
            courseId: course.id,
            courseName: course.name,
            createdAt: content.createTime || content.updateTime || new Date().toISOString(),
            dueDate: null,
            link: content.alternateLink || null,
            keywords: generateKeywordsFromText((content.title || "") + " " + (content.text || "")),
          };
          if (psid) {
            const exists = await itemExistsForPsid(psid, itemObj.id);
            if (!exists) {
              console.log(`[Cron] Saving new content item to Redis for PSID ${psid}: ${itemObj.id}`);
              await saveItemForPsid(psid, itemObj);
            } else {
              console.log(`[Cron] Content item already exists in Redis: ${itemObj.id}`);
            }
          } else {
            console.warn(`[Cron] No PSID for googleId ${googleId}; cannot index content.`);
          }
        } catch (err) {
          console.error("[Cron] Error saving new content item to Redis:", err);
        }
      } else {
        console.log("[Cron][BREAK] No newer content found beyond this point.");
        break;
      }
    }

    await setLastCheckedTime(course.id, new Date(latestContentTime).toISOString());
    console.log(`[Cron][DEBUG] LastChecked updated for ${course.name}: ${latestContentTime}`);
  }
}

// Assignment reminders + new assignment detection
async function checkReminders(oauth2Client, googleId, courses) {
  console.log(`[Cron] Checking assignment reminders for user: ${googleId}`);
  const user = await getUser(googleId);
  const psid = user?.psid;
  const now = new Date();
  for (const course of courses) {
    if (course.ownerId === googleId) {
      console.log(`[Cron][DEBUG] Skipping teacher course: ${course.name}`);
      continue;
    }
    const assignments = await fetchAssignments(oauth2Client, course.id);
    console.log(`[Cron][DEBUG] Course ${course.name} -> Assignments: ${assignments.length}`);

    for (const a of assignments) {
      // Indexing: check if assignment exists in Redis for this user -> if not, treat as NEW
      try {
        if (psid) {
          const exists = await itemExistsForPsid(psid, a.id);
          if (!exists) {
            // NEW assignment discovered -> Save and notify immediately
            console.log(`[Cron] New assignment detected for PSID ${psid}: ${a.id}`);
            const dueDateISO = a.dueDate
              ? new Date(
                  Date.UTC(
                    a.dueDate.year,
                    a.dueDate.month - 1,
                    a.dueDate.day,
                    a.dueTime?.hours || 23,
                    a.dueTime?.minutes || 0
                  )
                ).toISOString()
              : null;
            const itemObj = {
              id: a.id,
              title: a.title || "Untitled Assignment",
              type: "assignment",
              courseId: course.id,
              courseName: course.name,
              createdAt: a.creationTime || a.updateTime || new Date().toISOString(),
              dueDate: dueDateISO,
              link: a.alternateLink || null,
              keywords: generateKeywordsFromText(`${a.title} ${a.description || ""}`),
            };
            try {
              await saveItemForPsid(psid, itemObj);
              // Send immediate notification with strict required format
              const formattedDue = a.dueDate ? formatDueDateTime(a.dueDate, a.dueTime) : "No due date";
              const message = `📌 New Assignment Posted

Course: ${course.name}
Title: ${a.title}
Due: ${formattedDue}

View Assignment: ${a.alternateLink || "Link not available"}`;
              console.log(`[Cron][SEND-NEW] Sending immediate new assignment notification to googleId=${googleId}`);
              await sendMessageToGoogleUser(googleId, message);
            } catch (err) {
              console.error("[Cron] Failed to save new assignment or send notification:", err);
            }
          } else {
            // exists -> nothing
            // console.log(`[Cron] Assignment already indexed: ${a.id}`);
          }
        } else {
          console.warn(`[Cron] No PSID available for Google ID ${googleId}; cannot index or notify new assignments.`);
        }
      } catch (err) {
        console.error("[Cron] Error checking itemExistsForPsid:", err);
      }

      // Continue with reminder logic (existing)
      try {
        if (!a.dueDate || !a.dueTime) continue;
        const due = new Date(
          Date.UTC(a.dueDate.year, a.dueDate.month - 1, a.dueDate.day, a.dueTime.hours, a.dueTime.minutes || 0)
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
            const message = `📌 Assignment Reminder
Course: ${course.name}
Title: ${a.title}
Due: ${formattedTime}
Link: ${link}`;
            console.log(`[Cron][SEND] Sending reminder ${h}h for assignment ${a.id}`);
            await sendMessageToGoogleUser(googleId, message);
            await markReminderSent(a.id, googleId, `${h}h`);
            break;
          }
        }
      } catch (err) {
        console.error("[Cron] Error during reminder checks:", err);
      }
    }
  }
}

// Main cron runner
export async function runCronJobs() {
  console.log("⏰ Cron job started for all registered users...");
  const allGoogleIds = await getAllUserGoogleIds();
  console.log(`[Cron] Found ${allGoogleIds.length} registered users to check.`);
  for (const googleId of allGoogleIds) {
    try {
      const user = await getUser(googleId);
      if (!user || !user.refreshToken) {
        console.warn(`[Cron] Skipping user ${googleId} (no user or no refresh token).`);
        continue;
      }
      console.log(`[Cron][DEBUG] User ${googleId} has PSID=${user.psid}`);
      const userOAuthClient = createOAuth2ClientForUser(user.refreshToken);
      const courses = await fetchCourses(userOAuthClient);
      console.log("[Cron] =========================");
      await checkReminders(userOAuthClient, googleId, courses);
      console.log("[Cron] =========================");
      await checkNewContent(userOAuthClient, googleId, courses);
    } catch (err) {
      console.error(`[Cron] Error processing user ${googleId}:`, err);
    }
  }
  console.log("⏰ Cron job finished for all users.");
}
