// classroom/api/auth/callback.js
import { google } from "googleapis";
import * as redisHelper from "../../helpers/redisHelper.js";

export default async function handler(req, res) {
  console.log("\n==============================");
  console.log("🌐 [AUTH][CALLBACK] OAuth callback triggered");
  console.log("==============================");

  const { code, state } = req.query || {};
  console.log("[AUTH][CALLBACK] Query preview:", { codePreview: code ? code.slice(0, 10) : null, state });

  if (!code) return res.status(400).send("Missing code");
  if (!state) return res.status(400).send("Missing state (PSID)");

  try {
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );

    const { tokens } = await oauth2Client.getToken(code);

    if (!tokens?.refresh_token) {
      return res.status(400).send("No refresh token returned. Revoke access and retry with 'Login with Google'.");
    }

    oauth2Client.setCredentials(tokens);

    const oauth2 = google.oauth2({ auth: oauth2Client, version: "v2" });
    const me = await oauth2.userinfo.get();

    const userData = {
      psid: state,
      googleId: me.data.id,
      email: me.data.email,
      name: me.data.name,
      picture: me.data.picture,
      refreshToken: tokens.refresh_token,
    };

    // Minimal fix: ensure both save user and PSID mapping
    await redisHelper.saveUser(userData.googleId, userData);
    await redisHelper.savePsidMapping(userData.psid, userData.googleId);

    res.send(`
      <html>
        <head><title>Login Success - Campus Notify</title></head>
        <body style="font-family:sans-serif; text-align:center; padding:40px;">
          <h1>✅ Login Successful</h1>
          <p>Welcome, <b>${userData.name}</b> (${userData.email})</p>
          <p>Your Google account is now linked. You can close this window and return to the bot.</p>
        </body>
      </html>
    `);
  } catch (err) {
    console.error("[AUTH][CALLBACK] Error during OAuth callback:", err);
    try {
      const { sendRawMessage } = await import("../../helpers/messengerHelper.js");
      await sendRawMessage(state, "😥 Something went wrong while linking your Google account. Please try again.");
    } catch {}
    return res.status(500).send("Authentication failed");
  }
}
