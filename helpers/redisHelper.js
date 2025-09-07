import fetch from "node-fetch";

const REDIS_URL = process.env.REDIS_REST_URL;
const REDIS_TOKEN = process.env.REDIS_REST_TOKEN;

async function redisCommand(command, ...args) {
    if (!REDIS_URL || !REDIS_TOKEN) {
        throw new Error("Redis URL or Token is missing.");
    }

    console.log(`[Redis Debug] Command: ${command}, Args: ${args}`);

    if (command.toLowerCase() === 'set') {
        const [key, value] = args;
        const response = await fetch(`${REDIS_URL}/set/${key}`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
            body: value,
        });
        if (!response.ok) throw new Error(`Redis SET command failed: ${await response.text()}`);
        console.log(`[Redis Debug] SET ${key} -> ${value}`);
        return response.json();
    }

    const response = await fetch(`${REDIS_URL}/${command}/${args.join("/")}`, {
        headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
    });

    if (!response.ok) return { result: null };
    const resJson = await response.json();
    console.log(`[Redis Debug] ${command} ${args} -> ${JSON.stringify(resJson)}`);
    return resJson;
}

// --- User Mapping ---
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
    if (result && Array.isArray(result.result)) {
        return result.result.map(key => key.replace("user:google:", ""));
    }
    return [];
}

export async function isPsidRegistered(psid) {
    const result = await redisCommand('get', `user:psid:${psid}`);
    return !!(result && result.result);
}

// --- Reminder Tracking ---
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

// --- Last Checked Tracking ---
export async function getLastCheckedTime(courseId) {
    const key = `lastpost:${courseId}`;
    const result = await redisCommand("get", key);
    return result ? result.result : null;
}

export async function setLastCheckedTime(courseId, time) {
    const key = `lastpost:${courseId}`;
    await redisCommand("set", key, time);
}

// --- Search & Filter Feature ---
export async function saveContent(courseId, contentId, data) {
    const key = `content:${courseId}:${contentId}`;
    await redisCommand("set", key, JSON.stringify(data));
}

export async function getAllContentForUser(googleId) {
    const keysRes = await redisCommand("keys", "content:*");
    const keys = keysRes?.result || [];
    const allData = [];
    for (const key of keys) {
        const contentRes = await redisCommand("get", key);
        if (contentRes?.result) {
            const content = JSON.parse(contentRes.result);
            if (content.googleId === googleId) allData.push(content);
        }
    }
    return allData;
}
