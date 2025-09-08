import { sendLoginButton, sendRawMessage } from "../helpers/messengerHelper.js";
import { runCronJobs } from "../helpers/cronHelper.js";
import {
  isPsidRegistered,
  getGoogleIdByPsid,
  getUser,
  getContext,
  setContext,
  resetContext,
} from "../helpers/redisHelper.js";
import {
  createOAuth2ClientForRefreshToken,
  fetchCourses,
  fetchMaterials,
} from "../helpers/classroomHelper.js";
import { sendCourseList, sendMaterialsList, sendMaterialDetail } from "../helpers/messengerHelper.js";

const PAGE_SIZE = 5;

export default async function handler(req, res) {
  const VERIFY_TOKEN = process.env.MESSENGER_VERIFY_TOKEN;
  console.log("\n=== [/api/index] Incoming Request ===", {
    method: req.method,
    query: req.query,
  });

  // --- CRON trigger ---
  if (req.query.cron === "true") {
    console.log("[/api/index][CRON] Trigger requested via query param.");
    try {
      await runCronJobs();
      console.log("[/api/index][CRON] Cron jobs executed successfully.");
      return res.status(200).send("Cron jobs executed successfully.");
    } catch (err) {
      console.error("❌ [/api/index][CRON] Cron jobs failed:", err);
      return res.status(500).send("Cron jobs error");
    }
  }

  // --- Facebook Webhook Verification (GET) ---
  if (req.method === "GET") {
    console.log("[/api/index][GET] Webhook verification flow started.");
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    console.log("[/api/index][GET] Verification params:", { mode, token, challengePresent: !!challenge });

    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      console.log("[/api/index][GET] Webhook verified successfully.");
      return res.status(200).send(challenge);
    }
    console.warn("[/api/index][GET] Webhook verification failed. Forbidden.");
    return res.status(403).send("Forbidden");
  }

  // --- Messenger events (POST) ---
  if (req.method === "POST") {
    console.log("[/api/index][POST] Messenger webhook hit. Raw Body:", JSON.stringify(req.body, null, 2));
    try {
      const body = req.body;
      if (!body || body.object !== "page") {
        console.warn("[/api/index][POST] Invalid body or not a page event.");
        return res.status(400).send("Invalid request");
      }

      for (const entry of body.entry || []) {
        console.log("[/api/index][POST] Processing entry:", JSON.stringify(entry, null, 2));
        for (const event of entry.messaging || []) {
          const senderId = event.sender?.id;
          console.log("[/api/index][POST] Event loop - PSID:", senderId, "Event:", JSON.stringify(event, null, 2));
          if (!senderId) {
            console.log("[/api/index][POST] Skipping event without sender.id");
            continue;
          }

          // Only respond to actual user messages (ignore delivery/echo, etc.)
          if (!event.message) {
            console.log(`[Webhook] Ignoring non-message event from PSID: ${senderId}`);
            continue;
          }

          const textRaw = event.message.text || "";
          const text = (textRaw || "").trim();
          const textLower = text.toLowerCase();
          console.log("[/api/index][POST] Parsed user message:", { psid: senderId, text });

          // Registration check
          const isRegistered = await isPsidRegistered(senderId);
          console.log("[/api/index][POST] isPsidRegistered?", isRegistered);

          if (!isRegistered) {
            console.log("[/api/index][POST] User not registered. Sending login button.");
            await sendLoginButton(senderId);
            continue;
          }

          // From here, user is registered ⇒ get googleId + refreshToken for API calls
          const { googleId } = (await getGoogleIdByPsid(senderId)) || {};
          console.log("[/api/index][POST] Mapped googleId for PSID:", { psid: senderId, googleId });

          const user = googleId ? await getUser(googleId) : null;
          if (!user || !user.refreshToken) {
            console.error("[/api/index][POST] Registered PSID but missing user/refreshToken. Prompting re-login.");
            await sendRawMessage(senderId, "⚠️ Your Google link seems missing. Please log in again.");
            await sendLoginButton(senderId);
            continue;
          }

          // Build OAuth2 client for this user
          const oauth2Client = createOAuth2ClientForRefreshToken(user.refreshToken);

          // Materials feature state machine
          // Default entry: when user types "materials"
          if (textLower === "materials") {
            console.log("[MATERIALS] Entry command received. Setting stage=courseSelection");
            await setContext(senderId, { stage: "courseSelection", selectedCourse: null, page: 1 });
            const courses = await fetchCourses(oauth2Client);
            console.log("[MATERIALS] Courses fetched:", courses.length);

            await sendCourseList(senderId, courses);
            continue;
          }

          // Load current context
          const context = (await getContext(senderId)) || { stage: null, page: 1 };
          console.log("[MATERIALS] Current context for PSID:", senderId, context);

          // Handle state transitions only if we are inside the materials flow
          if (context?.stage) {
            console.log("[MATERIALS] Materials state machine active. Stage:", context.stage, "Input:", textLower);

            if (context.stage === "courseSelection") {
              // Expecting a number = course index, or 'back' (reset)
              if (textLower === "back") {
                console.log("[MATERIALS][courseSelection] Received 'back'. Resetting context.");
                await resetContext(senderId);
                await sendRawMessage(senderId, "↩️ Exited materials menu.");
                continue;
              }

              const selectedIndex = parseInt(text, 10);
              if (Number.isNaN(selectedIndex)) {
                console.log("[MATERIALS][courseSelection] Invalid input (not a number).");
                await sendRawMessage(senderId, "❓ Please type a number from the list to pick a course.");
                continue;
              }

              const courses = await fetchCourses(oauth2Client);
              console.log("[MATERIALS][courseSelection] Courses re-fetched for selection. Count:", courses.length);

              const course = courses[selectedIndex - 1];
              if (!course) {
                console.log("[MATERIALS][courseSelection] Invalid index selected:", selectedIndex);
                await sendRawMessage(senderId, "❌ Invalid course number. Please try again.");
                await sendCourseList(senderId, courses);
                continue;
              }

              console.log("[MATERIALS] User selected course:", course.id, "PSID:", senderId);
              await setContext(senderId, { stage: "materialSelection", selectedCourse: course.id, page: 1 });

              const materials = await fetchMaterials(oauth2Client, course.id);
              await sendMaterialsList(senderId, course, materials, 1, PAGE_SIZE);
              continue;
            }

            if (context.stage === "materialSelection") {
              // Valid commands: number → detail, 'back' → courseSelection, 'next' → pagination
              if (textLower === "back") {
                console.log("[MATERIALS][materialSelection] 'back' → courseSelection");
                await setContext(senderId, { stage: "courseSelection", selectedCourse: null, page: 1 });
                const courses = await fetchCourses(oauth2Client);
                await sendCourseList(senderId, courses);
                continue;
              }

              if (textLower === "next") {
                console.log("[MATERIALS][materialSelection] 'next' pagination requested.");
                const courseId = context.selectedCourse;
                const courses = await fetchCourses(oauth2Client);
                const course = (courses || []).find((c) => c.id === courseId);
                const materials = await fetchMaterials(oauth2Client, courseId);

                const totalPages = Math.max(1, Math.ceil((materials?.length || 0) / PAGE_SIZE));
                const nextPage = Math.min((context.page || 1) + 1, totalPages);
                console.log("[MATERIALS][materialSelection] Pagination:", { current: context.page, next: nextPage, totalPages });

                await setContext(senderId, { ...context, page: nextPage });
                await sendMaterialsList(senderId, course, materials, nextPage, PAGE_SIZE);
                continue;
              }

              const pickedIndex = parseInt(text, 10);
              if (Number.isNaN(pickedIndex)) {
                console.log("[MATERIALS][materialSelection] Invalid input (not a number).");
                await sendRawMessage(senderId, "❓ Please type a number from this page to open a material, or 'next' / 'back'.");
                continue;
              }

              const courseId = context.selectedCourse;
              const courses = await fetchCourses(oauth2Client);
              const course = (courses || []).find((c) => c.id === courseId);
              const materials = await fetchMaterials(oauth2Client, courseId);

              // Compute current page slice
              const page = context.page || 1;
              const start = (page - 1) * PAGE_SIZE;
              const end = start + PAGE_SIZE;
              const pageItems = (materials || []).slice(start, end);

              const material = pageItems[pickedIndex - 1];
              if (!material) {
                console.log("[MATERIALS][materialSelection] Invalid material index picked on this page:", pickedIndex);
                await sendRawMessage(senderId, "❌ Invalid material number on this page. Try again.");
                await sendMaterialsList(senderId, course, materials, page, PAGE_SIZE);
                continue;
              }

              console.log("[MATERIALS] User selected material:", material.id, "PSID:", senderId);
              await setContext(senderId, { stage: "detail", selectedCourse: courseId, page });

              await sendMaterialDetail(senderId, course, material);
              continue;
            }

            if (context.stage === "detail") {
              // Valid command: 'back' → materialSelection (same page)
              if (textLower === "back") {
                console.log("[MATERIALS][detail] 'back' → materialSelection");
                const courseId = context.selectedCourse;
                const courses = await fetchCourses(oauth2Client);
                const course = (courses || []).find((c) => c.id === courseId);
                const materials = await fetchMaterials(oauth2Client, courseId);
                await setContext(senderId, { stage: "materialSelection", selectedCourse: courseId, page: context.page || 1 });
                await sendMaterialsList(senderId, course, materials, context.page || 1, PAGE_SIZE);
                continue;
              }

              // Any other text at detail view will re-show details to keep UX tight
              console.log("[MATERIALS][detail] Non-back input; re-showing material instructions.");
              await sendRawMessage(senderId, "Type 'back' to return to the material list.");
              continue;
            }
          }

          // Fallback for other messages when already linked but not in materials flow
          console.log("[/api/index][POST] User is linked & no materials state match. Sending friendly ack.");
          await sendRawMessage(senderId, `✅ Your account is linked and active.\nType "materials" anytime to browse course materials with direct Google Classroom links.`);
        }
      }
      return res.status(200).send("EVENT_RECEIVED");
    } catch (err) {
      console.error("❌ [/api/index][POST] Error handling message:", err);
      return res.status(500).send("Error");
    }
  }

  console.warn("[/api/index] Invalid request method:", req.method);
  return res.status(400).send("Invalid request method");
}
