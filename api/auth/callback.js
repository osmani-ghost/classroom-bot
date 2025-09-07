import { google } from "googleapis";
import { saveUser } from "../../helpers/redisHelper.js";
import { sendRawMessage } from "../../helpers/messengerHelper.js";

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
    
    console.log(`[Callback Debug] Step 1: Received code for PSID: ${psid}`);
    if (!code || !psid) throw new Error("Missing code or state from Google callback.");

    console.log(`[Callback Debug] Step 2: Getting tokens from Google...`);
    const { tokens } = await oauth2Client.getToken(code);
    
    if (tokens && tokens.refresh_token) {
        console.log(`[Callback Debug] Step 3: SUCCESS! New Refresh Token received: ${tokens.refresh_token.substring(0, 10)}...`);
    } else {
        console.error("❌ CRITICAL: Refresh token was NOT provided by Google. This is a problem.");
        throw new Error("Refresh token not received. Please REMOVE app access from your Google account and try again.");
    }
    oauth2Client.setCredentials(tokens);

    console.log(`[Callback Debug] Step 4: Getting user info...`);
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const userInfo = await oauth2.userinfo.get();
    const googleId = userInfo.data.id;
    console.log(`[Callback Debug] Step 5: User info received. Google ID = ${googleId}`);

    console.log(`[Callback Debug] Step 6: Saving user to Redis with new refresh token...`);
    await saveUser(googleId, { psid: psid, refreshToken: tokens.refresh_token });
    
    await sendRawMessage(psid, `✅ Thank you, ${userInfo.data.given_name}! Your account is linked.`);
    res.send("<html><body><h1>Success!</h1><p>You can close this window now.</p></body></html>");

  } catch (err) {
    console.error("❌❌❌ CRITICAL ERROR IN GOOGLE CALLBACK ❌❌❌");
    console.error(err);
    if(psid) {
        await sendRawMessage(psid, `😥 Sorry, something went wrong during login. Please try again.`);
    }
    res.status(500).send(`Authentication failed: ${err.message}`);
  }
}