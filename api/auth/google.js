import { google } from "googleapis";

export default function handler(req, res) {
  try {
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );

    const { psid } = req.query;
    if (!psid) {
      console.warn("[Google Auth] PSID missing in query params.");
      return res.status(400).send("PSID is required.");
    }

    // --- ছাত্র এবং শিক্ষক উভয়ের জন্য অনুমতি স্কোপ ---
    const scopes = [
      'https://www.googleapis.com/auth/userinfo.profile', // প্রোফাইল তথ্য দেখার জন্য
      'https://www.googleapis.com/auth/classroom.courses.readonly', // কোর্স তালিকা
      'https://www.googleapis.com/auth/classroom.rosters.readonly', // ছাত্রছাত্রী তালিকা (শিক্ষক)
      'https://www.googleapis.com/auth/classroom.announcements.readonly', // ঘোষণা
      'https://www.googleapis.com/auth/classroom.courseworkmaterials.readonly', // ম্যাটেরিয়াল
      'https://www.googleapis.com/auth/classroom.coursework.students.readonly', // শিক্ষকের ছাত্রছাত্রীর কাজ
      'https://www.googleapis.com/auth/classroom.coursework.me.readonly', // ছাত্রের নিজের কাজ
    ];

    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline', // refresh token পাওয়ার জন্য
      scope: scopes,
      state: psid, // messenger PSID
      prompt: 'consent', // user কে consent দিতে বাধ্য করবে
    });

    console.log(`[Google Auth] Redirecting PSID=${psid} to Google Auth URL`);
    res.redirect(authUrl);

  } catch (error) {
    console.error("❌ Error generating Google Auth URL:", error);
    res.status(500).send("Error generating Google Auth URL.");
  }
}
