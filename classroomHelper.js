import { google } from "googleapis";

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

oauth2Client.setCredentials({
  refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
});

const classroom = google.classroom({ version: "v1", auth: oauth2Client });

export async function fetchCourses() {
  const res = await classroom.courses.list();
  return res.data.courses || [];
}

export async function fetchAssignments(courseId) {
  const res = await classroom.courses.courseWork.list({ courseId });
  return res.data.courseWork || [];
}
