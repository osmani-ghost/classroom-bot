// helpers/linkHelper.js

/**
 * DEBUG helper: log with a consistent prefix.
 */
function dbg(...args) {
  console.log("[LinkHelper][DEBUG]", ...args);
}

/**
 * Convert a numeric ID (string or number) to URL-safe Base64 without padding.
 * Examples:
 *   802890637640 -> ODAyODkwNjM3NjQw
 *   802335450552 -> ODAyMzM1NDUwNTUy
 */
export function toUrlSafeBase64Id(numId) {
  const raw = String(numId);
  const b64 = Buffer.from(raw, "utf8").toString("base64"); // standard base64
  const urlSafe = b64
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, ""); // url-safe, no padding
  dbg(`toUrlSafeBase64Id: raw="${raw}" -> urlSafe="${urlSafe}"`);
  return urlSafe;
}

/**
 * Build a Classroom web URL for course / items.
 * type:
 *  - 'course'          -> /c/<courseB64>
 *  - 'assignment'      -> /c/<courseB64>/a/<itemB64>/details
 *  - 'material'        -> /c/<courseB64>/m/<itemB64>/details
 *  - 'announcement'    -> /c/<courseB64>/p/<itemB64>
 */
export function buildClassroomLink({ courseId, itemId, type }) {
  if (!courseId) {
    dbg("buildClassroomLink: MISSING courseId!", { type, itemId });
    return "https://classroom.google.com";
  }

  const c = toUrlSafeBase64Id(courseId);

  if (!type || type === "course") {
    const url = `https://classroom.google.com/c/${c}`;
    dbg("buildClassroomLink(course)", url);
    return url;
  }

  if (!itemId) {
    const url = `https://classroom.google.com/c/${c}`;
    dbg("buildClassroomLink: no itemId provided, fallback to course url:", url);
    return url;
  }

  const i = toUrlSafeBase64Id(itemId);

  let url;
  switch (type) {
    case "assignment":
      url = `https://classroom.google.com/c/${c}/a/${i}/details`;
      break;
    case "material":
      url = `https://classroom.google.com/c/${c}/m/${i}/details`;
      break;
    case "announcement":
      // UI pattern for single post is /p/<id>, no /details page for stream posts
      url = `https://classroom.google.com/c/${c}/p/${i}`;
      break;
    default:
      url = `https://classroom.google.com/c/${c}`;
      dbg("buildClassroomLink: unknown type, fallback to course url:", {
        type,
        url,
      });
  }

  dbg("buildClassroomLink:", { type, url });
  return url;
}
