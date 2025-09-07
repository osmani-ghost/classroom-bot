import { redisClient } from "./redisHelper.js";

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

        const key = `index:item:${googleId}:assignment:${course.id}:${item.id}`;
        await redisClient.set(key, JSON.stringify(assignment));
        indexedItems.push(key);
      }
    }

    // Save all keys for the user
    await redisClient.set(
      `index:items:google:${googleId}`,
      JSON.stringify(indexedItems)
    );

    console.log(`[INDEX] Indexed ${indexedItems.length} items for Google ID ${googleId}`);
    return indexedItems;
  } catch (err) {
    console.error("[INDEX ERROR]", err);
  }
}
