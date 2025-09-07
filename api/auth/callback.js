import { google } from "googleapis";
import {
  saveUser,
  saveItemForPsid,
  setLastCheckedTime,
} from "../../helpers/redisHelper.js";
import { sendRawMessage } from "../../helpers/messengerHelper.js";
import {
  fetchCourses,
  fetchAssignments,
  fetchAnnouncements,
  fetchMaterials,
  generateKeywordsFromText,
} from "../../helpers/classroomHelper.js";

export default async function handler(req, res) {
  console.log("\n--- GOOGLE AUTH CALLBACK TRIGGERED ---");
  const { code, state } = req.query;
  const psid = state;
  try {
    console.log("[Callback] Received query:", { code: !!code, state: !!state });
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );

    if (!code || !psid) {
      console.error("[Callback] Missing code or state (psid).");
      throw new Error("Missing code or state from Google callback.");
    }

    console.log("[Callback] Exchanging code for tokens...");
    const { tokens } = await oauth2Client.getToken(code);
    if (tokens && tokens.refresh_token) {
      console.log(
        `[Callback] SUCCESS: Received refresh token (preview): ${tokens.refresh_token.substring(
          0,
          10
        )}...`
      );
    } else {
      console.error(
        "❌ CRITICAL: Refresh token was NOT provided by Google. Ask user to remove app and retry."
      );
      throw new Error(
        "Refresh token not received. Please REMOVE app access from your Google account and try again."
      );
    }

    oauth2Client.setCredentials(tokens);

    console.log("[Callback] Fetching userinfo...");
    const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
    const userInfo = await oauth2.userinfo.get();
    const googleId = userInfo.data.id;
    console.log(`[Callback] User info received. Google ID = ${googleId}`);

    console.log("[Callback] Saving user record to Redis...");
    await saveUser(googleId, { psid: psid, refreshToken: tokens.refresh_token });

    // INITIAL DATA SYNC & INDEXING
    try {
      console.log("[Callback] Starting initial data sync & indexing for PSID:", psid);
      const clientWithRefresh = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI
      );
      clientWithRefresh.setCredentials({ refresh_token: tokens.refresh_token });

      // fetch all courses
      const courses = await fetchCourses(clientWithRefresh);
      console.log(`[Callback] Fetched ${courses.length} courses for user ${googleId}.`);

      // For each course, fetch assignments, announcements, materials
      for (const course of courses) {
        console.log(`[Callback] Processing course: ${course.name} (${course.id})`);
        // Assignments
        const assignments = await fetchAssignments(clientWithRefresh, course.id);
        console.log(
          `[Callback] Found ${assignments.length} assignments in course ${course.name}`
        );
        for (const a of assignments) {
          try {
            const itemId = a.id;
            const title = a.title || "Untitled Assignment";
            const createdAt = a.creationTime || new Date().toISOString();
            const dueDateISO = a.dueDate
              ? new Date(
                  Date.UTC(
                    a.dueDate.year,
                    a.dueDate.month - 1,
                    a.dueDate.day,
                    a.dueTime?.hours || 23,
                    a.dueTime?.minutes || 0
                  )
                ).toISOString()
              : null;
            const link = a.alternateLink || null;
            const description = a.description || "";
            const keywords = generateKeywordsFromText(`${title} ${description}`);
            const itemObj = {
              id: itemId,
              title,
              type: "assignment",
              courseId: course.id,
              courseName: course.name,
              createdAt,
              dueDate: dueDateISO,
              link,
              keywords,
            };
            console.log(
              `[Callback] Saving assignment item for PSID ${psid}: ${itemId} (${title})`
            );
            await saveItemForPsid(psid, itemObj);
          } catch (err) {
            console.error("[Callback] Error saving assignment item:", err);
          }
        }

        // Announcements
        const announcements = await fetchAnnouncements(clientWithRefresh, course.id);
        console.log(
          `[Callback] Found ${announcements.length} announcements in course ${course.name}`
        );
        for (const an of announcements) {
          try {
            const itemId = an.id;
            const title = an.text ? an.text.slice(0, 120) : "Announcement";
            const createdAt = an.createTime || an.updateTime || new Date().toISOString();
            const link = an.alternateLink || null;
            const description = an.text || "";
            const keywords = generateKeywordsFromText(description);
            const itemObj = {
              id: itemId,
              title,
              type: "announcement",
              courseId: course.id,
              courseName: course.name,
              createdAt,
              dueDate: null,
              link,
              keywords,
            };
            console.log(
              `[Callback] Saving announcement item for PSID ${psid}: ${itemId} (${title})`
            );
            await saveItemForPsid(psid, itemObj);
          } catch (err) {
            console.error("[Callback] Error saving announcement item:", err);
          }
        }

        // Materials
        const materials = await fetchMaterials(clientWithRefresh, course.id);
        console.log(
          `[Callback] Found ${materials.length} materials in course ${course.name}`
        );
        for (const m of materials) {
          try {
            const itemId = m.id;
            const title = m.title || m.title?.slice?.(0, 120) || "Material";
            const createdAt = m.createTime || m.updateTime || new Date().toISOString();
            const link = m.alternateLink || null;
            const description = (m.description || "") + " " + (m.topic || "");
            const keywords = generateKeywordsFromText(description);
            const itemObj = {
              id: itemId,
              title,
              type: "material",
              courseId: course.id,
              courseName: course.name,
              createdAt,
              dueDate: null,
              link,
              keywords,
            };
            console.log(
              `[Callback] Saving material item for PSID ${psid}: ${itemId} (${title})`
            );
            await saveItemForPsid(psid, itemObj);
          } catch (err) {
            console.error("[Callback] Error saving material item:", err);
          }
        }

        // Set last checked time for the course to the latest content time to avoid re-sending huge histories
        try {
          // Find latest update time among announcements & materials
          const timestamps = [];
          for (const an of announcements) if (an.updateTime) timestamps.push(new Date(an.updateTime).toISOString());
          for (const m of materials) if (m.updateTime) timestamps.push(new Date(m.updateTime).toISOString());
          const latest = timestamps.sort().reverse()[0];
          if (latest) {
            console.log(`[Callback] Setting lastCheckedTime for course ${course.id} => ${latest}`);
            await setLastCheckedTime(course.id, latest);
          }
        } catch (err) {
          console.error("[Callback] Error setting lastCheckedTime for course:", err);
        }
      } // end courses loop

      console.log("[Callback] Initial indexing complete for PSID:", psid);
    } catch (syncErr) {
      console.error("[Callback] Initial sync error (non-fatal):", syncErr);
    }

    console.log("[Callback] Sending final success message to PSID.");
    await sendRawMessage(psid, `✅ Thank you, ${userInfo.data.given_name}! Your account is linked.`);

    res.send("<html><body><h1>Success!</h1><p>You can close this window now.</p></body></html>");
  } catch (err) {
    console.error("❌❌❌ CRITICAL ERROR IN GOOGLE CALLBACK ❌❌❌");
    console.error(err);
    if (psid) {
      try {
        await sendRawMessage(psid, "😥 Sorry, something went wrong during login. Please try again.");
      } catch (sendErr) {
        console.error("[Callback] Failed to notify PSID about error:", sendErr);
      }
    }
    res.status(500).send(`Authentication failed: ${err.message}`);
  } finally {
    console.log("--- GOOGLE AUTH CALLBACK EXIT ---\n");
  }
}
