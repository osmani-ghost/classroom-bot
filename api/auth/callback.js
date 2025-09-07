import { google } from "googleapis";
import { saveUser } from "../../../helpers/redisHelper.js";
import { sendRawMessage } from "../../../helpers/messengerHelper.js";
import { fetchCourses, fetchAssignments, fetchAnnouncements, fetchMaterials } from "../../../helpers/classroomHelper.js";
import { runCronJobs } from "../../../helpers/cronHelper.js";

export default async function handler(req, res) {
  console.log("\n--- GOOGLE AUTH CALLBACK TRIGGERED ---");
  const { code, state } = req.query;
  const psid = state;

  try {
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
    if (!code || !psid) throw new Error("Missing code or state from Google callback.");

    const { tokens } = await oauth2Client.getToken(code);
    if (!tokens.refresh_token) throw new Error("Refresh token not received.");

    oauth2Client.setCredentials(tokens);

    const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
    const userInfo = await oauth2.userinfo.get();
    const googleId = userInfo.data.id;

    await saveUser(googleId, { psid: psid, refreshToken: tokens.refresh_token });

    // Initial sync for old assignments + materials
    console.log(`[Callback] Running initial sync for GoogleId=${googleId}`);
    await runCronJobs();

    await sendRawMessage(psid, `✅ Thank you, ${userInfo.data.given_name}! Your account is linked and synced.`);
    res.send("<html><body><h1>Success!</h1><p>You can close this window now.</p></body></html>");
  } catch (err) {
    console.error("❌ CRITICAL ERROR IN GOOGLE CALLBACK", err);
    if (psid) await sendRawMessage(psid, `😥 Login failed. Please try again.`);
    res.status(500).send(`Authentication failed: ${err.message}`);
  }
}
