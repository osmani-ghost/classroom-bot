// classroom/helpers/messengerHelper.js
// Messenger sending helpers and UI builders for the flows

import fetch from "node-fetch";
import { getUser } from "./redisHelper.js";

const FB_API_VERSION = "v19.0";

function log(label, data) {
  console.log(`[Messenger][${label}]`, data || "");
}

async function sendApiRequest(payload) {
  const PAGE_ACCESS_TOKEN = process.env.MESSENGER_PAGE_ACCESS_TOKEN;
  const url = `https://graph.facebook.com/${FB_API_VERSION}/me/messages?access_token=${PAGE_ACCESS_TOKEN}`;
  log("sendApiRequest", { to: payload?.recipient?.id, hasToken: !!PAGE_ACCESS_TOKEN });

  if (!PAGE_ACCESS_TOKEN) {
    console.error("[Messenger] Missing PAGE_ACCESS_TOKEN");
    return;
  }

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = await resp.json();
    if (!resp.ok || json?.error) {
      console.error("[Messenger][sendApiRequest] API error:", json?.error || json);
    } else {
      log("sendApiRequestSuccess", json);
    }
  } catch (err) {
    console.error("[Messenger][sendApiRequest] Network error:", err);
  }
}

function isDone(userInput) {
  return Boolean(userInput && typeof userInput === "string" && userInput.trim().toLowerCase() === "done");
}

export async function sendRawMessage(psid, text) {
  log("sendRawMessage", { psid, len: (text || "").length });
  const payload = { recipient: { id: psid }, message: { text } };
  await sendApiRequest(payload);
}

export async function sendLoginButton(psid) {
  const domain = process.env.PUBLIC_URL || `https://${process.env.VERCEL_URL}`;
  const loginUrl = `${domain}/api/auth/google?psid=${encodeURIComponent(psid)}`;
  log("sendLoginButton", { psid, loginUrlPreview: loginUrl.slice(0, 120) });

  const payload = {
    recipient: { id: psid },
    message: {
      attachment: {
        type: "template",
        payload: {
          template_type: "button",
          text: "Welcome! Please log in with your Google account to link Classroom and receive reminders.",
          buttons: [{ type: "web_url", url: loginUrl, title: "Login with Google" }],
        },
      },
    },
  };
  await sendApiRequest(payload);
}

// Send message given googleId (maps to PSID via redis)
export async function sendMessageToGoogleUser(googleId, text) {
  const user = await getUser(googleId);
  if (!user || !user.psid) {
    console.warn("[Messenger] No PSID mapped for googleId:", googleId);
    return;
  }
  await sendRawMessage(user.psid, text);
}

// UI builders

export async function sendCourseList(psid, courses) {
  log("sendCourseList", { psid, total: courses?.length || 0 });
  if (!Array.isArray(courses) || courses.length === 0) {
    await sendRawMessage(psid, "📚 No active Google Classroom courses found.");
    return;
  }

  const lines = courses.map((c, i) => {
    const label = c.section ? `${c.name} (${c.section})` : c.name;
    const link = c.alternateLink || "https://classroom.google.com";
    return `${i + 1}. ${label}\n   ↗ Open: ${link}`;
  });

  const msg = `Select a course by typing its number:\n\n${lines.join("\n\n")}\n\n(Type 'back' to cancel | 'done' to finish)`;
  await sendRawMessage(psid, msg);
}

export async function sendMaterialsList(psid, course, materials = [], page = 1, pageSize = 5) {
  log("sendMaterialsList", { psid, courseId: course?.id, total: materials?.length || 0 });
  const courseLink = course?.alternateLink || "https://classroom.google.com";
  if (!Array.isArray(materials) || materials.length === 0) {
    await sendRawMessage(psid, `📘 ${course?.name || "Course"} Materials — none found.\n↗ Open Course: ${courseLink}\n(Type 'back' to return)`);
    return;
  }

  const totalPages = Math.max(1, Math.ceil(materials.length / pageSize));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const start = (currentPage - 1) * pageSize;
  const pageItems = materials.slice(start, start + pageSize);

  const lines = pageItems.map((m, i) => {
    const title = m.title || "Untitled Material";
    const link = m.alternateLink || courseLink;
    return `${i + 1}. ${title}\n   ↗ Open: ${link}`;
  });

  let footer = `\nShowing page ${currentPage} of ${totalPages}`;
  if (currentPage < totalPages) footer += `\nType 'next' to see more`;
  footer += `\n(Type 'back' to return | 'done' to finish)`;

  const msg = `📘 ${course?.name || "Course"} Materials — Select a material:\n\n${lines.join("\n\n")}${footer}\n\n↗ Open Course: ${courseLink}`;
  await sendRawMessage(psid, msg);
}

export async function sendMaterialDetail(psid, course, material) {
  log("sendMaterialDetail", { psid, courseId: course?.id, materialId: material?.id });

  const uploaded = material.updateTime ? new Date(material.updateTime) : null;
  let uploadedStr = "Unknown date";
  if (uploaded) {
    uploaded.setHours(uploaded.getHours() + 6);
    uploadedStr = `${String(uploaded.getDate()).padStart(2, "0")} ${uploaded.toLocaleString("en-US", { month: "short" })} ${uploaded.getFullYear()}`;
  }

  const title = material.title || "Untitled Material";
  const desc = material.description || "No description.";
  const link = material.alternateLink || course?.alternateLink || "https://classroom.google.com";
  const msg = `📘 ${course?.name || "Course"} — ${title}\n\nDescription: ${desc}\nUploaded: ${uploadedStr}\n\n🔗 Open in Google Classroom: ${link}\n\n(Type 'back' | 'done')`;
  await sendRawMessage(psid, msg);
}

// Announcements
export async function sendAnnouncementsList(psid, course, announcements = [], page = 1, pageSize = 3) {
  log("sendAnnouncementsList", { psid, courseId: course?.id, total: announcements?.length || 0 });
  const courseLink = course?.alternateLink || "https://classroom.google.com";
  if (!Array.isArray(announcements) || announcements.length === 0) {
    await sendRawMessage(psid, `📢 ${course?.name || "Course"} Announcements — none found.\n↗ Open Course: ${courseLink}\n(Type 'back' to return)`);
    return;
  }

  const totalPages = Math.max(1, Math.ceil(announcements.length / pageSize));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const start = (currentPage - 1) * pageSize;
  const pageItems = announcements.slice(start, start + pageSize);

  const lines = pageItems.map((a, i) => {
    const preview = (a.text && a.text.slice(0, 80)) || a.title || "Announcement";
    const link = a.alternateLink || courseLink;
    return `${i + 1}. ${preview}\n   ↗ Open: ${link}`;
  });

  let footer = `\nShowing page ${currentPage} of ${totalPages}`;
  if (currentPage < totalPages) footer += `\nType 'next' to see more`;
  footer += `\n(Type 'back' | 'done')`;

  const msg = `📢 ${course?.name || "Course"} Announcements — Select an announcement:\n\n${lines.join("\n\n")}${footer}\n\n↗ Open Course: ${courseLink}`;
  await sendRawMessage(psid, msg);
}

export async function sendAnnouncementDetail(psid, course, announcement) {
  log("sendAnnouncementDetail", { psid, courseId: course?.id, announcementId: announcement?.id });
  const text = announcement.text || "(No text)";
  const updated = announcement.updateTime ? new Date(announcement.updateTime) : null;
  let updatedStr = "Unknown date";
  if (updated) {
    updated.setHours(updated.getHours() + 6);
    updatedStr = `${String(updated.getDate()).padStart(2, "0")} ${updated.toLocaleString("en-US", { month: "short" })} ${updated.getFullYear()}`;
  }
  const link = announcement.alternateLink || course?.alternateLink || "https://classroom.google.com";
  const msg = `📢 ${course?.name || "Course"} — Announcement\n\n${text}\n\nUpdated: ${updatedStr}\n\n🔗 Open in Google Classroom: ${link}\n\n(Type 'back' | 'done')`;
  await sendRawMessage(psid, msg);
}

// Assignments
export async function sendAssignmentsList(psid, course, assignments = [], page = 1, pageSize = 5) {
  log("sendAssignmentsList", { psid, courseId: course?.id, total: assignments?.length || 0 });
  const courseLink = course?.alternateLink || "https://classroom.google.com";
  if (!Array.isArray(assignments) || assignments.length === 0) {
    await sendRawMessage(psid, `📘 ${course?.name || "Course"} Assignments (Pending) — none found.\n↗ Open Course: ${courseLink}\n(Type 'back' to return)`);
    return;
  }

  const totalPages = Math.max(1, Math.ceil(assignments.length / pageSize));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const start = (currentPage - 1) * pageSize;
  const pageItems = assignments.slice(start, start + pageSize);

  const lines = pageItems.map((a, i) => {
    const when = a.dueDate
      ? (() => {
          const d = new Date(Date.UTC(a.dueDate.year, a.dueDate.month - 1, a.dueDate.day, a.dueTime?.hours ?? 23, a.dueTime?.minutes ?? 0));
          d.setHours(d.getHours() + 6);
          const day = String(d.getDate()).padStart(2, "0");
          const month = String(d.getMonth() + 1).padStart(2, "0");
          const year = d.getFullYear();
          const hours = d.getHours() % 12 || 12;
          const minutes = String(d.getMinutes()).padStart(2, "0");
          const ampm = d.getHours() >= 12 ? "PM" : "AM";
          return `${day}-${month}-${year}, ${hours}:${minutes} ${ampm}`;
        })()
      : "No due date set";
    const link = a.alternateLink || courseLink;
    return `${i + 1}. ${a.title}\n   Due: ${when}\n   ↗ Open: ${link}`;
  });

  let footer = `\nShowing page ${currentPage} of ${totalPages}`;
  if (currentPage < totalPages) footer += `\nType 'next' to see more`;
  footer += `\n(Type 'back' | 'done')`;

  const msg = `📘 ${course?.name || "Course"} Assignments (Pending)\n\n${lines.join("\n\n")}${footer}\n\n↗ Open Course: ${courseLink}`;
  await sendRawMessage(psid, msg);
}

export async function sendAssignmentDetail(psid, course, assignment) {
  log("sendAssignmentDetail", { psid, courseId: course?.id, assignmentId: assignment?.id });

  const desc = assignment.description || "No description provided.";
  let dueStr = "No due date set";
  if (assignment.dueDate) {
    const d = new Date(Date.UTC(assignment.dueDate.year, assignment.dueDate.month - 1, assignment.dueDate.day, assignment.dueTime?.hours ?? 23, assignment.dueTime?.minutes ?? 0));
    d.setHours(d.getHours() + 6);
    const day = String(d.getDate()).padStart(2, "0");
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const year = d.getFullYear();
    const hours = d.getHours() % 12 || 12;
    const minutes = String(d.getMinutes()).padStart(2, "0");
    const ampm = d.getHours() >= 12 ? "PM" : "AM";
    dueStr = `${day}-${month}-${year}, ${hours}:${minutes} ${ampm}`;
  }

  const link = assignment.alternateLink || course?.alternateLink || "https://classroom.google.com";
  const msg = `📘 ${course?.name || "Course"} — ${assignment.title}\n\nDescription: ${desc}\nDue: ${dueStr}\n\n🔗 Open in Google Classroom: ${link}\n\n(Type 'back' | 'done')`;
  await sendRawMessage(psid, msg);
}
