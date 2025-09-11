// classroom/api/index.js
// Messenger webhook and command router (Vercel serverless handler)
// Uses ESM and exports default handler(req, res)

import { json } from "micro";
import {
  sendLoginButton,
  sendRawMessage,
  sendCourseList,
  sendMaterialsList,
  sendMaterialDetail,
  sendAnnouncementsList,
  sendAnnouncementDetail,
  sendAssignmentsList,
  sendAssignmentDetail,
} from "../helpers/messengerHelper.js";

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
  fetchAnnouncements,
  fetchAssignments,
  isTurnedIn,
} from "../helpers/classroomHelper.js";

import { runCronJobs } from "../helpers/cronHelper.js";

const PAGE_SIZE = 5;
const ANN_PAGE_SIZE = 3;

// Utility - safe parse text
function getMessageText(event) {
  try {
    return event?.message?.text?.trim() || "";
  } catch {
    return "";
  }
}

// Main serverless function
export default async function handler(req, res) {
  console.log("\n==============================");
  console.log("🌐 [/api/index] Request Received");
  console.log("Method:", req.method, "Query:", req.query || {});
  console.log("==============================");

  // Cron shortcut (GET ?cron=true)
  if (req.method === "GET" && req.query?.cron === "true") {
    console.log("[/api/index][CRON] Manual cron trigger requested.");
    try {
      await runCronJobs();
      console.log("[/api/index][CRON] Cron complete.");
      return res.status(200).send("Cron executed");
    } catch (err) {
      console.error("[/api/index][CRON] Cron failed:", err);
      return res.status(500).send("Cron error");
    }
  }

  // Webhook verification (GET)
  if (req.method === "GET") {
    const VERIFY_TOKEN = process.env.MESSENGER_VERIFY_TOKEN;
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    console.log("[/api/index][GET] Webhook verify:", { mode, hasChallenge: !!challenge });

    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      console.log("[/api/index][GET] Webhook verified successfully.");
      return res.status(200).send(challenge);
    }
    console.warn("[/api/index][GET] Verification failed.");
    return res.status(403).send("Forbidden");
  }

  // Messenger events (POST)
  if (req.method === "POST") {
    let body;
    try {
      body = await json(req);
      console.log("[/api/index][POST] Raw body:", JSON.stringify(body).slice(0, 2000));
    } catch (err) {
      console.error("[/api/index][POST] Failed to parse body:", err);
      return res.status(400).send("Invalid body");
    }

    if (body.object !== "page") {
      console.warn("[/api/index][POST] Ignoring non-page webhook.");
      return res.status(400).send("Ignored");
    }

    try {
      for (const entry of body.entry || []) {
        console.log("[/api/index][POST] entry:", JSON.stringify(entry).slice(0, 1000));
        for (const event of entry.messaging || []) {
          const psid = event.sender?.id;
          console.log("[/api/index][POST] Processing event for PSID:", psid);

          if (!psid) {
            console.log("[/api/index][POST] No PSID - skipping event.");
            continue;
          }

          // Only handle real user messages (skip echoes, delivery, postback handled separately)
          if (event.message && event.message.text) {
            const rawText = getMessageText(event);
            console.log(`[Message] PSID=${psid} Text="${rawText}"`);
            await processUserMessage(psid, rawText);
          } else if (event.postback) {
            // If you later add postback buttons, handle them here
            console.log("[/api/index][POST] Received a postback - not used currently:", JSON.stringify(event.postback));
            await sendRawMessage(psid, "Postbacks are not used. Please type a command: announcements, assignments, materials.");
          } else {
            console.log("[/api/index][POST] Ignoring non-text event for PSID:", psid);
          }
        }
      }
      return res.status(200).send("EVENT_RECEIVED");
    } catch (err) {
      console.error("[/api/index][POST] Processing error:", err);
      return res.status(500).send("Server error");
    }
  }

  // Anything else
  console.warn("[/api/index] Unsupported method:", req.method);
  return res.status(405).send("Method not allowed");
}

// ====== Message processing and flows ======

async function processUserMessage(psid, input) {
  console.log("[processUserMessage] PSID:", psid, "Input:", input);
  const text = (input || "").trim();
  const textLower = text.toLowerCase();

  // Quick built-in commands
  if (textLower === "help" || textLower === "menu") {
    console.log("[processUserMessage] Showing main menu.");
    await resetContext(psid);
    await sendRawMessage(
      psid,
      `Hello! Here are the commands you can use:\n\n• announcements → View course announcements\n• assignments → View pending assignments\n• materials → View course materials\n\nType a command to get started.`
    );
    return;
  }

  // Check registration
  const registered = await isPsidRegistered(psid);
  console.log("[processUserMessage] isPsidRegistered:", registered);

  if (!registered) {
    console.log("[processUserMessage] Not registered — prompting login.");
    await sendLoginButton(psid);
    return;
  }

  // Get mapping googleId
  const mapping = await getGoogleIdByPsid(psid);
  if (!mapping || !mapping.googleId) {
    console.log("[processUserMessage] No google mapping — prompting login.");
    await sendLoginButton(psid);
    return;
  }
  const googleId = mapping.googleId;
  const user = await getUser(googleId);
  if (!user || !user.refreshToken) {
    console.log("[processUserMessage] Missing refreshToken — prompting login.");
    await sendRawMessage(psid, "⚠️ We couldn't find your Google link. Please log in again.");
    await sendLoginButton(psid);
    return;
  }

  // Flexible switch: at any point if user types a main command, reset flow and start that flow
  if (["materials", "assignments", "announcements"].includes(textLower)) {
    console.log("[processUserMessage] Detected top-level command:", textLower);
    // Reset context for new command
    await setContext(psid, { stage: "courseSelection", flow: textLower, selectedCourse: null, page: 1 });
    // Present course list for chosen flow
    const oauth = createOAuth2ClientForRefreshToken(user.refreshToken);
    const courses = await fetchCourses(oauth);
    await sendCourseList(psid, courses);
    return;
  }

  // Otherwise, continue according to saved context (if any)
  const context = (await getContext(psid)) || { stage: null, flow: null, page: 1 };
  console.log("[processUserMessage] Current context:", context);

  // If no active flow, tell user valid commands
  if (!context.flow) {
    console.log("[processUserMessage] No active flow. Asking user to pick a command.");
    await sendRawMessage(psid, "⚠️ Please type one of these commands: announcements, assignments, materials.");
    return;
  }

  // Dispatch to flow handlers
  try {
    if (context.flow === "materials") {
      await materialsFlowHandler(psid, user.refreshToken, context, text);
      return;
    }
    if (context.flow === "announcements") {
      await announcementsFlowHandler(psid, user.refreshToken, context, text);
      return;
    }
    if (context.flow === "assignments") {
      await assignmentsFlowHandler(psid, user.refreshToken, context, text);
      return;
    }

    // unknown flow
    await sendRawMessage(psid, "⚠️ Unknown flow. Type 'menu' to see commands.");
  } catch (err) {
    console.error("[processUserMessage] Flow handler error:", err);
    await sendRawMessage(psid, "❌ Something went wrong while processing your request. Try again or type 'menu'.");
  }
}

// ---------------- Materials Flow ----------------
async function materialsFlowHandler(psid, refreshToken, context, text) {
  console.log("[materialsFlowHandler] PSID:", psid, "Context:", context, "Text:", text);
  const oauth = createOAuth2ClientForRefreshToken(refreshToken);
  const courses = await fetchCourses(oauth);

  // If stage is courseSelection
  if (!context.stage || context.stage === "courseSelection") {
    const idx = parseInt(text, 10);
    if (!Number.isNaN(idx) && courses[idx - 1]) {
      const course = courses[idx - 1];
      const materials = await fetchMaterials(oauth, course.id);
      await setContext(psid, { stage: "materialSelection", flow: "materials", selectedCourse: course.id, page: 1 });
      await sendMaterialsList(psid, course, materials, 1, PAGE_SIZE);
      return;
    }

    // invalid input: show course list (with guidance)
    await setContext(psid, { stage: "courseSelection", flow: "materials", page: 1 });
    await sendCourseList(psid, courses);
    await sendRawMessage(psid, `Type the number of the course you want. Or type 'done' to finish.`);
    return;
  }

  // materialSelection stage
  if (context.stage === "materialSelection") {
    const course = courses.find((c) => c.id === context.selectedCourse);
    if (!course) {
      console.log("[materialsFlowHandler] Course not found in cached list; resetting to courseSelection.");
      await setContext(psid, { stage: "courseSelection", flow: "materials", page: 1 });
      await sendCourseList(psid, courses);
      return;
    }

    const materials = await fetchMaterials(oauth, course.id);
    const page = context.page || 1;

    // navigation
    if (text.toLowerCase() === "back") {
      await setContext(psid, { stage: "courseSelection", flow: "materials", selectedCourse: null, page: 1 });
      await sendCourseList(psid, courses);
      return;
    }
     if (text.toLowerCase() === "help" || text.toLowerCase() === "menu") {
    console.log("[processUserMessage] Showing main menu.");
    await resetContext(psid);
    await sendRawMessage(
      psid,
      `Hello! Here are the commands you can use:\n\n• announcements → View course announcements\n• assignments → View pending assignments\n• materials → View course materials\n\nType a command to get started.`
    );
    return;
  }

  if (text.toLowerCase() === "instructions") {
    console.log("[processUserMessage] Showing instructions.");
    await resetContext(psid);
    await sendRawMessage(
      psid,
      `📖 Instructions:\n
- Type "materials" → Browse course materials\n
- Type "assignments" → View pending assignments\n
- Type "announcements" → See course announcements\n
- Navigation: "next" / "back"\n
- Exit: "done"\n
- Type "menu" or "help" anytime to see main options.`
    );
    return;
  }
    if (text.toLowerCase() === "done") {
      await resetContext(psid);
      await sendRawMessage(psid, "✅ Okay, finished!");
      return;
    }
    if (text.toLowerCase() === "next") {
      const totalPages = Math.max(1, Math.ceil((materials?.length || 0) / PAGE_SIZE));
      const nextPage = Math.min(page + 1, totalPages);
      await setContext(psid, { ...context, page: nextPage });
      await sendMaterialsList(psid, course, materials, nextPage, PAGE_SIZE);
      return;
    }

    // number -> detail
    const idx = parseInt(text, 10);
    if (!Number.isNaN(idx)) {
      const start = (page - 1) * PAGE_SIZE;
      const material = (materials || [])[start + idx - 1];
      if (material) {
        await setContext(psid, { stage: "detail", flow: "materials", selectedCourse: course.id, selectedMaterial: material.id, page });
        await sendMaterialDetail(psid, course, material);
        return;
      } else {
        await sendRawMessage(psid, "❌ Invalid number on this page. Please try again or type 'next'/'back'/'done'.");
        await sendMaterialsList(psid, course, materials, page, PAGE_SIZE);
        return;
      }
    }

    // fallback invalid
    await sendRawMessage(psid, "⚠️ Please type a number shown, or 'next', 'back', or 'done'.");
    return;
  }

  // detail stage
  if (context.stage === "detail") {
    const course = courses.find((c) => c.id === context.selectedCourse);
    const materials = await fetchMaterials(oauth, course.id);
    const material = (materials || []).find((m) => m.id === context.selectedMaterial);

    if (text.toLowerCase() === "back") {
      await setContext(psid, { stage: "materialSelection", flow: "materials", selectedCourse: course.id, page: context.page || 1 });
      await sendMaterialsList(psid, course, materials, context.page || 1, PAGE_SIZE);
      return;
    }
    if (text.toLowerCase() === "done") {
      await resetContext(psid);
      await sendRawMessage(psid, "✅ Okay, finished!");
      return;
    }

    await sendRawMessage(psid, "Type 'back' to return to list or 'done' to finish.");
    return;
  }

  // default
  await sendRawMessage(psid, "⚠️ Unknown materials state. Type 'materials' to restart or 'menu' for options.");
}

// ---------------- Announcements Flow ----------------
async function announcementsFlowHandler(psid, refreshToken, context, text) {
  console.log("[announcementsFlowHandler] PSID:", psid, "Context:", context, "Text:", text);
  const oauth = createOAuth2ClientForRefreshToken(refreshToken);
  const courses = await fetchCourses(oauth);

  // course selection
  if (!context.stage || context.stage === "courseSelection") {
    const idx = parseInt(text, 10);
    if (!Number.isNaN(idx) && courses[idx - 1]) {
      const course = courses[idx - 1];
      const announcements = await fetchAnnouncements(oauth, course.id);
      await setContext(psid, { stage: "announcementsList", flow: "announcements", selectedCourse: course.id, page: 1 });
      await sendAnnouncementsList(psid, course, announcements, 1, ANN_PAGE_SIZE);
      return;
    }

    await setContext(psid, { stage: "courseSelection", flow: "announcements", page: 1 });
    await sendCourseList(psid, courses);
    await sendRawMessage(psid, "Type the number of the course to view announcements.");
    return;
  }

  // announcements list
  if (context.stage === "announcementsList") {
    const course = courses.find((c) => c.id === context.selectedCourse);
    if (!course) {
      await setContext(psid, { stage: "courseSelection", flow: "announcements", page: 1 });
      await sendCourseList(psid, courses);
      return;
    }

    const announcements = await fetchAnnouncements(oauth, course.id);
    const page = context.page || 1;

    if (text.toLowerCase() === "next") {
      const totalPages = Math.max(1, Math.ceil((announcements?.length || 0) / ANN_PAGE_SIZE));
      const nextPage = Math.min(page + 1, totalPages);
      await setContext(psid, { ...context, page: nextPage });
      await sendAnnouncementsList(psid, course, announcements, nextPage, ANN_PAGE_SIZE);
      return;
    }
    if (text.toLowerCase() === "back") {
      await setContext(psid, { stage: "courseSelection", flow: "announcements", page: 1 });
      await sendCourseList(psid, courses);
      return;
    }
    if (text.toLowerCase() === "done") {
      await resetContext(psid);
      await sendRawMessage(psid, "✅ Okay, finished!");
      return;
    }

    const idx = parseInt(text, 10);
    if (!Number.isNaN(idx)) {
      const start = (page - 1) * ANN_PAGE_SIZE;
      const ann = (announcements || [])[start + idx - 1];
      if (ann) {
        await setContext(psid, { stage: "announcementDetail", flow: "announcements", selectedCourse: course.id, selectedAnnouncement: ann.id, page });
        await sendAnnouncementDetail(psid, course, ann);
        return;
      } else {
        await sendRawMessage(psid, "❌ Invalid number on this page. Try again or type 'next'/'back'/'done'.");
        await sendAnnouncementsList(psid, course, announcements, page, ANN_PAGE_SIZE);
        return;
      }
    }

    await sendRawMessage(psid, "⚠️ Please type a number from the list, or 'next'/'back'/'done'.");
    return;
  }

  // announcement detail
  if (context.stage === "announcementDetail") {
    const course = courses.find((c) => c.id === context.selectedCourse);
    const announcements = await fetchAnnouncements(oauth, course.id);
    const ann = (announcements || []).find((a) => a.id === context.selectedAnnouncement);

    if (text.toLowerCase() === "back") {
      await setContext(psid, { stage: "announcementsList", flow: "announcements", selectedCourse: course.id, page: context.page || 1 });
      await sendAnnouncementsList(psid, course, announcements, context.page || 1, ANN_PAGE_SIZE);
      return;
    }
    if (text.toLowerCase() === "done") {
      await resetContext(psid);
      await sendRawMessage(psid, "✅ Okay, finished!");
      return;
    }

    await sendRawMessage(psid, "Type 'back' to return to announcements or 'done' to finish.");
    return;
  }

  await sendRawMessage(psid, "⚠️ Unknown announcements state. Type 'announcements' to restart or 'menu' for options.");
}

// ---------------- Assignments Flow ----------------
async function assignmentsFlowHandler(psid, refreshToken, context, text) {
  console.log("[assignmentsFlowHandler] PSID:", psid, "Context:", context, "Text:", text);
  const oauth = createOAuth2ClientForRefreshToken(refreshToken);
  const courses = await fetchCourses(oauth);

  // course selection
  if (!context.stage || context.stage === "courseSelection") {
    const idx = parseInt(text, 10);
    if (!Number.isNaN(idx) && courses[idx - 1]) {
      const course = courses[idx - 1];
      let assignments = await fetchAssignments(oauth, course.id);
      // augment turnedIn status
      assignments = await Promise.all(
        (assignments || []).map(async (a) => ({ ...a, turnedIn: await isTurnedIn(oauth, course.id, a.id, "me") }))
      );
      // filter pending
      assignments = assignments.filter((a) => !a.turnedIn);
      await setContext(psid, { stage: "assignmentsList", flow: "assignments", selectedCourse: course.id, page: 1 });
      await sendAssignmentsList(psid, course, assignments, 1, PAGE_SIZE);
      return;
    }

    await setContext(psid, { stage: "courseSelection", flow: "assignments", page: 1 });
    await sendCourseList(psid, courses);
    await sendRawMessage(psid, "Type the number of the course to view pending assignments.");
    return;
  }

  // assignments list
  if (context.stage === "assignmentsList") {
    const course = courses.find((c) => c.id === context.selectedCourse);
    if (!course) {
      await setContext(psid, { stage: "courseSelection", flow: "assignments", page: 1 });
      await sendCourseList(psid, courses);
      return;
    }

    let assignments = await fetchAssignments(oauth, course.id);
    assignments = await Promise.all((assignments || []).map(async (a) => ({ ...a, turnedIn: await isTurnedIn(oauth, course.id, a.id, "me") })));
    assignments = assignments.filter((a) => !a.turnedIn);
    const page = context.page || 1;

    if (text.toLowerCase() === "next") {
      const totalPages = Math.max(1, Math.ceil((assignments?.length || 0) / PAGE_SIZE));
      const nextPage = Math.min(page + 1, totalPages);
      await setContext(psid, { ...context, page: nextPage });
      await sendAssignmentsList(psid, course, assignments, nextPage, PAGE_SIZE);
      return;
    }
    if (text.toLowerCase() === "back") {
      await setContext(psid, { stage: "courseSelection", flow: "assignments", page: 1 });
      await sendCourseList(psid, courses);
      return;
    }
    if (text.toLowerCase() === "done") {
      await resetContext(psid);
      await sendRawMessage(psid, "✅ Okay, finished!");
      return;
    }

    const idx = parseInt(text, 10);
    if (!Number.isNaN(idx)) {
      const start = (page - 1) * PAGE_SIZE;
      const assignment = (assignments || [])[start + idx - 1];
      if (assignment) {
        await setContext(psid, { stage: "assignmentDetail", flow: "assignments", selectedCourse: course.id, selectedAssignment: assignment.id, page });
        await sendAssignmentDetail(psid, course, assignment);
        return;
      } else {
        await sendRawMessage(psid, "❌ Invalid number on this page. Try again or type 'next'/'back'/'done'.");
        await sendAssignmentsList(psid, course, assignments, page, PAGE_SIZE);
        return;
      }
    }

    await sendRawMessage(psid, "⚠️ Please type a number shown, or 'next', 'back', or 'done'.");
    return;
  }

  // assignment detail
  if (context.stage === "assignmentDetail") {
    const course = courses.find((c) => c.id === context.selectedCourse);
    let assignments = await fetchAssignments(oauth, course.id);
    assignments = await Promise.all((assignments || []).map(async (a) => ({ ...a, turnedIn: await isTurnedIn(oauth, course.id, a.id, "me") })));
    assignments = assignments.filter((a) => !a.turnedIn);
    const assignment = (assignments || []).find((a) => a.id === context.selectedAssignment);

    if (text.toLowerCase() === "back") {
      await setContext(psid, { stage: "assignmentsList", flow: "assignments", selectedCourse: course.id, page: context.page });
      await sendAssignmentsList(psid, course, assignments, context.page, PAGE_SIZE);
      return;
    }
    if (text.toLowerCase() === "done") {
      await resetContext(psid);
      await sendRawMessage(psid, "✅ Okay, finished!");
      return;
    }

    await sendRawMessage(psid, "Type 'back' to return to list, or 'done' to finish.");
    return;
  }

  await sendRawMessage(psid, "⚠️ Unknown assignment state. Type 'assignments' to restart or 'menu' for options.");
}
