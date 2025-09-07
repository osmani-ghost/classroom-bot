import { google } from "googleapis";
import { saveUserGoogleId } from "./redisHelper.js"; // make sure you have a helper to store GoogleID

export default async function handler(req, res) {
  try {
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );

    const { psid, code, state } = req.query;

    if (!psid && !state) {
      console.error("[Google Auth] Missing PSID in query or state.");
      return res.status(400).send("PSID is missing.");
    }

    // If no code, this is initial login request → generate auth URL
    if (!code) {
      const actualPsid = psid || state; // fallback
      console.log(`[Google Auth] Generating auth URL for PSID: ${actualPsid}`);

      const scopes = [
        "https://www.googleapis.com/auth/userinfo.profile",
        "https://www.googleapis.com/auth/classroom.courses.readonly",
        "https://www.googleapis.com/auth/classroom.rosters.readonly",
        "https://www.googleapis.com/auth/classroom.announcements.readonly",
        "https://www.googleapis.com/auth/classroom.courseworkmaterials.readonly",
        "https://www.googleapis.com/auth/classroom.coursework.students.readonly",
        "https://www.googleapis.com/auth/classroom.coursework.me.readonly",
      ];

      const authUrl = oauth2Client.generateAuthUrl({
        access_type: "offline",
        scope: scopes,
        state: actualPsid,
        prompt: "consent",
      });

      console.log(`[Google Auth] Redirecting PSID ${actualPsid} to Google login URL: ${authUrl}`);
      return res.redirect(authUrl);
    }

    // If code exists, this is callback from Google → exchange code for tokens
    console.log(`[Google Auth] Received OAuth callback for PSID: ${state}, code: ${code}`);

    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    console.log(`[Google Auth] Tokens received for PSID: ${state}: ${JSON.stringify(tokens).substring(0, 300)}...`);

    // Get user profile info from Google
    const oauth2 = google.oauth2({ auth: oauth2Client, version: "v2" });
    const profile = await oauth2.userinfo.get();
    console.log(`[Google Auth] Google profile fetched for PSID ${state}: ${JSON.stringify(profile.data)}`);

    // Save Google ID and refresh token in your database / Redis
    await saveUserGoogleId(state, profile.data.id, tokens.refresh_token);
    console.log(`[Google Auth] Saved Google ID ${profile.data.id} for PSID ${state}`);

    // Redirect back to your UI or Messenger success page
    res.send(`
      <h2>✅ Hi ${profile.data.name || "User"}, your Google Classroom is linked!</h2>
      <p>You can now search assignments, materials, and announcements in Messenger.</p>
      <p>Try typing "/assignments today" or "Show assignments today".</p>
    `);
  } catch (error) {
    console.error("❌ Google OAuth Error:", error);
    res.status(500).send("Error completing Google OAuth flow.");
  }
}
