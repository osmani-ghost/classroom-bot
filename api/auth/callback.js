import { google } from "googleapis";
import * as redisHelper from "../../helpers/redisHelper.js"; // ✅ Corrected relative path

export default async function handler(req, res) {
  console.log("\n==============================");
  console.log("🌐 [AUTH][CALLBACK] Google OAuth callback triggered");
  console.log("==============================");

  const { code, state } = req.query;
  console.log("[AUTH][CALLBACK] Incoming query params:", { codePreview: code?.substring(0, 10), state });

  if (!code) {
    console.error("❌ [AUTH][CALLBACK][ERROR] Missing `code` from query");
    return res.status(400).send("Missing `code` in callback");
  }

  if (!state) {
    console.error("❌ [AUTH][CALLBACK][ERROR] Missing `state` (PSID) from query");
    return res.status(400).send("Missing `state` in callback");
  }

  try {
    // Step 1: Build OAuth client
    console.log("[AUTH][CALLBACK] Step 1: Creating OAuth2 client with redirect:", process.env.GOOGLE_REDIRECT_URI);
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );

    // Step 2: Exchange code for tokens
    console.log("[AUTH][CALLBACK] Step 2: Exchanging code for tokens...");
    const { tokens } = await oauth2Client.getToken(code);
    console.log("[AUTH][CALLBACK] Step 2: Tokens received:", {
      access_token_preview: tokens?.access_token?.substring(0, 10),
      refresh_token_present: !!tokens?.refresh_token,
      expiry_date: tokens?.expiry_date,
    });

    if (!tokens.refresh_token) {
      console.error("❌ [AUTH][CALLBACK][ERROR] Missing refresh_token in response");
      return res.status(400).send("Google did not return a refresh token. Try revoking app access and retry.");
    }

    oauth2Client.setCredentials(tokens);

    // Step 3: Fetch user info
    console.log("[AUTH][CALLBACK] Step 3: Fetching user profile with OAuth client...");
    const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
    const { data: profile } = await oauth2.userinfo.get();
    console.log("[AUTH][CALLBACK] Step 3: User profile fetched:", profile);

    if (!profile?.id) {
      console.error("❌ [AUTH][CALLBACK][ERROR] Missing Google profile ID");
      return res.status(400).send("Invalid Google profile data");
    }

    // Step 4: Save user in Redis
    console.log("[AUTH][CALLBACK] Step 4: Saving user to Redis...");
    const userData = {
      psid: state,
      googleId: profile.id,
      email: profile.email,
      name: profile.name,
      picture: profile.picture,
      refreshToken: tokens.refresh_token,
    };

    console.log("[AUTH][CALLBACK] Saving userData to Redis:", userData);
    await redisHelper.saveUser(profile.id, userData);
    console.log("[AUTH][CALLBACK] ✅ User saved successfully to Redis");

    // Step 5: Return HTML success response
    console.log("[AUTH][CALLBACK] Step 5: Sending HTML success response");
    res.send(`
      <html>
        <body>
          <h1>✅ Login Successful</h1>
          <p>Welcome, ${profile.name} (${profile.email})</p>
          <p>Your Google account is now linked. You may close this window.</p>
        </body>
      </html>
    `);

    console.log("[AUTH][CALLBACK] 🚀 Callback finished SUCCESSFULLY for PSID:", state);
  } catch (err) {
    console.error("❌ [AUTH][CALLBACK][CRITICAL ERROR] OAuth callback failed");
    console.error("Error stack:", err);

    try {
      console.log("[AUTH][CALLBACK] Attempting to notify user via Messenger (PSID:", state, ")");
      // Lazy import inside try/catch to prevent crash
      const { sendRawMessage } = await import("../../helpers/messengerHelper.js");
      await sendRawMessage(state, "😥 Sorry, something went wrong while linking your Google account. Please try again.");
      console.log("[AUTH][CALLBACK] Notified user in Messenger");
    } catch (notifyErr) {
      console.error("❌ [AUTH][CALLBACK][ERROR] Failed to notify user in Messenger:", notifyErr);
    }

    res.status(500).send("Authentication failed. Check logs for details.");
  }
}
