export default async function handler(req, res) {
  try {
    // Google OAuth credentials (Environment Variables থেকে নিবে)
    const {
      GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET,
      GOOGLE_REFRESH_TOKEN,
    } = process.env;

    // 1. Access Token নেয়া
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        refresh_token: GOOGLE_REFRESH_TOKEN,
        grant_type: "refresh_token",
      }),
    });

    if (!tokenResponse.ok) {
      throw new Error("Failed to fetch access token");
    }

    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;

    // 2. Google Classroom API থেকে course list আনা
    const classroomResponse = await fetch(
      "https://classroom.googleapis.com/v1/courses",
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (!classroomResponse.ok) {
      throw new Error("Failed to fetch courses from Google Classroom");
    }

    const courses = await classroomResponse.json();

    // Response পাঠানো
    res.status(200).json(courses);
  } catch (error) {
    console.error("Error in API:", error.message);
    res.status(500).json({ error: error.message });
  }
}
