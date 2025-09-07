import { google } from "googleapis";

async function executeApiCall(apiCall) {
    try {
        const response = await apiCall();
        return response.data || {};
    } catch (error) {
        console.error("❌ Google API Error:", error.response?.data?.error || error.message);
        return {};
    }
}

export async function fetchCourses(oauth2Client) {
    const classroom = google.classroom({ version: "v1", auth: oauth2Client });
    const data = await executeApiCall(() => classroom.courses.list({ courseStates: ["ACTIVE"] }));
    return data.courses || [];
}

export async function fetchAssignments(oauth2Client, courseId) {
    const classroom = google.classroom({ version: "v1", auth: oauth2Client });
    const data = await executeApiCall(() => classroom.courses.courseWork.list({ courseId }));
    return data.courseWork || [];
}

export async function isTurnedIn(oauth2Client, courseId, assignmentId, studentId) {
    const classroom = google.classroom({ version: "v1", auth: oauth2Client });
    const data = await executeApiCall(() => classroom.courses.courseWork.studentSubmissions.list({
        courseId, courseWorkId: assignmentId, userId: studentId,
    }));
    const submission = data.studentSubmissions?.[0];
    return submission?.state === "TURNED_IN";
}

export async function fetchAnnouncements(oauth2Client, courseId) {
    const classroom = google.classroom({ version: "v1", auth: oauth2Client });
    const data = await executeApiCall(() => classroom.courses.announcements.list({ courseId, orderBy: 'updateTime desc' }));
    return data.announcements || [];
}

export async function fetchMaterials(oauth2Client, courseId) {
    const classroom = google.classroom({ version: "v1", auth: oauth2Client });
    const data = await executeApiCall(() => classroom.courses.courseWorkMaterials.list({ courseId, orderBy: 'updateTime desc' }));
    return data.courseWorkMaterial || [];
}