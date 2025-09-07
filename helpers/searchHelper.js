import { redisCommand } from "./redisHelper.js";

export async function searchContent(query) {
  console.log(`[Search] Query received: "${query}"`);
  const patterns = ["assignment:*", "announcement:*", "material:*"];
  let results = [];

  for (const pattern of patterns) {
    const keys = await redisCommand("keys", pattern);
    for (const key of keys.result || []) {
      const itemData = await redisCommand("get", key);
      if (!itemData?.result) continue;
      const item = JSON.parse(itemData.result);

      const haystack = `${item.courseName} ${item.title || ""}`.toLowerCase();
      if (haystack.includes(query.toLowerCase())) {
        results.push(item);
      }
    }
  }

  console.log(`[Search] Found ${results.length} matches.`);
  return results.slice(0, 5); // top 5 results
}
