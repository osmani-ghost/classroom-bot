// classroom/api/auth/callback.js
// Google OAuth callback. Exchanges code => tokens, fetches profile, saves into Redis via redisHelper.saveUser

import { google } from "googleapis";
import * as redisHelper from "../../helpers/redisHelper.js";

export default async function handler(req, res) {
  console.log("\n==============================");
  console.log("🌐 [AUTH][CALLBACK] OAuth callback triggered");
  console.log("==============================");

  const { code, state } = req.query || {};
  console.log("[AUTH][CALLBACK] Query preview:", { codePreview: code ? code.slice(0, 10) : null, state });

  if (!code) {
    console.error("[AUTH][CALLBACK] Missing code");
    return res.status(400).send("Missing code");
  }
  if (!state) {
    console.error("[AUTH][CALLBACK] Missing state (PSID)");
    return res.status(400).send("Missing state (PSID)");
  }

  try {
    // Build OAuth2 client
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );

    console.log("[AUTH][CALLBACK] Exchanging code for tokens...");
    const { tokens } = await oauth2Client.getToken(code);
    console.log("[AUTH][CALLBACK] Tokens retrieved. refresh_token_present:", !!tokens.refresh_token);

    if (!tokens?.refresh_token) {
      console.warn("[AUTH][CALLBACK] No refresh token returned. This may happen if user already consented. You must request offline access with prompt=consent.");
      // Still continue if you have an access token? For this project we require refresh_token.
      return res.status(400).send("No refresh token returned. Revoke access and retry with 'Login with Google' to allow refresh token.");
    }

    oauth2Client.setCredentials(tokens);
    const oauth2 = google.oauth2({ auth: oauth2Client, version: "v2" });
    const me = await oauth2.userinfo.get();
    console.log("[AUTH][CALLBACK] Google profile fetched:", me?.data?.email);

    if (!me?.data?.id) {
      console.error("[AUTH][CALLBACK] Invalid Google profile.");
      return res.status(400).send("Invalid Google profile");
    }

    const userData = {
      psid: state,
      googleId: me.data.id,
      email: me.data.email,
      name: me.data.name,
      picture: me.data.picture,
      refreshToken: tokens.refresh_token,
    };

    console.log("[AUTH][CALLBACK] Saving user into Redis:", { googleId: userData.googleId, psid: userData.psid });
    await redisHelper.saveUser(userData.googleId, userData);

    console.log("[AUTH][CALLBACK] Saved successfully. Returning success HTML.");
    res.send(`
      <html>
        <body>
          <h1>✅ Login Successful</h1>
          <p>Welcome, ${userData.name} (${userData.email})</p>
          <p>Your Google account is now linked to Messenger. You can close this window.</p>
        </body>
      </html>
    `);
    console.log("[AUTH][CALLBACK] Completed for PSID:", state);
  } catch (err) {
    console.error("[AUTH][CALLBACK] Error during OAuth callback:", err);

    // Try to inform the user via Messenger (non-blocking)
    try {
      const { sendRawMessage } = await import("../../helpers/messengerHelper.js");
      await sendRawMessage(state, "😥 Something went wrong while linking your Google account. Please try again.");
      console.log("[AUTH][CALLBACK] Notified user via Messenger.");
    } catch (notifyErr) {
      console.error("[AUTH][CALLBACK] Failed notifying user via Messenger:", notifyErr);
    }

    return res.status(500).send("Authentication failed");
  }
}
