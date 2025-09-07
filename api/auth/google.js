import { google } from "googleapis";

export default function handler(req, res) {
  try {
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
    const { psid } = req.query;
    if (!psid) return res.status(400).send("PSID is missing.");

    // --- এখানে ছাত্র এবং শিক্ষক উভয়ের জন্য সব প্রয়োজনীয় অনুমতি যোগ করা হয়েছে ---
    const scopes = [
      'https://www.googleapis.com/auth/userinfo.profile', // প্রোফাইল তথ্য দেখার জন্য
      'https://www.googleapis.com/auth/classroom.courses.readonly', // কোর্সের তালিকা দেখার জন্য
      'https://www.googleapis.com/auth/classroom.rosters.readonly', // ছাত্রছাত্রীর তালিকা দেখার জন্য (শিক্ষকের জন্য)
      'https://www.googleapis.com/auth/classroom.announcements.readonly', // ঘোষণা দেখার জন্য
      'https://www.googleapis.com/auth/classroom.courseworkmaterials.readonly', // ম্যাটেরিয়াল দেখার জন্য
      // --- এই দুটি অনুমতি সবচেয়ে জরুরি ---
      'https://www.googleapis.com/auth/classroom.coursework.students.readonly', // শিক্ষকের ছাত্রছাত্রীর কাজ দেখার অনুমতি
      'https://www.googleapis.com/auth/classroom.coursework.me.readonly', // ছাত্রের নিজের কাজ দেখার অনুমতি
    ];

    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      state: psid,
      prompt: 'consent',
    });

    res.redirect(authUrl);
  } catch (error) {
    console.error("❌ Error generating auth URL:", error);
    res.status(500).send("Error generating auth URL.");
  }
}