import { google } from "googleapis";

export default function handler(req, res) {
  console.log("\n--- /api/auth/google: ENTRY ---");
  try {
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
    const { psid } = req.query;
    if (!psid) {
      console.warn("[AuthGoogle] PSID missing in query.");
      return res.status(400).send("PSID is missing.");
    }

    // Scopes for both students & teachers (read-only)
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
      state: psid,
      prompt: "consent",
    });

    console.log(`[AuthGoogle] Generated authUrl for PSID ${psid}: ${authUrl}`);
    res.redirect(authUrl);
  } catch (error) {
    console.error("❌ Error generating auth URL:", error);
    res.status(500).send("Error generating auth URL.");
  } finally {
    console.log("--- /api/auth/google: EXIT ---\n");
  }
}
