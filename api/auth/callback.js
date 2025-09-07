import { google } from "googleapis";
import { saveUser, saveContent } from "../../helpers/redisHelper.js";
import { sendRawMessage } from "../../helpers/messengerHelper.js";
import { fetchCourses, fetchAssignments, fetchAnnouncements, fetchMaterials } from "../../helpers/classroomHelper.js";

async function performInitialSync(oauth2Client, googleId) {
    console.log(`[Sync] Starting initial data sync for user: ${googleId}`);
    try {
        const courses = await fetchCourses(oauth2Client);
        for (const course of courses) {
            const items = [
                ...(await fetchAssignments(oauth2Client, course.id)),
                ...(await fetchAnnouncements(oauth2Client, course.id)),
                ...(await fetchMaterials(oauth2Client, course.id)),
            ];
            for (const item of items) await saveContent(googleId, item);
        }
        console.log(`[Sync] Initial data sync finished for user: ${googleId}`);
    } catch (error) {
        console.error(`[Sync] Error during initial sync for user ${googleId}:`, error);
    }
}

export default async function handler(req, res) {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  const { code, state } = req.query;
  const psid = state;

  try {
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);
    if (!tokens.refresh_token) throw new Error("Refresh token not received.");

    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const userInfo = await oauth2.userinfo.get();
    const googleId = userInfo.data.id;

    await saveUser(googleId, { psid: psid, refreshToken: tokens.refresh_token });
    
    res.send("<html><body><h1>Success!</h1><p>You can close this window now.</p></body></html>");
    
    await sendRawMessage(psid, `✅ Thank you, ${userInfo.data.given_name}! We are now syncing your classroom data...`);
    
    performInitialSync(oauth2Client, googleId);

  } catch (err) {
    console.error("❌ Error in Google callback:", err);
    if(psid) await sendRawMessage(psid, `😥 Sorry, something went wrong during login.`);
    res.status(500).send(`Authentication failed: ${err.message}`);
  }
}