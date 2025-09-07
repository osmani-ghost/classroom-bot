import { google } from "googleapis";
import { fetchCourses, fetchAssignments, isTurnedIn, fetchAnnouncements, fetchMaterials } from "./classroomHelper.js";
import { sendMessageToGoogleUser } from "./messengerHelper.js";
import { getAllUserGoogleIds, getUser, reminderAlreadySent, markReminderSent, getLastCheckedTime, setLastCheckedTime, saveContent } from "./redisHelper.js";

function createOAuth2ClientForUser(refreshToken) {
  const oauth2Client = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, process.env.GOOGLE_REDIRECT_URI);
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  return oauth2Client;
}

function formatDueTime(dueTime) {
    if (!dueTime || typeof dueTime.hours === 'undefined') return "End of day";
    let hours = (dueTime.hours + 6) % 24; // UTC to BDT
    const minutes = dueTime.minutes || 0;
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12;
    const minutesStr = minutes < 10 ? '0' + minutes : minutes;
    return `${hours}:${minutesStr} ${ampm}`;
}

async function checkNewContent(oauth2Client, googleId, courses) {
    for (const course of courses) {
        const announcements = await fetchAnnouncements(oauth2Client, course.id);
        const materials = await fetchMaterials(oauth2Client, course.id);
        
        for (const item of [...announcements, ...materials]) await saveContent(googleId, item);

        const allContent = [...announcements, ...materials].sort((a, b) => new Date(b.updateTime) - new Date(a.updateTime));
        if (allContent.length === 0) continue;
        const latestContentTime = allContent[0].updateTime;
        const lastCheckedString = await getLastCheckedTime(googleId, course.id);

        if (!lastCheckedString) {
            await setLastCheckedTime(googleId, course.id, latestContentTime);
            continue;
        }
        
        for (const content of allContent) {
            if (new Date(content.updateTime) > new Date(lastCheckedString)) {
                const message = content.title ? `📚 New Material in ${course.name}:\n"${content.title}"` : `📢 New Announcement in ${course.name}:\n"${content.text}"`;
                await sendMessageToGoogleUser(googleId, message);
            } else {
                break;
            }
        }
        await setLastCheckedTime(googleId, course.id, latestContentTime);
    }
}

async function checkReminders(oauth2Client, googleId, courses) {
    const now = new Date();
    for (const course of courses) {
        const assignments = await fetchAssignments(oauth2Client, course.id);
        for (const a of assignments) await saveContent(googleId, a);

        for (const a of assignments) {
            if (!a.dueDate || !a.dueTime) continue;
            const due = new Date(Date.UTC(a.dueDate.year, a.dueDate.month - 1, a.dueDate.day, a.dueTime.hours, a.dueTime.minutes || 0));
            const diffHours = (due.getTime() - now.getTime()) / (1000 * 60 * 60);

            if (diffHours < 0 || diffHours > 24.5) continue;

            const turnedIn = await isTurnedIn(oauth2Client, course.id, a.id, 'me');
            if (turnedIn) continue;

            const reminders = [1, 2, 6, 12, 24];
            for (const h of reminders) {
                if (diffHours <= h && !(await reminderAlreadySent(a.id, googleId, `${h}h`))) {
                    const formattedTime = formatDueTime(a.dueTime);
                    const message = `📝 Reminder: Your assignment "${a.title}" is due for ${course.name}.\nLast submission time: ${formattedTime}`;
                    await sendMessageToGoogleUser(googleId, message);
                    await markReminderSent(a.id, googleId, `${h}h`);
                    break;
                }
            }
        }
    }
}

export async function runCronJobs() {
    console.log("⏰ Cron job started...");
    const allGoogleIds = await getAllUserGoogleIds();
    console.log(`[Cron] Found ${allGoogleIds.length} registered users.`);

    for (const googleId of allGoogleIds) {
        const user = await getUser(googleId);
        if (!user || !user.refreshToken) continue;
        
        const userOAuthClient = createOAuth2ClientForUser(user.refreshToken);
        const courses = await fetchCourses(userOAuthClient);
        
        await checkReminders(userOAuthClient, googleId, courses);
        await checkNewContent(userOAuthClient, googleId, courses);
    }
}