// classroom/api/auth/google.js
// Start Google OAuth consent flow (redirects to Google)
// Expects: GET /api/auth/google?psid=<PSID>

import { google } from "googleapis";

export default async function handler(req, res) {
  console.log("\n==============================");
  console.log("🌐 [AUTH][GOOGLE] Login flow start");
  console.log("==============================");

  const { psid } = req.query || {};
  console.log("[AUTH][GOOGLE] Received psid:", psid);

  if (!psid) {
    console.error("[AUTH][GOOGLE] Missing PSID in request.");
    return res.status(400).send("Missing Messenger PSID");
  }

  try {
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );

    const scopes = [
      "https://www.googleapis.com/auth/classroom.courses.readonly",
      "https://www.googleapis.com/auth/classroom.coursework.me.readonly",
      "https://www.googleapis.com/auth/classroom.courseworkmaterials.readonly",
      "https://www.googleapis.com/auth/classroom.announcements.readonly",
      "https://www.googleapis.com/auth/classroom.student-submissions.me.readonly",
      "https://www.googleapis.com/auth/userinfo.email",
      "https://www.googleapis.com/auth/userinfo.profile",
      "openid",
    ];

    console.log("[AUTH][GOOGLE] Scopes:", scopes);
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: scopes,
      state: psid, // carry PSID into callback
    });

    console.log("[AUTH][GOOGLE] Redirecting to Google consent screen for PSID:", psid);
    return res.redirect(authUrl);
  } catch (err) {
    console.error("[AUTH][GOOGLE] Error starting OAuth flow:", err);
    return res.status(500).send("Failed to start Google login");
  }
}
