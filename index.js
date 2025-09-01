const axios = require('axios');
// fs লাইব্রেরিটি আর প্রয়োজন নেই, তাই এটি মুছে ফেলা হয়েছে

// এই async ফাংশনটিই আমাদের মূল কাজ করবে
async function listCourses() {
  try {
    // ১. Vercel-এর 'সিক্রেট ভল্ট' (Environment Variables) থেকে আমাদের গোপন কী-গুলো পড়া হচ্ছে
    const client_id = process.env.GOOGLE_CLIENT_ID;
    const client_secret = process.env.GOOGLE_CLIENT_SECRET;
    const refresh_token = process.env.GOOGLE_REFRESH_TOKEN;

    // ২. Refresh Token ব্যবহার করে একটি নতুন Access Token আনার জন্য গুগলকে রিকোয়েস্ট পাঠানো হচ্ছে
    const tokenResponse = await axios.post('https://oauth2.googleapis.com/token', {
      client_id: client_id,
      client_secret: client_secret,
      refresh_token: refresh_token,
      grant_type: 'refresh_token',
    });
    
    const accessToken = tokenResponse.data.access_token;
    console.log('Successfully received new Access Token!');

    // ৩. নতুন পাওয়া Access Token ব্যবহার করে গুগল ক্লাসরুম API থেকে কোর্স লিস্ট চাওয়া হচ্ছে
    const classroomResponse = await axios.get('https://classroom.googleapis.com/v1/courses', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      params: {
        studentId: 'me',
      },
    });

    const courses = classroomResponse.data.courses;
    
    // ৪. সবশেষে, পাওয়া কোর্স লিস্টটি টার্মিনালে দেখানো হচ্ছে
    if (courses && courses.length) {
      console.log('Courses:');
      courses.forEach((course) => {
        console.log(`- ${course.name} (ID: ${course.id})`);
      });
    } else {
      console.log('No courses found.');
    }

  } catch (error) {
    console.error('Error fetching data:', error.response ? error.response.data : error.message);
  }
}

// আমাদের মূল ফাংশনটিকে চালানো হচ্ছে
listCourses();