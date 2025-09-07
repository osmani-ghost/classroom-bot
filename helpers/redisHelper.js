import fetch from "node-fetch";

const REDIS_URL = process.env.REDIS_REST_URL;
const REDIS_TOKEN = process.env.REDIS_REST_TOKEN;

async function redisCommand(command, ...args) {
    if (!REDIS_URL || !REDIS_TOKEN) throw new Error("Redis URL or Token is missing.");
    
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

    const response = await fetch(`${REDIS_URL}/${command}/${args.join("/")}`, {
        headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
    });
    if (!response.ok) return { result: null };
    return response.json();
}

// ---- ইউজার এবং ম্যাপিং ফাংশন ----
export async function saveUser(googleId, userData) {
    await redisCommand("set", `user:google:${googleId}`, JSON.stringify(userData));
    await redisCommand("set", `user:psid:${userData.psid}`, JSON.stringify({ googleId }));
    console.log(`[DB] User data saved: Google ID ${googleId} <-> PSID ${userData.psid}`);
}

export async function getUser(googleId) {
    const result = await redisCommand("get", `user:google:${googleId}`);
    return result ? JSON.parse(result.result) : null;
}

export async function getUserFromPsid(psid) {
    const result = await redisCommand("get", `user:psid:${psid}`);
    if (!result || !result.result) return null;
    const { googleId } = JSON.parse(result.result);
    return getUser(googleId);
}

export async function getAllUserGoogleIds() {
    const result = await redisCommand("keys", "user:google:*");
    if (result && Array.isArray(result.result)) {
        return result.result.map(key => key.replace("user:google:", ""));
    }
    return [];
}

export async function isPsidRegistered(psid) {
    const result = await redisCommand('get', `user:psid:${psid}`);
    return !!(result && result.result);
}

// ---- রিমাইন্ডার এবং পোস্ট ট্র্যাকিং ----
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
    let record = result ? JSON.parse(result.result) : { remindersSent: [] };
    if (!record.remindersSent.includes(hours)) {
        record.remindersSent.push(hours);
    }
    await redisCommand("set", key, JSON.stringify(record));
}

export async function getLastCheckedTime(googleId, courseId) {
    const key = `lastpost:${googleId}:${courseId}`;
    const result = await redisCommand("get", key);
    return result ? result.result : null;
}

export async function setLastCheckedTime(googleId, courseId, time) {
    const key = `lastpost:${googleId}:${courseId}`;
    await redisCommand("set", key, time);
}

// ---- সার্চ ফিচার ----
export async function saveContent(googleId, content) {
    const key = `content:${googleId}:${content.id}`;
    const contentToSave = {
        id: content.id,
        courseId: content.courseId,
        title: content.title || "Announcement",
        description: content.text || content.description || "",
        type: content.workType || (content.text ? "ANNOUNCEMENT" : "MATERIAL"),
        link: content.alternateLink,
    };
    await redisCommand("set", key, JSON.stringify(contentToSave));
}

export async function searchContentForUser(googleId, searchTerm) {
    const result = await redisCommand("keys", `content:${googleId}:*`);
    if (!result || !Array.isArray(result.result) || result.result.length === 0) return [];
    
    const contentKeys = result.result;
    if (contentKeys.length === 0) return [];

    const contentResult = await redisCommand("mget", ...contentKeys);
    if (!contentResult || !Array.isArray(contentResult.result)) return [];

    const allContent = contentResult.result.map(item => item ? JSON.parse(item) : null).filter(Boolean);
    return allContent.filter(item => 
        (item.title?.toLowerCase().includes(searchTerm)) || 
        (item.description?.toLowerCase().includes(searchTerm))
    );
}