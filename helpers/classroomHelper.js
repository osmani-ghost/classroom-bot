// classroomHelper.js
import { saveIndexedItem } from "./redisHelper.js"; // Correct import from redisHelper.js

// =========================
// Index assignments for a user
// =========================
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
          link: item.link,
          keywords: (item.title || item.text || "").toLowerCase().split(" "),
          raw: item,
        };

        // Save indexed item using Redis helper
        await saveIndexedItem(googleId, assignment);
        indexedItems.push({
          courseId: course.id,
          assignmentId: item.id,
        });
      }
    }

    console.log(`[INDEX] Indexed ${indexedItems.length} items for Google ID ${googleId}`);
    return indexedItems;
  } catch (err) {
    console.error("[INDEX ERROR]", err);
    throw err;
  }
}

// =========================
// Fetch assignments from Google Classroom
// (Stub: replace with actual API call if needed)
// =========================
export async function fetchAssignments(oauth2Client, courseId) {
  // Example: fetch assignments from Google Classroom API
  // Return array of assignment objects
  return [];
}

// =========================
// Fetch announcements from Google Classroom
// =========================
export async function fetchAnnouncements(oauth2Client, courseId) {
  return [];
}

// =========================
// Fetch materials from Google Classroom
// =========================
export async function fetchMaterials(oauth2Client, courseId) {
  return [];
}

// =========================
// Check if assignment is turned in
// =========================
export async function isTurnedIn(oauth2Client, courseId, assignmentId, userId) {
  return false; // Default: not turned in
}

// =========================
// Fetch courses for a user
// =========================
export async function fetchCourses(oauth2Client) {
  return []; // Default: empty list
}
