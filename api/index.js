const axios = require("axios");

export default async function handler(request, response) {
  // 🔹 Messenger Webhook Verification (GET)
  if (request.method === "GET") {
    const verifyToken = process.env.MESSENGER_VERIFY_TOKEN;

    const mode = request.query["hub.mode"];
    const token = request.query["hub.verify_token"];
    const challenge = request.query["hub.challenge"];

    if (mode && token) {
      if (mode === "subscribe" && token === verifyToken) {
        console.log("✅ WEBHOOK_VERIFIED");
        return response.status(200).send(String(challenge)); // challenge must be plain text
      } else {
        return response.status(403).send("❌ Forbidden");
      }
    }
    return response.status(400).send("❌ Bad Request");
  }

  // 🔹 Messenger Events + Google Classroom API (POST)
  if (request.method === "POST") {
    try {
      // --- Messenger event logging ---
      const body = request.body;
      if (body.object === "page") {
        body.entry.forEach((entry) => {
          const webhookEvent = entry.messaging[0];
          console.log("📩 New Messenger event:", webhookEvent);

          if (webhookEvent.message) {
            console.log(`💬 Message received: ${webhookEvent.message.text}`);
          }
        });
      }

      // --- Google Classroom Access Token ---
      const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN } = process.env;

      const tokenResponse = await axios.post("https://oauth2.googleapis.com/token", {
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        refresh_token: GOOGLE_REFRESH_TOKEN,
        grant_type: "refresh_token",
      });

      const accessToken = tokenResponse.data.access_token;
      console.log("✅ Successfully received new Access Token!");

      // --- Fetch Classroom Courses ---
      const classroomResponse = await axios.get("https://classroom.googleapis.com/v1/courses", {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: { studentId: "me" },
      });

      const courses = classroomResponse.data.courses;

      if (courses && courses.length) {
        console.log("📚 Courses found:");
        courses.forEach((course) => {
          console.log(`- ${course.name} (ID: ${course.id})`);
        });
      } else {
        console.log("⚠️ No courses found.");
      }

      return response.status(200).send("✅ POST handled successfully.");
    } catch (error) {
      console.error("❌ Error:", error.response ? error.response.data : error.message);
      return response.status(500).send("❌ Error executing function.");
    }
  }

  // 🔹 If not GET or POST
  return response.status(405).send("❌ Method Not Allowed");
}
