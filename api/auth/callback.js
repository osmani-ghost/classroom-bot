import { google } from "googleapis";
import redisHelper from "../../../helpers/redisHelper.js";

export default async function handler(req, res) {
  console.log("[AUTH][CALLBACK] Callback hit with query:", req.query);

  try {
    const code = req.query.code;
    if (!code) {
      console.error("[AUTH][CALLBACK][ERROR] Missing authorization code");
      return res.status(400).send("Missing code");
    }

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );

    console.log("[AUTH][CALLBACK] Exchanging code for tokens...");

    const { tokens } = await oauth2Client.getToken(code);
    console.log("[AUTH][CALLBACK] Tokens received:", tokens);

    oauth2Client.setCredentials(tokens);

    console.log("[AUTH][CALLBACK] Fetching user profile...");

    const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
    const { data: profile } = await oauth2.userinfo.get();

    console.log("[AUTH][CALLBACK] User profile received:", profile);

    if (!profile.id) {
      console.error("[AUTH][CALLBACK][ERROR] Missing profile ID");
      return res.status(400).send("Invalid profile data");
    }

    // Store refresh token + user data in Redis
    const redisKey = `user:${profile.id}`;
    const userData = {
      googleId: profile.id,
      email: profile.email,
      name: profile.name,
      picture: profile.picture,
      refresh_token: tokens.refresh_token
    };

    console.log("[AUTH][CALLBACK] Saving user data to Redis:", redisKey, userData);
    await redisHelper.setUserData(redisKey, userData);

    console.log("[AUTH][CALLBACK] Successfully stored user in Redis");

    res.send(`
      <h1>Login Successful ✅</h1>
      <p>Welcome, ${profile.name} (${profile.email})</p>
      <p>You can now use the Messenger bot for Google Classroom updates.</p>
    `);
  } catch (error) {
    console.error("[AUTH][CALLBACK][ERROR] OAuth callback failed:", error);
    res.status(500).send("Authentication failed");
  }
}
