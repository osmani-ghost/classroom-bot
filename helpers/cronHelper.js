import { google } from "googleapis";
import {
    fetchCourses,
    fetchAssignments,
    isTurnedIn,
    fetchAnnouncements,
    fetchMaterials,
} from "./helpers/classroomHelper.js";
import { sendMessageToGoogleUser } from "./helpers/messengerHelper.js";
import {
    getAllUserGoogleIds,
    getUser,
    reminderAlreadySent,
    markReminderSent,
    getLastCheckedTime,
    setLastCheckedTime,
    saveContent,
    checkAssignmentExists,
    saveAssignment
} from "./helpers/redisHelper.js";

// =========================
// Create OAuth2 client
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
// New Assignment Detection + First Notification
// =========================
async function checkNewAssignments(oauth2Client, googleId, courses) {
    console.log(`[Cron] Checking new assignments for user: ${googleId}`);

    for (const course of courses) {
        if (course.ownerId === googleId) {
            console.log(`[Cron][DEBUG] Skipping teacher course: ${course.name}`);
            continue;
        }

        const assignments = await fetchAssignments(oauth2Client, course.id);
        console.log(`[Cron][DEBUG] Course ${course.name} -> Assignments fetched: ${assignments.length}`);

        for (const a of assignments) {
            const exists = await checkAssignmentExists(course.id, a.id);
            if (!exists) {
                const formattedTime = formatDueDateTime(a.dueDate, a.dueTime);
                const link = a.alternateLink || "Link not available";
                const message = `📌 New Assignment Posted\nCourse: ${course.name}\nTitle: ${a.title}\nDue: ${formattedTime}\nLink: ${link}`;
                
                console.log(`[Cron][SEND] ${message}`);
                await sendMessageToGoogleUser(googleId, message);

                // Save to Redis
                await saveAssignment(course.id, a.id, {
                    googleId,
                    courseId: course.id,
                    courseName: course.name,
                    title: a.title,
                    type: 'assignment',
                    dueDate: a.dueDate,
                    dueTime: a.dueTime,
                    link
                });
            }
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
            if (diffHours <= 0 || diffHours > 24.5) continue;

            const turnedIn = await isTurnedIn(oauth2Client, course.id, a.id, "me");
            if (turnedIn) continue;

            const reminders = [24, 12, 6, 2];
            for (const h of reminders) {
                const alreadySent = await reminderAlreadySent(a.id, googleId, `${h}h`);
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
    console.log(`[Cron] Found ${allGoogleIds.length} registered users.`);

    for (const googleId of allGoogleIds) {
        const user = await getUser(googleId);
        if (!user || !user.refreshToken) continue;

        console.log(`[Cron][DEBUG] User ${googleId} has ${user.courses?.length || 0} courses.`);
        const userOAuthClient = createOAuth2ClientForUser(user.refreshToken);
        const courses = await fetchCourses(userOAuthClient);

        console.log("[Cron] =========================");
        await checkNewAssignments(userOAuthClient, googleId, courses);
        console.log("[Cron] =========================");
        await checkReminders(userOAuthClient, googleId, courses);
    }

    console.log("⏰ Cron job finished for all users.");
}
