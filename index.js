// axios লাইব্রেরিটি ইমপোর্ট করা হচ্ছে, যা আমাদের API কলের কাজে লাগবে
const axios = require('axios');
// fs (File System) লাইব্রেরিটি ইমপোর্ট করা হচ্ছে, যা ফাইল পড়তে সাহায্য করবে
const fs = require('fs').promises;

// এই async ফাংশনটিই আমাদের মূল কাজ করবে
async function listCourses() {
  try {
    // ১. credentials.json ফাইল থেকে আমাদের গোপন কী-গুলো পড়া হচ্ছে
    const credentials = JSON.parse(await fs.readFile('credentials.json'));
    const { client_secret, client_id, refresh_token } = credentials.web;

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
        Authorization: `Bearer ${accessToken}`, // Access Token-টি এখানে ব্যবহার করা হচ্ছে
      },
      // **** এই নতুন অংশটি যোগ করা হয়েছে ****
      params: {
        studentId: 'me', // আমরা বলে দিচ্ছি যে আমি ছাত্র হিসেবে থাকা কোর্সগুলো চাই
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
    // যদি কোনো ভুল হয়, তাহলে সেটি এখানে দেখানো হবে
    console.error('Error fetching data:', error.response ? error.response.data : error.message);
  }
}

// আমাদের মূল ফাংশনটিকে চালানো হচ্ছে
listCourses();