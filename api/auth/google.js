import { google } from "googleapis";

export default async function handler(req, res) {
  console.log("[AUTH][GOOGLE] OAuth start request received");

  try {
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );

    const scopes = [
      "https://www.googleapis.com/auth/classroom.courses.readonly",
      "https://www.googleapis.com/auth/classroom.coursework.me.readonly",
      "https://www.googleapis.com/auth/classroom.announcements.readonly",
      "https://www.googleapis.com/auth/classroom.courseworkmaterials.readonly",
      "https://www.googleapis.com/auth/classroom.student-submissions.me.readonly",
      "https://www.googleapis.com/auth/userinfo.profile",
      "https://www.googleapis.com/auth/userinfo.email",
      "openid"
    ];

    console.log("[AUTH][GOOGLE] Generating consent URL with scopes:", scopes);

    const url = oauth2Client.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: scopes
    });

    console.log("[AUTH][GOOGLE] Redirecting user to consent screen:", url);

    res.redirect(url);
  } catch (error) {
    console.error("[AUTH][GOOGLE][ERROR] Failed to start OAuth flow:", error);
    res.status(500).send("Authentication initialization failed");
  }
}
