import { google } from "googleapis";
import { saveUser } from "../../helpers/redisHelper.js";
import { sendRawMessage } from "../../helpers/messengerHelper.js";

export default async function handler(req, res) {
  console.log("\n--- GOOGLE AUTH CALLBACK TRIGGERED ---");

  const { code, state } = req.query;
  const psid = state;

  if (!code || !psid) {
    console.warn("[Callback] Missing code or PSID in query params.");
    return res.status(400).send("Invalid callback request.");
  }

  try {
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );

    console.log(`[Callback Debug] Step 1: Received code for PSID: ${psid}`);

    console.log(`[Callback Debug] Step 2: Exchanging code for tokens...`);
    const { tokens } = await oauth2Client.getToken(code);

    if (!tokens.refresh_token) {
      console.error("❌ Refresh token not provided by Google.");
      throw new Error(
        "Refresh token missing. Please REMOVE previous app access and try again."
      );
    }

    oauth2Client.setCredentials(tokens);

    console.log(`[Callback Debug] Step 3: Fetching Google user info...`);
    const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
    const userInfo = await oauth2.userinfo.get();
    const googleId = userInfo.data.id;

    console.log(`[Callback Debug] Step 4: User info received. Google ID = ${googleId}`);

    console.log(`[Callback Debug] Step 5: Saving user to Redis...`);
    await saveUser(googleId, { psid, refreshToken: tokens.refresh_token });

    if (psid) {
      await sendRawMessage(
        psid,
        `✅ Thank you, ${userInfo.data.given_name}! Your account is now linked.`
      );
    }

    return res.send(
      "<html><body><h1>Success!</h1><p>You can close this window now.</p></body></html>"
    );
  } catch (err) {
    console.error("❌❌❌ ERROR IN GOOGLE CALLBACK ❌❌❌");
    console.error(err);

    if (psid) {
      try {
        await sendRawMessage(
          psid,
          `😥 Sorry, something went wrong during login. Please try again.`
        );
      } catch (sendErr) {
        console.error("[Callback] Failed to send error message to PSID:", sendErr);
      }
    }

    return res.status(500).send(`Authentication failed: ${err.message}`);
  }
}
