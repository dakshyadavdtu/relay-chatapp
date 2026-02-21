/**
 * True if the string is a data URL (e.g. from FileReader.readAsDataURL).
 * @param {string | null | undefined} url
 * @returns {boolean}
 */
export function isDataUrl(url) {
  return typeof url === "string" && url.trim().toLowerCase().startsWith("data:");
}

/**
 * Resolve relative URLs (e.g. /uploads/...) to the correct origin.
 * Used by resolveThumbnailUrl and avatarSrc so /uploads/... work when frontend and backend differ.
 * @param {string} url - Non-empty trimmed URL (relative or absolute)
 * @returns {string} Absolute URL or url as-is
 */
function resolveAssetUrl(url) {
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  if (url.startsWith("/")) {
    const base = import.meta.env?.VITE_API_BASE_URL ?? import.meta.env?.VITE_API_URL ?? "";
    const origin = typeof base === "string" && base ? base.replace(/\/$/, "") : (typeof window !== "undefined" ? window.location.origin : "");
    if (origin) return `${origin}${url}`;
  }
  return url;
}

/**
 * Resolve group/room thumbnail URL for img src.
 * Relative paths (e.g. /uploads/...) are resolved to the API origin when VITE_API_BASE_URL
 * or VITE_API_URL is set (e.g. frontend and backend on different hosts). Otherwise returns as-is.
 * @param {string | null | undefined} url - Thumbnail URL from backend (relative or absolute)
 * @returns {string | null} URL safe for use in img src, or null
 */
export function resolveThumbnailUrl(url) {
  if (!url || typeof url !== "string" || !url.trim()) return null;
  const trimmed = url.trim();
  if (isDataUrl(trimmed)) return trimmed;
  return resolveAssetUrl(trimmed);
}

/**
 * Resolve avatar image URL with correct origin + cache-busting so browser shows updated image when same URL changes.
 * Relative paths (e.g. /uploads/...) are resolved to the API origin like resolveThumbnailUrl.
 * Do not use for data URLs (pass them through as-is).
 * @param {string | null | undefined} url - Avatar URL (absolute, relative, or data URL)
 * @param {number | string | null | undefined} updatedAt - Timestamp or version (e.g. from USER_UPDATED)
 * @returns {string | null} URL resolved for origin, with ?v= or &v= when updatedAt present, or null
 */
export function avatarSrc(url, updatedAt) {
  if (!url || typeof url !== "string" || !url.trim()) return null;
  const trimmed = url.trim();
  if (isDataUrl(trimmed)) return trimmed;
  const resolved = resolveAssetUrl(trimmed);
  if (!updatedAt && updatedAt !== 0) return resolved;
  const sep = resolved.includes("?") ? "&" : "?";
  return `${resolved}${sep}v=${String(updatedAt)}`;
}
