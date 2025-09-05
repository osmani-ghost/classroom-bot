import "dotenv/config";

import { google } from "googleapis";

async function testClassroom() {
  const oAuth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );

  // শুধু refresh token দিচ্ছি
  oAuth2Client.setCredentials({
    refresh_token: process.env.REFRESH_TOKEN,
  });

  try {
    // refresh token দিয়ে নতুন access token তৈরি করবে
    const newToken = await oAuth2Client.getAccessToken();
    console.log("✅ New Access Token:", newToken.token);

    // এখন classroom API কল করা যাবে
    const classroom = google.classroom({ version: "v1", auth: oAuth2Client });
    const res = await classroom.courses.list();

    console.log("📚 Courses:", res.data.courses);
  } catch (err) {
    console.error("❌ Error:", err.response?.data || err.message);
  }
}

testClassroom();
