import { google } from "googleapis";

function logApi(label, details) {
  console.log(`[Classroom][${label}]`, details || "");
}

async function executeApiCall(apiCall, label = "execute") {
  try {
    logApi(`CALL:${label}`, "Executing Google API call...");
    const response = await apiCall();
    const data = response?.data || {};
    logApi(`RESP:${label}`, JSON.stringify(data).slice(0, 400));
    return data || {};
  } catch (error) {
    const gerr = error?.response?.data?.error || error;
    console.error(`❌ [Classroom][ERR:${label}]`, gerr);
    return {};
  }
}

// Create OAuth2 client from a refresh token
export function createOAuth2ClientForRefreshToken(refreshToken) {
  logApi("OAuth2Client", "Creating OAuth2Client with refresh token.");
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  return oauth2Client;
}

// Fetch ACTIVE courses
export async function fetchCourses(oauth2Client) {
  const classroom = google.classroom({ version: "v1", auth: oauth2Client });
  const data = await executeApiCall(
    () => classroom.courses.list({ courseStates: ["ACTIVE"] }),
    "courses.list"
  );
  const courses = data.courses || [];
  logApi("courses.count", courses.length);
  return courses;
}

// Fetch coursework (assignments) for a course
export async function fetchAssignments(oauth2Client, courseId) {
  const classroom = google.classroom({ version: "v1", auth: oauth2Client });
  const data = await executeApiCall(
    () => classroom.courses.courseWork.list({ courseId, orderBy: "updateTime desc" }),
    `courseWork.list:${courseId}`
  );
  const cw = data.courseWork || [];
  logApi(`courseWork.count:${courseId}`, cw.length);
  return cw;
}

// Check if a coursework is turned in by a user (me)
export async function isTurnedIn(oauth2Client, courseId, assignmentId, userId = "me") {
  const classroom = google.classroom({ version: "v1", auth: oauth2Client });
  const data = await executeApiCall(
    () =>
      classroom.courses.courseWork.studentSubmissions.list({
        courseId,
        courseWorkId: assignmentId,
        userId,
      }),
    `studentSubmissions.list:${courseId}/${assignmentId}:${userId}`
  );
  const submission = data.studentSubmissions?.[0];
  const turnedIn = submission?.state === "TURNED_IN";
  logApi(`turnedIn:${courseId}/${assignmentId}`, turnedIn);
  return turnedIn;
}

// Announcements
export async function fetchAnnouncements(oauth2Client, courseId) {
  const classroom = google.classroom({ version: "v1", auth: oauth2Client });
  const data = await executeApiCall(
    () => classroom.courses.announcements.list({ courseId, orderBy: "updateTime desc" }),
    `announcements.list:${courseId}`
  );
  return data.announcements || [];
}

// Materials
export async function fetchMaterials(oauth2Client, courseId) {
  const classroom = google.classroom({ version: "v1", auth: oauth2Client });
  const data = await executeApiCall(
    () => classroom.courses.courseWorkMaterials.list({ courseId, orderBy: "updateTime desc" }),
    `materials.list:${courseId}`
  );
  return data.courseWorkMaterial || [];
}
