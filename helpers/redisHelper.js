import fetch from "node-fetch";

const REDIS_URL = process.env.REDIS_REST_URL;
const REDIS_TOKEN = process.env.REDIS_REST_TOKEN;

async function redisCommand(command, ...args) {
    if (!REDIS_URL || !REDIS_TOKEN) {
        throw new Error("Redis URL or Token is missing.");
    }
    
    // SET কমান্ডের জন্য ভ্যালুটি body-তে পাঠানো হয়
    if (command.toLowerCase() === 'set') {
        const [key, value] = args;
        const response = await fetch(`${REDIS_URL}/set/${key}`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
            body: value,
        });
        if (!response.ok) throw new Error(`Redis SET command failed: ${await response.text()}`);
        return response.json();
    }

    // GET, KEYS ইত্যাদি কমান্ডের জন্য ভ্যালু URL-এ থাকে
    const response = await fetch(`${REDIS_URL}/${command}/${args.join("/")}`, {
        headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
    });
    if (!response.ok) return { result: null }; // GET বা KEYS ফেইল করলে null দেবে
    return response.json();
}

// ---- ইউজার এবং ম্যাপিং ফাংশন ----
export async function saveUser(googleId, userData) {
    await redisCommand("set", `user:google:${googleId}`, JSON.stringify(userData));
    await redisCommand("set", `user:psid:${userData.psid}`, JSON.stringify({ googleId }));
}

export async function getUser(googleId) {
    const result = await redisCommand("get", `user:google:${googleId}`);
    return result ? JSON.parse(result.result) : null;
}

export async function getAllUserGoogleIds() {
    const result = await redisCommand("keys", "user:google:*");
    // নিশ্চিত করা হচ্ছে যে এটি সবসময় একটি অ্যারে রিটার্ন করবে
    if (result && Array.isArray(result.result)) {
        return result.result.map(key => key.replace("user:google:", ""));
    }
    return []; // কোনো কিছু না পাওয়া গেলে খালি অ্যারে পাঠানো হচ্ছে
}

export async function isPsidRegistered(psid) {
    const result = await redisCommand('get', `user:psid:${psid}`);
    return !!(result && result.result);
}

// ---- রিমাইন্ডার ট্র্যাকিং ----
export async function reminderAlreadySent(assignmentId, googleId, hours) {
    const key = `reminder:${assignmentId}:${googleId}`;
    const result = await redisCommand("get", key);
    const recordString = result ? result.result : null;
    const record = recordString ? JSON.parse(recordString) : { remindersSent: [] };
    return record.remindersSent.includes(hours);
}
  
export async function markReminderSent(assignmentId, googleId, hours) {
    const key = `reminder:${assignmentId}:${googleId}`;
    const result = await redisCommand("get", key);
    const recordString = result ? result.result : null;
    let record = recordString ? JSON.parse(recordString) : { remindersSent: [] };
    if (!record.remindersSent.includes(hours)) {
        record.remindersSent.push(hours);
    }
    await redisCommand("set", key, JSON.stringify(record));
}

// ---- নতুন পোস্ট ট্র্যাকিং ----
export async function getLastCheckedTime(courseId) {
    const key = `lastpost:${courseId}`;
    const result = await redisCommand("get", key);
    return result ? result.result : null;
}

export async function setLastCheckedTime(courseId, time) {
    const key = `lastpost:${courseId}`;
    await redisCommand("set", key, time);
}