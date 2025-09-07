import { google } from "googleapis";
import {
  saveUser,
  saveIndexedItem,
  getUser,
} from "../../helpers/redisHelper.js";
import {
  sendRawMessage,
  sendMessageToGoogleUser,
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
    if (!code || !psid) {
      console.error("[Callback] Missing code or state in callback query.");
      return res.status(400).send("Missing code or state.");
    }

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );

    console.log(`[Callback Debug] Step 1: Received code for PSID: ${psid}`);
    console.log(`[Callback Debug] Step 2: Exchanging code for tokens...`);

    // Exchange code for tokens. This may throw invalid_grant if the code was already used or expired.
    let tokenResponse;
    try {
      tokenResponse = await oauth2Client.getToken(code);
    } catch (err) {
      console.error("[Callback] Error during oauth2Client.getToken:", err?.response?.data || err.message || err);
      // If invalid_grant, it's usually because code is used/expired or redirect mismatch
      const msg = (err?.response?.data?.error === "invalid_grant") ?
        "Google error: authorization code expired/invalid. Please try logging in again (use the fresh login link we send)." :
        `Error exchanging code: ${err?.message || "unknown error"}`;
      // Notify user via Messenger if possible
      if (psid) {
        try {
          await sendRawMessage(psid, `😥 ${msg}`);
        } catch (e) {
          console.error("[Callback] Failed to send message to PSID:", e);
        }
      }
      return res.status(400).send(msg);
    }

    const tokens = tokenResponse.tokens;
    if (!tokens) {
      console.error("[Callback] No tokens returned from Google.");
      await sendRawMessage(psid, "⚠️ No tokens returned from Google. Please try again.");
      return res.status(500).send("No tokens returned.");
    }

    if (!tokens.refresh_token) {
      // Google sometimes doesn't send refresh token on repeated consents for same account.
      // If user is already linked, try to fetch existing refresh token from DB and use it.
      console.warn("[Callback] Refresh token not present in token response.");
    } else {
      console.log(`[Callback Debug] Step 3: Received refresh token (visible prefix): ${tokens.refresh_token.substring(0,10)}...`);
    }

    oauth2Client.setCredentials(tokens);

    console.log(`[Callback Debug] Step 4: Fetching user info...`);
    const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
    const userInfo = await oauth2.userinfo.get();
    const googleId = userInfo.data.id;
    console.log(`[Callback Debug] Step 5: User info received. Google ID = ${googleId}`);

    // Save user data into Redis
    // If refresh_token not present but we already had one in DB, keep that
    const existingUser = await getUser(googleId);
    let refreshToStore = tokens.refresh_token || existingUser?.refreshToken || null;
    if (!refreshToStore) {
      // No refresh token available -> cannot perform server-side cron actions. Ask user to remove app and re-consent.
      console.error("[Callback] No refresh token available (neither new nor existing). Cannot proceed with server-side operations.");
      await sendRawMessage(psid, "⚠️ We didn't receive a refresh token. Please remove the app from your Google account and login again (we require offline access).");
      // Still save basic mapping so UI can function, but warn.
      await saveUser(googleId, { psid, refreshToken: null });
      return res.send("<html><body><h1>Linked (limited)</h1><p>Account linked but offline access missing. Close this window.</p></body></html>");
    }

    console.log(`[Callback Debug] Step 6: Saving user to Redis with refresh token (masked)`);
    await saveUser(googleId, { psid, refreshToken: refreshToStore });

    // Initial indexing if first login or no meta
    const existing = await getUser(googleId);
    const isFirstLogin = !existing || !existing.indexedAt;
    if (isFirstLogin) {
      console.log(`[Callback Debug] First-time login for ${googleId}. Running initial index of courses/assignments/materials/announcements.`);
      try {
        // Create oauth client using refresh token to call Classroom APIs
        const userOauth = new google.auth.OAuth2(
          process.env.GOOGLE_CLIENT_ID,
          process.env.GOOGLE_CLIENT_SECRET,
          process.env.GOOGLE_REDIRECT_URI
        );
        userOauth.setCredentials({ refresh_token: refreshToStore });

        const courses = await fetchCourses(userOauth);
        console.log(`[Callback Debug] Found ${courses.length} courses for user ${googleId}.`);

        for (const course of courses || []) {
          if (!course) continue;
          const courseName = course.name || "Unnamed Course";
          console.log(`[Callback Debug] Indexing course ${courseName} (${course.id})`);

          // Assignments
          try {
            const assignments = await fetchAssignments(userOauth, course.id);
            for (const a of assignments || []) {
              if (!a) continue;
              const title = a.title || a.alternateLink || "Untitled assignment";
              const item = {
                id: a.id,
                type: "assignment",
                courseId: course.id,
                courseName,
                title,
                description: a.description || "",
                createdTime: a.creationTime || a.updateTime || new Date().toISOString(),
                dueDate: a.dueDate || null,
                dueTime: a.dueTime || null,
                link: a.alternateLink || null,
                raw: a,
              };
              console.log(`[Callback Debug] Indexing assignment: ${courseName} - ${title}`);
              await saveIndexedItem(googleId, item);
            }
          } catch (err) {
            console.error(`[Callback Debug] Error fetching assignments for course ${courseName}:`, err?.message || err);
          }

          // Materials
          try {
            const materials = await fetchMaterials(userOauth, course.id);
            for (const m of materials || []) {
              if (!m) continue;
              const title = m.title || m.submission?.title || m.alternateLink || "Material";
              const item = {
                id: m.id || `mat-${Math.random().toString(36).slice(2,8)}`,
                type: "material",
                courseId: course.id,
                courseName,
                title,
                description: m.description || "",
                createdTime: m.creationTime || m.updateTime || new Date().toISOString(),
                link: m.alternateLink || null,
                raw: m,
              };
              console.log(`[Callback Debug] Indexing material: ${courseName} - ${title}`);
              await saveIndexedItem(googleId, item);
            }
          } catch (err) {
            console.error(`[Callback Debug] Error fetching materials for course ${courseName}:`, err?.message || err);
          }

          // Announcements
          try {
            const announcements = await fetchAnnouncements(userOauth, course.id);
            for (const an of announcements || []) {
              if (!an) continue;
              const text = an.text || an.updateTime || "Announcement";
              const item = {
                id: an.id || `ann-${Math.random().toString(36).slice(2,8)}`,
                type: "announcement",
                courseId: course.id,
                courseName,
                title: text.substring(0, 120),
                description: an.text || "",
                createdTime: an.updateTime || an.createTime || new Date().toISOString(),
                link: an.alternateLink || null,
                raw: an,
              };
              console.log(`[Callback Debug] Indexing announcement: ${courseName} - ${item.title}`);
              await saveIndexedItem(googleId, item);
            }
          } catch (err) {
            console.error(`[Callback Debug] Error fetching announcements for course ${courseName}:`, err?.message || err);
          }
        }

        // mark meta indexedAt
        await saveIndexedItem(googleId, { __meta: true, indexedAt: new Date().toISOString() }, true);
        console.log(`[Callback Debug] Initial indexing completed for Google ID ${googleId}.`);
        await sendMessageToGoogleUser(googleId, `✅ Hi ${userInfo.data.given_name || "student"}, your Google Classroom data has been indexed. You can now search: try typing "/assignments today" or "Show assignments today".`);
      } catch (err) {
        console.error("[Callback Debug] Error during initial indexing:", err);
        await sendMessageToGoogleUser(googleId, `⚠️ Initial indexing failed: ${err?.message || err}.`);
      }
    } else {
      console.log(`[Callback Debug] Existing user detected for ${googleId}. Skipping full re-index.`);
      await sendMessageToGoogleUser(googleId, `✅ Hi ${userInfo.data.given_name || "student"}, your account is linked.`);
    }

    // Final friendly browser page for user
    await sendRawMessage(psid, `✅ Thank you, ${userInfo.data.given_name || "student"}! Your account is linked.`);
    res.send("<html><body><h1>Success!</h1><p>You can close this window now.</p></body></html>");
  } catch (err) {
    console.error("❌❌❌ CRITICAL ERROR IN GOOGLE CALLBACK ❌❌❌", err);
    try {
      const psid = req.query.state;
      if (psid) {
        await sendRawMessage(psid, `😥 Sorry, something went wrong during login. Please try again.`);
      }
    } catch (e) {
      console.error("[Callback] Failed to send error message to PSID:", e);
    }
    return res.status(500).send(`Authentication failed: ${err?.message || err}`);
  }
}
