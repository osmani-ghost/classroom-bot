import { google } from "googleapis";

export default async function handler(req, res) {
  console.log("\n==============================");
  console.log("🌐 [AUTH][GOOGLE] Login flow started");
  console.log("==============================");

  const { psid } = req.query;
  console.log("[AUTH][GOOGLE] Incoming query params:", { psid });

  if (!psid) {
    console.error("❌ [AUTH][GOOGLE][ERROR] Missing PSID in request");
    return res.status(400).send("Missing Messenger PSID. Cannot continue login.");
  }

  try {
    // Step 1: Create OAuth client
    console.log("[AUTH][GOOGLE] Step 1: Creating OAuth2 client...");
    console.log("[AUTH][GOOGLE] Using redirect URI:", process.env.GOOGLE_REDIRECT_URI);

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );

    // Step 2: Define scopes (added courseworkmaterials.readonly)
    console.log("[AUTH][GOOGLE] Step 2: Defining scopes...");
    const scopes = [
      "https://www.googleapis.com/auth/classroom.courses.readonly",
      "https://www.googleapis.com/auth/classroom.coursework.me.readonly",
      "https://www.googleapis.com/auth/classroom.courseworkmaterials.readonly", // ✅ REQUIRED for materials.list
      "https://www.googleapis.com/auth/classroom.announcements.readonly",
      "https://www.googleapis.com/auth/classroom.student-submissions.me.readonly",
      "https://www.googleapis.com/auth/userinfo.email",
      "https://www.googleapis.com/auth/userinfo.profile",
      "openid"
    ];
    console.log("[AUTH][GOOGLE] Scopes requested:", JSON.stringify(scopes, null, 2));

    // Step 3: Generate auth URL
    console.log("[AUTH][GOOGLE] Step 3: Generating consent screen URL...");
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: "offline",   // ensures refresh_token
      prompt: "consent",        // force re-consent so new scopes are granted
      scope: scopes,
      state: psid,              // carry Messenger PSID for callback
    });

    console.log("[AUTH][GOOGLE] Generated Auth URL:", authUrl);

    // Step 4: Redirect user
    console.log("[AUTH][GOOGLE] Step 4: Redirecting user to Google consent screen...");
    res.redirect(authUrl);

    console.log("✅ [AUTH][GOOGLE] 🚀 Login flow initialized SUCCESSFULLY for PSID:", psid);
    console.log("==============================\n");
  } catch (err) {
    console.error("❌ [AUTH][GOOGLE][CRITICAL ERROR] Failed to start login flow");
    console.error("Error stack:", err);

    res.status(500).send("Failed to start Google login. Check logs for details.");
  }
}
