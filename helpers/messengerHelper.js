import fetch from "node-fetch";
import { getUser } from "./redisHelper.js";

const FB_API_VERSION = "v19.0";

// Core sender to Facebook Messenger Send API
async function sendApiRequest(payload) {
  const PAGE_ACCESS_TOKEN = process.env.MESSENGER_PAGE_ACCESS_TOKEN;
  const url = `https://graph.facebook.com/${FB_API_VERSION}/me/messages?access_token=${PAGE_ACCESS_TOKEN}`;

  console.debug("[Messenger] Sending API request", {
    hasToken: !!PAGE_ACCESS_TOKEN,
    recipient: payload?.recipient?.id,
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
      console.debug("[Messenger][sendApiRequest] Success");
    }
  } catch (error) {
    console.error("❌ [Messenger][sendApiRequest] Network/Unknown Error:", error);
  }
}

// helper to robustly test "done"
function isDoneCommand(userInput) {
  return Boolean(userInput && typeof userInput === "string" && userInput.trim().toLowerCase() === "done");
}

// Send plain text
export async function sendRawMessage(psid, text) {
  console.debug("[Messenger][sendRawMessage] → PSID:", psid, "Text length:", (text || "").length);
  const payload = { recipient: { id: psid }, message: { text } };
  await sendApiRequest(payload);
}

// Send "Login with Google" button
export async function sendLoginButton(psid) {
  const domain = process.env.PUBLIC_URL || `https://${process.env.VERCEL_URL}`;
  const loginUrl = `${domain}/api/auth/google?psid=${encodeURIComponent(psid)}`;

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
  const user = await getUser(googleId);
  if (!user || !user.psid) {
    console.warn(`[Messenger] No PSID mapped for Google ID: ${googleId}. Skipping send.`);
    return;
  }
  await sendRawMessage(user.psid, text);
}

// ======== UI Builders for "materials" flow (All include Classroom links) ========

// Course list (numbered) — includes direct course links
export async function sendCourseList(psid, courses, userInput = null) {
  console.debug("[MATERIALS][sendCourseList] START", { psid, totalCourses: courses?.length || 0 });

  if (isDoneCommand(userInput)) {
    await sendRawMessage(psid, "Okay");
    return;
  }

  if (!Array.isArray(courses) || courses.length === 0) {
    await sendRawMessage(psid, "📚 No active Google Classroom courses found.");
    return;
  }

  const lines = courses.map((c, idx) => {
    const code = c.section ? `${c.name} (${c.section})` : c.name;
    const link = c.alternateLink || "https://classroom.google.com";
    return `${idx + 1}. ${code}\n   ↗ Open: ${link}`;
  });

  const msg = `Please choose a course by typing the number:\n\n${lines.join("\n\n")}`;
  await sendRawMessage(psid, msg);
}

// Materials list for a course — paginated — includes direct links
export async function sendMaterialsList(psid, course, materials, page = 1, pageSize = 5, userInput = null) {
  console.debug("[MATERIALS][sendMaterialsList] START", {
    psid,
    courseId: course?.id,
    totalMaterials: materials?.length || 0,
  });

  if (isDoneCommand(userInput)) {
    await sendRawMessage(psid, "Okay");
    return;
  }

  const courseLink = course?.alternateLink || "https://classroom.google.com";
  if (!Array.isArray(materials) || materials.length === 0) {
    await sendRawMessage(
      psid,
      `📘 ${course?.name || "Course"} Materials — none found.\n↗ Open Course: ${courseLink}\n(Type 'back' to return to course list)`
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
  await sendRawMessage(psid, msg);
}

// Material detail — includes description, uploaded date, and direct link
export async function sendMaterialDetail(psid, course, material, userInput = null) {
  console.debug("[MATERIALS][sendMaterialDetail] START", {
    psid,
    courseId: course?.id,
    materialId: material?.id,
  });

  if (isDoneCommand(userInput)) {
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
  await sendRawMessage(psid, msg);
}

// ======== New: Announcements (list + detail) ========
export async function sendAnnouncementsList(psid, course, announcements = [], page = 1, pageSize = 3, userInput = null) {
  console.debug("[ANNOUNCEMENTS][sendAnnouncementsList] START", { psid, courseId: course?.id, total: announcements.length });

  if (isDoneCommand(userInput)) {
    await sendRawMessage(psid, "Okay");
    return;
  }

  const courseLink = course?.alternateLink || "https://classroom.google.com";
  if (!Array.isArray(announcements) || announcements.length === 0) {
    await sendRawMessage(psid, `📢 ${course?.name || "Course"} Announcements — none found.\n↗ Open Course: ${courseLink}\n(Type 'back' to return to course list)`);
    return;
  }

  const totalPages = Math.max(1, Math.ceil(announcements.length / pageSize));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const start = (currentPage - 1) * pageSize;
  const end = start + pageSize;
  const pageItems = announcements.slice(start, end);

  const lines = pageItems.map((a, idx) => {
    const title = a.text?.slice(0, 80) || a.title || "Announcement";
    const link = a.alternateLink || courseLink;
    return `${idx + 1}. ${title}\n   ↗ Open: ${link}`;
  });

  let footer = `\nShowing page ${currentPage} of ${totalPages}`;
  if (currentPage < totalPages) {
    footer += `\nType 'next' to see more`;
  }
  footer += `\n(Type 'back' to return to course list)\n(Type 'done' to finish)`;

  const msg = `📢 ${course?.name || "Course"} Announcements — Select an announcement:\n\n${lines.join("\n\n")}\n${footer}\n\n↗ Open Course: ${courseLink}`;
  await sendRawMessage(psid, msg);
}

export async function sendAnnouncementDetail(psid, course, announcement, userInput = null) {
  console.debug("[ANNOUNCEMENTS][sendAnnouncementDetail] START", { psid, courseId: course?.id });

  if (isDoneCommand(userInput)) {
    await sendRawMessage(psid, "Okay");
    return;
  }

  const text = announcement.text || "(No text)";
  const updated = announcement.updateTime ? new Date(announcement.updateTime) : null;
  let updatedStr = "Unknown date";
  if (updated) {
    updated.setHours(updated.getHours() + 6);
    updatedStr = `${String(updated.getDate()).padStart(2, "0")} ${updated.toLocaleString("en-US", { month: "short" })} ${updated.getFullYear()}`;
  }
  const link = announcement.alternateLink || course?.alternateLink || "https://classroom.google.com";
  const msg = `📢 ${course?.name || "Course"} — Announcement\n\n${text}\n\nUpdated: ${updatedStr}\n\n🔗 Open in Google Classroom: ${link}\n\n(Type 'back' to return to announcements)\n(Type 'done' to finish)`;
  await sendRawMessage(psid, msg);
}

// ======== New: Assignments (list + detail) ========
// NOTE: the 'assignments' array passed to this function should already be filtered
// for "pending" assignments (not TURNED_IN). This function will present them.
export async function sendAssignmentsList(psid, course, assignments = [], page = 1, pageSize = 5, userInput = null) {
  console.debug("[ASSIGNMENTS][sendAssignmentsList] START", { psid, courseId: course?.id, total: assignments.length });

  if (isDoneCommand(userInput)) {
    await sendRawMessage(psid, "Okay");
    return;
  }

  const courseLink = course?.alternateLink || "https://classroom.google.com";
  if (!Array.isArray(assignments) || assignments.length === 0) {
    await sendRawMessage(psid, `📘 ${course?.name || "Course"} Assignments (Pending) — none found.\n↗ Open Course: ${courseLink}\n(Type 'back' to return to course list)`);
    return;
  }

  const totalPages = Math.max(1, Math.ceil(assignments.length / pageSize));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const start = (currentPage - 1) * pageSize;
  const end = start + pageSize;
  const pageItems = assignments.slice(start, end);

  const lines = pageItems.map((a, idx) => {
    const when = a.dueDate ? (() => {
      const d = new Date(Date.UTC(a.dueDate.year, a.dueDate.month - 1, a.dueDate.day, a.dueTime?.hours ?? 23, a.dueTime?.minutes ?? 0));
      d.setHours(d.getHours() + 6);
      const day = String(d.getDate()).padStart(2, "0");
      const month = String(d.getMonth() + 1).padStart(2, "0");
      const year = d.getFullYear();
      const hours = d.getHours() % 12 || 12;
      const minutes = String(d.getMinutes()).padStart(2, "0");
      const ampm = d.getHours() >= 12 ? "PM" : "AM";
      return `${day}-${month}-${year}, ${hours}:${minutes} ${ampm}`;
    })() : "No due date set";
    const link = a.alternateLink || courseLink;
    return `${idx + 1}. ${a.title}\n   Due: ${when}\n   ↗ Open: ${link}`;
  });

  let footer = `\nShowing page ${currentPage} of ${totalPages}`;
  if (currentPage < totalPages) {
    footer += `\nType 'next' to see more`;
  }
  footer += `\n(Type 'back' to return to course list)\n(Type 'done' to finish)`;

  const msg = `📘 ${course?.name || "Course"} Assignments (Pending)\n\n${lines.join("\n\n")}\n${footer}\n\n↗ Open Course: ${courseLink}`;
  await sendRawMessage(psid, msg);
}

export async function sendAssignmentDetail(psid, course, assignment, userInput = null) {
  console.debug("[ASSIGNMENTS][sendAssignmentDetail] START", { psid, courseId: course?.id, assignmentId: assignment?.id });

  if (isDoneCommand(userInput)) {
    await sendRawMessage(psid, "Okay");
    return;
  }

  const desc = assignment.description || "No description provided.";
  let dueStr = "No due date set";
  if (assignment.dueDate) {
    dueStr = (() => {
      const d = new Date(Date.UTC(assignment.dueDate.year, assignment.dueDate.month - 1, assignment.dueDate.day, assignment.dueTime?.hours ?? 23, assignment.dueTime?.minutes ?? 0));
      d.setHours(d.getHours() + 6);
      const day = String(d.getDate()).padStart(2, "0");
      const month = String(d.getMonth() + 1).padStart(2, "0");
      const year = d.getFullYear();
      const hours = d.getHours() % 12 || 12;
      const minutes = String(d.getMinutes()).padStart(2, "0");
      const ampm = d.getHours() >= 12 ? "PM" : "AM";
      return `${day}-${month}-${year}, ${hours}:${minutes} ${ampm}`;
    })();
  }
  const link = assignment.alternateLink || course?.alternateLink || "https://classroom.google.com";
  const msg = `📘 ${course?.name || "Course"} — ${assignment.title}\n\nDescription: ${desc}\nDue: ${dueStr}\n\n🔗 Open in Google Classroom: ${link}\n\n(Type 'back' to return to assignments)\n(Type 'done' to finish)`;
  await sendRawMessage(psid, msg);
}
