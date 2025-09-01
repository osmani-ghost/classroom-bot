import axios from 'axios'; // শুধু এই লাইনটি পরিবর্তন করা হয়েছে

// আমাদের আগের listCourses ফাংশনটি এখন handler ফাংশনের ভেতরে থাকবে
export default async function handler(request, response) {
  try {
    // ১. Vercel-এর Environment Variables থেকে গোপন কী-গুলো পড়া হচ্ছে
    const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN } = process.env;

    // ২. Refresh Token ব্যবহার করে একটি নতুন Access Token আনা হচ্ছে
    const tokenResponse = await axios.post('https://oauth2.googleapis.com/token', {
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: GOOGLE_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    });
    
    const accessToken = tokenResponse.data.access_token;
    console.log('Successfully received new Access Token via Cron Job!');

    // ৩. নতুন Access Token দিয়ে কোর্স লিস্ট চাওয়া হচ্ছে
    const classroomResponse = await axios.get('https://classroom.googleapis.com/v1/courses', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      params: {
        studentId: 'me',
      },
    });

    const courses = classroomResponse.data.courses;
    
    // ৪. কোর্স লিস্ট টার্মিনালে (Vercel Logs) দেখানো হচ্ছে
    if (courses && courses.length) {
      console.log('Courses found:');
      courses.forEach((course) => {
        console.log(`- ${course.name} (ID: ${course.id})`);
      });
    } else {
      console.log('No courses found.');
    }
    
    // Vercel-কে জানানো হচ্ছে যে কাজটি সফল হয়েছে
    response.status(200).send('Function executed successfully.');

  } catch (error) {
    // যদি কোনো ভুল হয়, সেটি Vercel Logs-এ দেখানো হবে
    console.error('Error fetching data:', error.response ? error.response.data : error.message);
    response.status(500).send('Error executing function.');
  }
}