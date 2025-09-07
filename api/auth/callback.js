import { google } from "googleapis";
import {
  saveUser,
  saveIndexedItem,
  getUser,
} from "../../helpers/redisHelper.js";
import {
  sendRawMessage,
  sendMessageToGoogleUser,
  formatListForMessenger,
} from "../../helpers/messengerHelper.js";
import {
  fetchCourses,
  fetchAssignments,
  fetchAnnouncements,
  fetchMaterials,
} from "../../helpers/classroomHelper.js";

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
      console.log(
        `[Callback Debug] Step 3: SUCCESS! New Refresh Token received: ${tokens.refresh_token.substring(
          0,
          10
        )}...`
      );
    } else {
      console.error(
        "❌ CRITICAL: Refresh token was NOT provided by Google. This is a problem."
      );
      // Helpful message to user
      await sendRawMessage(
        psid,
        `⚠️ Refresh token not provided. Please remove app access from your Google account and try logging in again (we require offline access).`
      );
      throw new Error(
        "Refresh token not received. Please REMOVE app access from your Google account and try again."
      );
    }
    oauth2Client.setCredentials(tokens);

    console.log(`[Callback Debug] Step 4: Getting user info...`);
    const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
    const userInfo = await oauth2.userinfo.get();
    const googleId = userInfo.data.id;
    console.log(`[Callback Debug] Step 5: User info received. Google ID = ${googleId}`);

    console.log(`[Callback Debug] Step 6: Saving user to Redis with new refresh token...`);
    await saveUser(googleId, { psid: psid, refreshToken: tokens.refresh_token });
    console.log(`[Callback Debug] Step 7: User saved. Starting initial indexing...`);

    // --- INITIAL FULL INDEX ON FIRST LOGIN ---
    // If user had no previous data we fetch and save items
    const existing = await getUser(googleId);
    const isFirstLogin = !existing || !existing.indexedAt;
    if (isFirstLogin) {
      console.log(`[Callback Debug] First time login detected for Google ID ${googleId}. Indexing all data...`);
      try {
        const oauthForUser = new google.auth.OAuth2(
          process.env.GOOGLE_CLIENT_ID,
          process.env.GOOGLE_CLIENT_SECRET,
          process.env.GOOGLE_REDIRECT_URI
        );
        oauthForUser.setCredentials({ refresh_token: tokens.refresh_token });

        const courses = await fetchCourses(oauthForUser);
        console.log(`[Callback Debug] Found ${courses.length} courses for indexing.`);

        for (const course of courses) {
          try {
            const assignments = await fetchAssignments(oauthForUser, course.id);
            for (const a of assignments) {
              const item = {
                id: a.id,
                type: "assignment",
                courseId: course.id,
                courseName: course.name,
                title: a.title,
                description: a.description || "",
                createdTime: a.creationTime || a.updateTime || new Date().toISOString(),
                dueDate: a.dueDate || null,
                dueTime: a.dueTime || null,
                link: a.alternateLink || null,
                raw: a,
              };
              console.log(`[Callback Debug] Indexing assignment: ${course.name} - ${a.title}`);
              await saveIndexedItem(googleId, item);
            }

            const materials = await fetchMaterials(oauthForUser, course.id);
            for (const m of materials) {
              const item = {
                id: m.id,
                type: "material",
                courseId: course.id,
                courseName: course.name,
                title: m.title || m.submission? m.submission.title : (m.description || "Material"),
                description: m.description || "",
                createdTime: m.creationTime || m.updateTime || new Date().toISOString(),
                link: m.alternateLink || null,
                raw: m,
              };
              console.log(`[Callback Debug] Indexing material: ${course.name} - ${item.title}`);
              await saveIndexedItem(googleId, item);
            }

            const announcements = await fetchAnnouncements(oauthForUser, course.id);
            for (const an of announcements) {
              const item = {
                id: an.id,
                type: "announcement",
                courseId: course.id,
                courseName: course.name,
                title: an.text ? an.text.substring(0, 80) + (an.text.length>80? "..." : "") : "Announcement",
                description: an.text || "",
                createdTime: an.updateTime || an.createTime || new Date().toISOString(),
                link: an.alternateLink || null,
                raw: an,
              };
              console.log(`[Callback Debug] Indexing announcement: ${course.name} - ${item.title}`);
              await saveIndexedItem(googleId, item);
            }
          } catch (err) {
            console.error(`[Callback Debug] Error indexing course ${course.name}:`, err.message || err);
          }
        }

        // mark user as indexed (simple timestamp)
        await saveIndexedItem(googleId, { __meta: true, indexedAt: new Date().toISOString() }, true);
        console.log(`[Callback Debug] Initial indexing completed for Google ID ${googleId}.`);
        await sendMessageToGoogleUser(googleId, `✅ Hi ${userInfo.data.given_name}, your Google Classroom data has been indexed. You can now search: try typing "Show assignments today" or "/assignments today".`);
      } catch (err) {
        console.error("[Callback Debug] Error during initial indexing:", err);
        await sendMessageToGoogleUser(googleId, `⚠️ Indexed failed: ${err.message}`);
      }
    } else {
      console.log(`[Callback Debug] Not first login — skipping full indexing for Google ID ${googleId}.`);
      await sendMessageToGoogleUser(googleId, `✅ Hi ${userInfo.data.given_name}, your account is linked. Data was previously indexed.`);
    }

    await sendRawMessage(psid, `✅ Thank you, ${userInfo.data.given_name}! Your account is linked.`);
    res.send("<html><body><h1>Success!</h1><p>You can close this window now.</p></body></html>");
  } catch (err) {
    console.error("❌❌❌ CRITICAL ERROR IN GOOGLE CALLBACK ❌❌❌");
    console.error(err);
    const psid = req.query.state;
    if (psid) {
      try {
        await sendRawMessage(psid, `😥 Sorry, something went wrong during login. Please try again.`);
      } catch (e) {
        console.error("[Callback] Failed to send error message to PSID:", e);
      }
    }
    res.status(500).send(`Authentication failed: ${err.message}`);
  }
}
