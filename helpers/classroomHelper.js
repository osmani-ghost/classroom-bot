import { google } from "googleapis";

async function executeApiCall(apiCall) {
  try {
    const response = await apiCall();
    return response.data || {};
  } catch (error) {
    console.error("❌ Google API Error:", error?.response?.data?.error || error?.message || error);
    return {}; // error-resilient
  }
}

export async function fetchCourses(oauth2Client) {
  const classroom = google.classroom({ version: "v1", auth: oauth2Client });
  const data = await executeApiCall(() => classroom.courses.list({ courseStates: ["ACTIVE"], pageSize: 200 }));
  return data.courses || [];
}

export async function fetchAssignments(oauth2Client, courseId) {
  const classroom = google.classroom({ version: "v1", auth: oauth2Client });
  const data = await executeApiCall(() => classroom.courses.courseWork.list({ courseId, pageSize: 200 }));
  return data.courseWork || [];
}

export async function isTurnedIn(oauth2Client, courseId, assignmentId, studentId) {
  const classroom = google.classroom({ version: "v1", auth: oauth2Client });
  try {
    const data = await executeApiCall(() => classroom.courses.courseWork.studentSubmissions.list({
      courseId,
      courseWorkId: assignmentId,
      userId: studentId,
      pageSize: 10,
    }));
    const submission = data.studentSubmissions?.[0];
    return submission?.state === "TURNED_IN";
  } catch (err) {
    console.error("[ClassroomHelper] isTurnedIn error:", err);
    return false;
  }
}

export async function fetchAnnouncements(oauth2Client, courseId) {
  const classroom = google.classroom({ version: "v1", auth: oauth2Client });
  const data = await executeApiCall(() => classroom.courses.announcements.list({ courseId, orderBy: 'updateTime desc', pageSize: 200 }));
  return data.announcements || [];
}

export async function fetchMaterials(oauth2Client, courseId) {
  const classroom = google.classroom({ version: "v1", auth: oauth2Client });
  const data = await executeApiCall(() => classroom.courses.courseWorkMaterials.list({ courseId, orderBy: 'updateTime desc', pageSize: 200 }));
  return data.courseWorkMaterial || [];
}
