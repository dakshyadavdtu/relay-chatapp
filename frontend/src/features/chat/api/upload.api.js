/**
 * Upload API — image upload for group thumbnails etc.
 * POST /api/uploads/image (multipart form "file"), returns { url }.
 */
import { getApiOrigin } from "@/lib/http";

/**
 * Upload an image file. Uses multipart/form-data.
 * @param {File} file - Image file (e.g. from input[type=file])
 * @returns {Promise<{ url: string }>} - { url: "/uploads/..." }
 */
export async function uploadImage(file) {
  if (!file || !(file instanceof File)) {
    throw new Error("Invalid file");
  }
  const formData = new FormData();
  formData.append("file", file);

  const base = getApiOrigin();
  const res = await fetch(base ? `${base}/api/uploads/image` : "/api/uploads/image", {
    method: "POST",
    credentials: "include", // Session cookie required
    body: formData,
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json?.error || json?.message || "Upload failed";
    const err = new Error(msg);
    err.code = json?.code;
    err.status = res.status;
    throw err;
  }

  const url = json?.data?.url ?? json?.url;
  if (!url || typeof url !== "string") {
    throw new Error("Invalid response: missing url");
  }
  return { url };
}
