// classroom/helpers/classroomHelper.js
// Thin wrapper around googleapis Classroom endpoints with consistent logging and defensive handling.

import { google } from "googleapis";

function log(label, data) {
  console.log(`[Classroom][${label}]`, data || "");
}

async function callApi(func, label) {
  try {
    log(`CALL:${label}`, "calling...");
    const resp = await func();
    const data = resp?.data || {};
    log(`RESP:${label}`, JSON.stringify(data).slice(0, 400));
    return data || {};
  } catch (err) {
    const errInfo = err?.response?.data || err;
    console.error(`[Classroom][ERR:${label}]`, errInfo);
    return {};
  }
}

export function createOAuth2ClientForRefreshToken(refreshToken) {
  log("OAuthClient", "creating with refresh token");
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  return oauth2Client;
}

export async function fetchCourses(oauth2Client) {
  const classroom = google.classroom({ version: "v1", auth: oauth2Client });
  const data = await callApi(() => classroom.courses.list({ courseStates: ["ACTIVE"] }), "courses.list");
  return data.courses || [];
}

export async function fetchAssignments(oauth2Client, courseId) {
  const classroom = google.classroom({ version: "v1", auth: oauth2Client });
  const data = await callApi(() => classroom.courses.courseWork.list({ courseId, orderBy: "updateTime desc" }), `courseWork.list:${courseId}`);
  return data.courseWork || [];
}

export async function isTurnedIn(oauth2Client, courseId, assignmentId, userId = "me") {
  const classroom = google.classroom({ version: "v1", auth: oauth2Client });
  const data = await callApi(() => classroom.courses.courseWork.studentSubmissions.list({ courseId, courseWorkId: assignmentId, userId }), `studentSubmissions.list:${courseId}/${assignmentId}`);
  const sub = data.studentSubmissions?.[0];
  const turnedIn = sub?.state === "TURNED_IN";
  log(`turnedIn:${courseId}/${assignmentId}`, turnedIn);
  return !!turnedIn;
}

export async function fetchAnnouncements(oauth2Client, courseId) {
  const classroom = google.classroom({ version: "v1", auth: oauth2Client });
  const data = await callApi(() => classroom.courses.announcements.list({ courseId, orderBy: "updateTime desc" }), `announcements.list:${courseId}`);
  return data.announcements || [];
}

export async function fetchMaterials(oauth2Client, courseId) {
  const classroom = google.classroom({ version: "v1", auth: oauth2Client });
  const data = await callApi(() => classroom.courses.courseWorkMaterials.list({ courseId, orderBy: "updateTime desc" }), `materials.list:${courseId}`);
  return data.courseWorkMaterial || [];
}
