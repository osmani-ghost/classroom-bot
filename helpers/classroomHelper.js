import { google } from "googleapis";

// OAuth2 ক্লায়েন্ট মাত্র একবার তৈরি করা হচ্ছে
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

// রিফ্রেশ টোকেন সেট করা হচ্ছে
oauth2Client.setCredentials({
  refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
});

// ক্লাসরুম এপিআই অবজেক্ট তৈরি করা হচ্ছে
const classroom = google.classroom({ version: "v1", auth: oauth2Client });

// === এক্সপোর্ট করা ফাংশনগুলো ===

export async function fetchCourses() {
  const res = await classroom.courses.list();
  return res.data.courses || [];
}

export async function fetchAssignments(courseId) {
  const res = await classroom.courses.courseWork.list({ courseId });
  return res.data.courseWork || [];
}

export async function fetchStudents(courseId) {
  const res = await classroom.courses.students.list({ courseId });
  return res.data.students || [];
}

export async function isTurnedIn(courseId, assignmentId, studentId) {
  const res = await classroom.courses.courseWork.studentSubmissions.list({
    courseId,
    courseWorkId: assignmentId,
    userId: studentId,
  });
  const submission = res.data.studentSubmissions?.[0];
  return submission?.state === "TURNED_IN";
}

export async function fetchAnnouncements(courseId) {
  const res = await classroom.courses.announcements.list({
    courseId: courseId,
    orderBy: 'updateTime desc', // নতুন পোস্টগুলো আগে আসবে
  });
  return res.data.announcements || [];
}