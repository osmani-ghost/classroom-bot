import { google } from "googleapis";

// ==========================
// Generic API executor
// ==========================
async function executeApiCall(apiCall) {
  try {
    const response = await apiCall();
    return response.data || {};
  } catch (error) {
    console.error(
      "❌ Google API Error:",
      error.response?.data?.error || error.message
    );
    return {}; // error হলেও অ্যাপ ক্র্যাশ হবে না
  }
}

// ==========================
// Fetch active courses
// ==========================
export async function fetchCourses(oauth2Client) {
  const classroom = google.classroom({ version: "v1", auth: oauth2Client });
  const data = await executeApiCall(() =>
    classroom.courses.list({ courseStates: ["ACTIVE"] })
  );
  return data.courses || [];
}

// ==========================
// Fetch assignments (courseWork)
// ==========================
export async function fetchAssignments(oauth2Client, courseId) {
  const classroom = google.classroom({ version: "v1", auth: oauth2Client });
  const data = await executeApiCall(() =>
    classroom.courses.courseWork.list({ courseId })
  );
  return data.courseWork || [];
}

// ==========================
// Check if assignment turned in
// ==========================
export async function isTurnedIn(oauth2Client, courseId, assignmentId, studentId) {
  const classroom = google.classroom({ version: "v1", auth: oauth2Client });
  const data = await executeApiCall(() =>
    classroom.courses.courseWork.studentSubmissions.list({
      courseId,
      courseWorkId: assignmentId,
      userId: studentId,
    })
  );
  const submission = data.studentSubmissions?.[0];
  return submission?.state === "TURNED_IN";
}

// ==========================
// Fetch announcements
// ==========================
export async function fetchAnnouncements(oauth2Client, courseId) {
  const classroom = google.classroom({ version: "v1", auth: oauth2Client });
  const data = await executeApiCall(() =>
    classroom.courses.announcements.list({
      courseId,
      orderBy: "updateTime desc",
    })
  );
  return data.announcements || [];
}

// ==========================
// Fetch materials
// ==========================
export async function fetchMaterials(oauth2Client, courseId) {
  const classroom = google.classroom({ version: "v1", auth: oauth2Client });
  const data = await executeApiCall(() =>
    classroom.courses.courseWorkMaterials.list({
      courseId,
      orderBy: "updateTime desc",
    })
  );
  return data.courseWorkMaterial || [];
}
