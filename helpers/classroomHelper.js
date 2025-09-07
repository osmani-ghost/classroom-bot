import { redisCommand } from "./redisHelper.js";

// -------------------- Keyword Helper -------------------
function generateKeywords(title = "", desc = "") {
  const text = `${title} ${desc}`.toLowerCase();
  const words = text.replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
  const stop = new Set(["the","and","or","of","in","on","a","an","to","for","with","by","from","this","that","is","are","be"]);
  const kws = [];
  for (const w of words) if(w.length>2 && !stop.has(w) && !kws.includes(w)) kws.push(w);
  const autos = ["lab","report","midterm","final","project","homework","hw","assignment","quiz"];
  for(const a of autos) if(text.includes(a) && !kws.includes(a)) kws.push(a);
  return kws.slice(0, 30);
}

// -------------------- Index Assignments -------------------
export async function indexAssignments(googleId, courses) {
  try {
    const indexedItems = [];

    for (const course of courses) {
      if (!course.assignments) continue;

      for (const item of course.assignments) {
        const assignment = {
          id: item.id,
          type: "assignment",
          courseId: course.id,
          courseName: course.name,
          title: item.title || item.text || "Untitled",
          description: item.description || item.text || "",
          createdTime: item.creationTime,
          dueDate: item.dueDate,
          dueTime: item.dueTime || { hours: 0, minutes: 0 },
          link: item.link || null,
          keywords: generateKeywords(item.title, item.description),
          raw: item,
        };

        const key = `index:item:${googleId}:assignment:${course.id}:${item.id}`;
        await redisCommand("set", key, JSON.stringify(assignment));
        indexedItems.push(key);
      }
    }

    // Merge with existing keys
    const listKey = `index:items:google:${googleId}`;
    const existingKeys = await redisCommand("get", listKey);
    let allKeys = existingKeys?.result ? JSON.parse(existingKeys.result) : [];
    allKeys = [...allKeys, ...indexedItems];
    await redisCommand("set", listKey, JSON.stringify(allKeys));

    console.log(`[INDEX] Indexed ${indexedItems.length} assignments for Google ID ${googleId}`);
    return indexedItems;
  } catch (err) {
    console.error("[INDEX ERROR][ASSIGNMENTS]", err);
    return [];
  }
}

// -------------------- Index Announcements -------------------
export async function indexAnnouncements(googleId, courses) {
  try {
    const indexedItems = [];

    for (const course of courses) {
      if (!course.announcements) continue;

      for (const item of course.announcements) {
        const announcement = {
          id: item.id,
          type: "announcement",
          courseId: course.id,
          courseName: course.name,
          title: item.title || item.text || "Untitled Announcement",
          description: item.text || "",
          createdTime: item.creationTime || new Date().toISOString(),
          link: item.alternateLink || null,
          keywords: generateKeywords(item.title, item.text),
          raw: item,
        };

        const key = `index:item:${googleId}:announcement:${course.id}:${item.id}`;
        await redisCommand("set", key, JSON.stringify(announcement));
        indexedItems.push(key);
      }
    }

    // Merge with existing keys
    const listKey = `index:items:google:${googleId}`;
    const existingKeys = await redisCommand("get", listKey);
    let allKeys = existingKeys?.result ? JSON.parse(existingKeys.result) : [];
    allKeys = [...allKeys, ...indexedItems];
    await redisCommand("set", listKey, JSON.stringify(allKeys));

    console.log(`[INDEX] Indexed ${indexedItems.length} announcements for Google ID ${googleId}`);
    return indexedItems;
  } catch (err) {
    console.error("[INDEX ERROR][ANNOUNCEMENTS]", err);
    return [];
  }
}

// -------------------- Index Materials -------------------
export async function indexMaterials(googleId, courses) {
  try {
    const indexedItems = [];

    for (const course of courses) {
      if (!course.materials) continue;

      for (const item of course.materials) {
        const material = {
          id: item.id,
          type: "material",
          courseId: course.id,
          courseName: course.name,
          title: item.title || "Untitled Material",
          description: item.description || "",
          createdTime: item.updateTime || item.creationTime || new Date().toISOString(),
          link: item.alternateLink || null,
          keywords: generateKeywords(item.title, item.description),
          raw: item,
        };

        const key = `index:item:${googleId}:material:${course.id}:${item.id}`;
        await redisCommand("set", key, JSON.stringify(material));
        indexedItems.push(key);
      }
    }

    // Merge with existing keys
    const listKey = `index:items:google:${googleId}`;
    const existingKeys = await redisCommand("get", listKey);
    let allKeys = existingKeys?.result ? JSON.parse(existingKeys.result) : [];
    allKeys = [...allKeys, ...indexedItems];
    await redisCommand("set", listKey, JSON.stringify(allKeys));

    console.log(`[INDEX] Indexed ${indexedItems.length} materials for Google ID ${googleId}`);
    return indexedItems;
  } catch (err) {
    console.error("[INDEX ERROR][MATERIALS]", err);
    return [];
  }
}
