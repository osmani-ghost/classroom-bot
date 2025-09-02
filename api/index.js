import axios from 'axios';

export default async function handler(request, response) {
  // --- ফেসবুক ওয়েবুক ভেরিফিকেশন অংশ ---
  if (request.method === 'GET') {
    const verifyToken = process.env.MESSENGER_VERIFY_TOKEN;

    const mode = request.query['hub.mode'];
    const token = request.query['hub.verify_token'];
    const challenge = request.query['hub.challenge'];

    if (mode && token) {
      if (mode === 'subscribe' && token === verifyToken) {
        console.log('WEBHOOK_VERIFIED');
        response.status(200).send(challenge);
      } else {
        response.status(403).send('Forbidden');
      }
    }
    return; // GET রিকোয়েস্টের কাজ এখানেই শেষ
  }
  
  // --- আমাদের আগের গুগল ক্লাসরুম চেক করার কোড ---
  // (আপাতত, এটি আর চলবে না কারণ আমরা এটিকে শুধু GET রিকোয়েস্টের বাইরে রেখেছি)
  try {
    const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN } = process.env;

    const tokenResponse = await axios.post('https://oauth2.googleapis.com/token', {
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: GOOGLE_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    });
    
    const accessToken = tokenResponse.data.access_token;
    console.log('Successfully received new Access Token!');

    const classroomResponse = await axios.get('https://classroom.googleapis.com/v1/courses', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      params: {
        studentId: 'me',
      },
    });

    const courses = classroomResponse.data.courses;
    
    if (courses && courses.length) {
      console.log('Courses found:');
      courses.forEach((course) => {
        console.log(`- ${course.name} (ID: ${course.id})`);
      });
    } else {
      console.log('No courses found.');
    }
    
    response.status(200).send('Old function executed successfully.');

  } catch (error) {
    console.error('Error fetching data:', error.response ? error.response.data : error.message);
    response.status(500).send('Error executing old function.');
  }
}