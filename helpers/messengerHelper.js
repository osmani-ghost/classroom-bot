import fetch from "node-fetch";
import { getUser, resetContext } from "./redisHelper.js";

const FB_API_VERSION = "v19.0";

// Core sender to Facebook Messenger Send API
async function sendApiRequest(payload) {
  const PAGE_ACCESS_TOKEN = process.env.MESSENGER_PAGE_ACCESS_TOKEN;
  const url = `https://graph.facebook.com/${FB_API_VERSION}/me/messages?access_token=${PAGE_ACCESS_TOKEN}`;

  console.log("[Messenger][sendApiRequest] START", {
    hasToken: !!PAGE_ACCESS_TOKEN,
    recipient: payload?.recipient?.id,
    messagePreview: JSON.stringify(payload?.message)?.slice(0, 200),
  });

  if (!PAGE_ACCESS_TOKEN) {
    console.error("❌ [Messenger] MESSENGER_PAGE_ACCESS_TOKEN is missing.");
    return;
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    if (!response.ok || result.error) {
      console.error("[Messenger][sendApiRequest] API Error:", result.error || result);
    } else {
      console.log("[Messenger][sendApiRequest] SUCCESS:", result);
    }
  } catch (error) {
    console.error("❌ [Messenger][sendApiRequest] Network/Unknown Error:", error);
  }
}

// Send plain text
export async function sendRawMessage(psid, text) {
  console.log("[Messenger][sendRawMessage] → PSID:", psid, "Text Preview:", (text || "").slice(0, 200));
  const payload = { recipient: { id: psid }, message: { text } };
  await sendApiRequest(payload);
}

// Send "Login with Google" button
export async function sendLoginButton(psid) {
  const domain = process.env.PUBLIC_URL || `https://${process.env.VERCEL_URL}`;
  const loginUrl = `${domain}/api/auth/google?psid=${encodeURIComponent(psid)}`;
  console.log("[Messenger][sendLoginButton] Using loginUrl:", loginUrl);

  const payload = {
    recipient: { id: psid },
    message: {
      attachment: {
        type: "template",
        payload: {
          template_type: "button",
          text: "Welcome! Please log in with your university Google account to receive reminders.",
          buttons: [{ type: "web_url", url: loginUrl, title: "Login with Google" }],
        },
      },
    },
  };
  await sendApiRequest(payload);
}

// Send to a user by Google ID (maps to PSID via Redis)
export async function sendMessageToGoogleUser(googleId, text) {
  console.log("[Messenger][sendMessageToGoogleUser] GoogleID:", googleId, "Text Preview:", (text || "").slice(0, 200));
  const user = await getUser(googleId);
  if (!user || !user.psid) {
    console.error(`⚠️ [Messenger] No PSID mapped for Google ID: ${googleId}. Skipping send.`);
    return;
  }
  await sendRawMessage(user.psid, text);
}

// ======== UI Builders for "materials" flow (All include Classroom links) ========

// Course list (numbered) — includes direct course links
export async function sendCourseList(psid, courses, userInput = null) {
  console.log("[MATERIALS][sendCourseList] START", { psid, userInput, totalCourses: courses?.length || 0 });

  // Handle "done" early — clear context and end flow
  if (userInput && userInput.trim().toLowerCase() === "done") {
    console.log("[MATERIALS][sendCourseList] User typed 'done' → ending flow and resetting context.");
    try {
      await resetContext(psid);
      console.log("[MATERIALS][sendCourseList] resetContext success for", psid);
    } catch (err) {
      console.warn("[MATERIALS][sendCourseList] resetContext failed:", err);
    }
    await sendRawMessage(psid, "Okay");
    return;
  }

  if (!Array.isArray(courses) || courses.length === 0) {
    console.log("[MATERIALS][sendCourseList] No courses found for user:", psid);
    await sendRawMessage(psid, "📚 No active Google Classroom courses found.");
    return;
  }

  const lines = courses.map((c, idx) => {
    const code = c.section ? `${c.name} (${c.section})` : c.name;
    const link = c.alternateLink || "https://classroom.google.com";
    return `${idx + 1}. ${code}\n   ↗ Open: ${link}`;
  });

  const msg = `Please choose a course by typing the number:\n\n${lines.join("\n\n")}\n\n(Type 'done' to finish)`;
  console.log("[MATERIALS][sendCourseList] Sending message:", msg.slice(0, 300));
  await sendRawMessage(psid, msg);
}

// Materials list for a course — paginated — includes direct links
export async function sendMaterialsList(psid, course, materials, page = 1, pageSize = 5, userInput = null) {
  console.log("[MATERIALS][sendMaterialsList] START", {
    psid,
    courseId: course?.id,
    courseName: course?.name,
    totalMaterials: materials?.length || 0,
    page,
    pageSize,
    userInput,
  });

  // Handle "done"
  if (userInput && userInput.trim().toLowerCase() === "done") {
    console.log("[MATERIALS][sendMaterialsList] User typed 'done' → ending flow and resetting context.");
    try {
      await resetContext(psid);
      console.log("[MATERIALS][sendMaterialsList] resetContext success for", psid);
    } catch (err) {
      console.warn("[MATERIALS][sendMaterialsList] resetContext failed:", err);
    }
    await sendRawMessage(psid, "Okay");
    return;
  }

  const courseLink = course?.alternateLink || "https://classroom.google.com";
  if (!Array.isArray(materials) || materials.length === 0) {
    console.log("[MATERIALS][sendMaterialsList] No materials found for course:", course?.id);
    await sendRawMessage(
      psid,
      `📘 ${course?.name || "Course"} Materials — none found.\n↗ Open Course: ${courseLink}\n(Type 'back' to return to course list)\n(Type 'done' to finish)`
    );
    return;
  }

  const totalPages = Math.max(1, Math.ceil(materials.length / pageSize));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const start = (currentPage - 1) * pageSize;
  const end = start + pageSize;
  const pageItems = materials.slice(start, end);

  const lines = pageItems.map((m, idx) => {
    const title = m.title || "Untitled Material";
    const link = m.alternateLink || courseLink;
    return `${idx + 1}. ${title}\n   ↗ Open: ${link}`;
  });

  let footer = `\nShowing page ${currentPage} of ${totalPages}`;
  if (currentPage < totalPages) {
    footer += `\nType 'next' to see more`;
  }
  footer += `\n(Type 'back' to return to course list)\n(Type 'done' to finish)`;

  const msg = `📘 ${course?.name || "Course"} Materials — Select a material:\n\n${lines.join("\n\n")}\n${footer}\n\n↗ Open Course: ${courseLink}`;
  console.log("[MATERIALS][sendMaterialsList] Sending message:", msg.slice(0, 300));
  await sendRawMessage(psid, msg);
}

// Material detail — includes description, uploaded date, and direct link
export async function sendMaterialDetail(psid, course, material, userInput = null) {
  console.log("[MATERIALS][sendMaterialDetail] START", {
    psid,
    courseId: course?.id,
    materialId: material?.id,
    userInput,
  });

  // Handle "done"
  if (userInput && userInput.trim().toLowerCase() === "done") {
    console.log("[MATERIALS][sendMaterialDetail] User typed 'done' → ending flow and resetting context.");
    try {
      await resetContext(psid);
      console.log("[MATERIALS][sendMaterialDetail] resetContext success for", psid);
    } catch (err) {
      console.warn("[MATERIALS][sendMaterialDetail] resetContext failed:", err);
    }
    await sendRawMessage(psid, "Okay");
    return;
  }

  const uploaded = material.updateTime ? new Date(material.updateTime) : null;
  let uploadedStr = "Unknown date";
  if (uploaded) {
    uploaded.setHours(uploaded.getHours() + 6); // Convert to BDT
    const dd = String(uploaded.getDate()).padStart(2, "0");
    const mm = String(uploaded.getMonth() + 1).padStart(2, "0");
    const yyyy = uploaded.getFullYear();
    uploadedStr = `${dd} ${uploaded.toLocaleString("en-US", { month: "short" })} ${yyyy}`;
  }

  const title = material.title || "Untitled Material";
  const desc = material.description || "No description provided.";
  const link = material.alternateLink || course?.alternateLink || "https://classroom.google.com";

  const msg = `📘 ${course?.name || "Course"} — ${title}\n\nDescription: ${desc}\nUploaded: ${uploadedStr}\n\n🔗 Open in Google Classroom: ${link}\n\n(Type 'back' to return to material list)\n(Type 'done' to finish)`;
  console.log("[MATERIALS][sendMaterialDetail] Sending message:", msg.slice(0, 300));
  await sendRawMessage(psid, msg);
}

// =========================
// Announcements list (last 3) — new function
// =========================
export async function sendAnnouncementsList(psid, course, announcements = [], userInput = null) {
  console.log("[ANNOUNCEMENTS][sendAnnouncementsList] START", {
    psid,
    courseId: course?.id,
    courseName: course?.name,
    totalAnnouncements: announcements?.length || 0,
    userInput,
  });

  // Handle "done"
  if (userInput && userInput.trim().toLowerCase() === "done") {
    console.log("[ANNOUNCEMENTS] User typed 'done' → ending flow and resetting context.");
    try {
      await resetContext(psid);
      console.log("[ANNOUNCEMENTS] resetContext success for", psid);
    } catch (err) {
      console.warn("[ANNOUNCEMENTS] resetContext failed:", err);
    }
    await sendRawMessage(psid, "Okay");
    return;
  }

  const courseLink = course?.alternateLink || "https://classroom.google.com";
  if (!Array.isArray(announcements) || announcements.length === 0) {
    console.log("[ANNOUNCEMENTS] No announcements found for course:", course?.id);
    await sendRawMessage(
      psid,
      `📢 ${course?.name || "Course"} — No recent announcements.\n↗ Open Course: ${courseLink}\n(Type 'back' to return to course list)\n(Type 'done' to finish)`
    );
    return;
  }

  // Show last 3 announcements
  const top = announcements.slice(0, 3);
  const lines = top.map((a, idx) => {
    const textPreview = (a.text || "(No text)").replace(/\n/g, " ");
    const link = a.alternateLink || courseLink;
    return `${idx + 1}. ${textPreview}\n   ↗ Open: ${link}`;
  });

  const msg = `📢 ${course?.name || "Course"} — Recent Announcements:\n\n${lines.join("\n\n")}\n\n↗ Open Course: ${courseLink}\n(Type 'back' to return to course list)\n(Type 'done' to finish)`;
  console.log("[ANNOUNCEMENTS] Sending message:", msg.slice(0, 400));
  await sendRawMessage(psid, msg);
}

// =========================
// Assignments list (pending only recommended) — paginated — new function
// assignments array expected to be a list of coursework objects (filter by caller if needed).
// =========================
export async function sendAssignmentsList(psid, course, assignments = [], page = 1, pageSize = 5, userInput = null) {
  console.log("[ASSIGNMENTS][sendAssignmentsList] START", {
    psid,
    courseId: course?.id,
    courseName: course?.name,
    totalAssignments: assignments?.length || 0,
    page,
    pageSize,
    userInput,
  });

  // Handle "done"
  if (userInput && userInput.trim().toLowerCase() === "done") {
    console.log("[ASSIGNMENTS] User typed 'done' → ending flow and resetting context.");
    try {
      await resetContext(psid);
      console.log("[ASSIGNMENTS] resetContext success for", psid);
    } catch (err) {
      console.warn("[ASSIGNMENTS] resetContext failed:", err);
    }
    await sendRawMessage(psid, "Okay");
    return;
  }

  const courseLink = course?.alternateLink || "https://classroom.google.com";
  if (!Array.isArray(assignments) || assignments.length === 0) {
    console.log("[ASSIGNMENTS] No assignments found for course:", course?.id);
    await sendRawMessage(
      psid,
      `📘 ${course?.name || "Course"} — No assignments found.\n↗ Open Course: ${courseLink}\n(Type 'back' to return to course list)\n(Type 'done' to finish)`
    );
    return;
  }

  // Pagination
  const totalPages = Math.max(1, Math.ceil(assignments.length / pageSize));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const start = (currentPage - 1) * pageSize;
  const end = start + pageSize;
  const pageItems = assignments.slice(start, end);

  const lines = pageItems.map((a, idx) => {
    const title = a.title || "Untitled Assignment";
    const dueText = a.dueDate ? `${a.dueDate.day}-${String(a.dueDate.month).padStart(2, "0")}-${a.dueDate.year}` : "No due date";
    const link = a.alternateLink || courseLink;
    return `${idx + 1}. ${title} (Due: ${dueText})\n   ↗ Open: ${link}`;
  });

  let footer = `\nShowing page ${currentPage} of ${totalPages}`;
  if (currentPage < totalPages) footer += `\nType 'next' to see more`;
  footer += `\n(Type 'back' to return to course list)\n(Type 'done' to finish)`;

  const msg = `📘 ${course?.name || "Course"} — Assignments (pending)\n\n${lines.join("\n\n")}\n${footer}\n\n↗ Open Course: ${courseLink}`;
  console.log("[ASSIGNMENTS] Sending message:", msg.slice(0, 400));
  await sendRawMessage(psid, msg);
}

// Assignment detail view (title, description, due, link)
export async function sendAssignmentDetail(psid, course, assignment, userInput = null) {
  console.log("[ASSIGNMENTS][sendAssignmentDetail] START", {
    psid,
    courseId: course?.id,
    assignmentId: assignment?.id,
    userInput,
  });

  // Handle "done"
  if (userInput && userInput.trim().toLowerCase() === "done") {
    console.log("[ASSIGNMENTS] User typed 'done' → ending flow and resetting context.");
    try {
      await resetContext(psid);
      console.log("[ASSIGNMENTS] resetContext success for", psid);
    } catch (err) {
      console.warn("[ASSIGNMENTS] resetContext failed:", err);
    }
    await sendRawMessage(psid, "Okay");
    return;
  }

  const title = assignment.title || "Untitled Assignment";
  const desc = assignment.description || "No description provided.";
  const due = assignment.dueDate ? formatDueDateShort(assignment.dueDate, assignment.dueTime) : "No due date";
  const link = assignment.alternateLink || course?.alternateLink || "https://classroom.google.com";

  const msg = `📘 ${course?.name || "Course"} — ${title}\n\nDescription: ${desc}\nDue: ${due}\n\n🔗 Open in Google Classroom: ${link}\n\n(Type 'back' to return to assignment list)\n(Type 'done' to finish)`;
  console.log("[ASSIGNMENTS] Sending message:", msg.slice(0, 400));
  await sendRawMessage(psid, msg);
}

// small helper for assignment due formatting (BDT)
function formatDueDateShort(dueDate, dueTime) {
  try {
    const utcDate = new Date(
      Date.UTC(
        dueDate.year,
        dueDate.month - 1,
        dueDate.day,
        dueTime?.hours ?? 23,
        dueTime?.minutes ?? 0
      )
    );
    utcDate.setHours(utcDate.getHours() + 6); // convert to BDT
    const dd = String(utcDate.getDate()).padStart(2, "0");
    const mm = String(utcDate.getMonth() + 1).padStart(2, "0");
    const yyyy = utcDate.getFullYear();
    let hours = utcDate.getHours();
    const minutes = String(utcDate.getMinutes()).padStart(2, "0");
    const ampm = hours >= 12 ? "PM" : "AM";
    hours = hours % 12 || 12;
    return `${dd}-${mm}-${yyyy}, ${hours}:${minutes} ${ampm}`;
  } catch (err) {
    return "Unknown";
  }
}
