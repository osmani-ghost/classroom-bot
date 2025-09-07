import { google } from "googleapis";

/* Helper to execute Google API calls safely */
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
  console.log("[Classroom] fetchCourses()");
  const classroom = google.classroom({ version: "v1", auth: oauth2Client });
  const data = await executeApiCall(() => classroom.courses.list({ courseStates: ["ACTIVE"] }));
  const courses = data.courses || [];
  console.log(`[Classroom] fetchCourses -> ${courses.length} courses`);
  return courses;
}

export async function fetchAssignments(oauth2Client, courseId) {
  console.log(`[Classroom] fetchAssignments(courseId=${courseId})`);
  const classroom = google.classroom({ version: "v1", auth: oauth2Client });
  const data = await executeApiCall(() => classroom.courses.courseWork.list({ courseId }));
  const cw = data.courseWork || [];
  console.log(`[Classroom] fetchAssignments -> ${cw.length} items for course ${courseId}`);
  return cw;
}

export async function isTurnedIn(oauth2Client, courseId, assignmentId, studentId) {
  console.log(`[Classroom] isTurnedIn(course=${courseId}, assignment=${assignmentId}, studentId=${studentId})`);
  const classroom = google.classroom({ version: "v1", auth: oauth2Client });
  const data = await executeApiCall(() =>
    classroom.courses.courseWork.studentSubmissions.list({
      courseId,
      courseWorkId: assignmentId,
      userId: studentId,
    })
  );
  const submission = data.studentSubmissions?.[0];
  const turned = submission?.state === "TURNED_IN";
  console.log(`[Classroom] isTurnedIn => ${turned}`);
  return turned;
}

export async function fetchAnnouncements(oauth2Client, courseId) {
  console.log(`[Classroom] fetchAnnouncements(courseId=${courseId})`);
  const classroom = google.classroom({ version: "v1", auth: oauth2Client });
  const data = await executeApiCall(() =>
    classroom.courses.announcements.list({ courseId, orderBy: "updateTime desc" })
  );
  const items = data.announcements || [];
  console.log(`[Classroom] fetchAnnouncements -> ${items.length}`);
  return items;
}

export async function fetchMaterials(oauth2Client, courseId) {
  console.log(`[Classroom] fetchMaterials(courseId=${courseId})`);
  const classroom = google.classroom({ version: "v1", auth: oauth2Client });
  const data = await executeApiCall(() =>
    classroom.courses.courseWorkMaterials.list({ courseId, orderBy: "updateTime desc" })
  );
  const items = data.courseWorkMaterial || [];
  console.log(`[Classroom] fetchMaterials -> ${items.length}`);
  return items;
}

/* Keyword generation utility:
   - lowercases
   - strips punctuation
   - removes common English stop words
   - returns unique array
*/
const STOP_WORDS = new Set([
  "the","a","an","is","in","on","at","for","to","and","or","but","with","by","from","that","this","of","it","as","are","be","was","were","so","if","they","their","them"
]);

export function generateKeywordsFromText(text) {
  if (!text) return [];
  try {
    const normalized = text.toLowerCase().replace(/[^\w\s]/g, " ");
    const parts = normalized.split(/\s+/).filter(Boolean);
    const filtered = parts.filter((w) => !STOP_WORDS.has(w) && w.length > 1);
    const unique = Array.from(new Set(filtered));
    console.log(`[Classroom] generateKeywordsFromText -> ${unique.length} keywords`);
    return unique;
  } catch (err) {
    console.error("[Classroom] generateKeywordsFromText error:", err);
    return [];
  }
}
