import fetch from "node-fetch";

const REDIS_URL = process.env.REDIS_REST_URL;
const REDIS_TOKEN = process.env.REDIS_REST_TOKEN;

// এই ফাংশনটি Redis ডাটাবেস থেকে ডাটা আনে এবং পাঠায়
async function redisCommand(command, ...args) {
  if (!REDIS_URL || !REDIS_TOKEN) {
    console.error("❌ Redis URL or Token is missing in environment variables.");
    return null;
  }
  
  const response = await fetch(`${REDIS_URL}/${command}/${args.join('/')}`, {
    headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
  });

  if (!response.ok) {
      console.error("❌ Redis command failed:", await response.text());
      return null;
  }
  return response.json();
}

// ---- ম্যাপিং ফাংশন ----
export async function getPsidForGoogleId(googleId) {
  const key = `mapping:google:${googleId}`;
  const result = await redisCommand('get', key);
  return result ? JSON.parse(result.result) : null;
}

export async function mapGoogleIdToPsid(googleId, psid) {
  const key = `mapping:google:${googleId}`;
  await redisCommand('set', key, JSON.stringify({ psid }));
  console.log(`✅ Mapping saved: Google ID ${googleId} -> PSID ${psid}`);
}

// ---- রিমাইন্ডার ট্র্যাকিং ফাংশন (এখানে বাগ ফিক্স করা হয়েছে) ----
export async function reminderAlreadySent(assignmentId, googleId, hours) {
  const key = `reminder:${assignmentId}:${googleId}`;
  const result = await redisCommand('get', key);

  // যদি ডাটাবেসে কিছু না পাওয়া যায়, তাহলে `result.result` হবে null
  const recordString = result ? result.result : null; 
  
  // `recordString` যদি খালি (null) হয়, তাহলে আমরা ধরে নেব কোনো রিমাইন্ডার পাঠানো হয়নি
  const record = recordString ? JSON.parse(recordString) : { remindersSent: [] };
  
  return record.remindersSent.includes(hours);
}

export async function markReminderSent(assignmentId, googleId, hours) {
  const key = `reminder:${assignmentId}:${googleId}`;
  const result = await redisCommand('get', key);
  
  const recordString = result ? result.result : null;
  let record = recordString ? JSON.parse(recordString) : { remindersSent: [] };

  if (!record.remindersSent.includes(hours)) {
    record.remindersSent.push(hours);
  }
  
  await redisCommand('set', key, JSON.stringify(record));
}