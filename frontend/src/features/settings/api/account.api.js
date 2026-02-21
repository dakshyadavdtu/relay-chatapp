/**
 * Account API - self-service account actions (e.g. delete account).
 * Uses lib/http apiFetch. Base path: /api (Vite proxy forwards /api to backend).
 *
 * Path alignment: backend mounts user routes at httpRouter.use('/users', userRoutes)
 * with app.use('/api', httpRouter), so DELETE is at /api/users/me. This file uses
 * "/api/users/me" — correct.
 *
 * Dev curl test (backend): login to get cookie, then:
 *   curl -X DELETE <base>/api/users/me -H "Content-Type: application/json" \
 *     -d '{"confirm":"DELETE"}' --cookie "<cookie>"
 *   Expect: 200 { "success": true, "data": { "deleted": true } }
 */

import { apiFetch } from "@/lib/http";

/**
 * DELETE /api/users/me - Soft-delete current user account.
 * Backend requires body: { confirm: "DELETE" }; revokes sessions and clears cookies.
 * @param {{ confirm: string }} payload - Must include confirm: "DELETE"
 * @returns {Promise<{ success: boolean, data?: { deleted: boolean } }>}
 */
export async function deleteMyAccount(payload) {
  return apiFetch("/api/users/me", {
    method: "DELETE",
    body: payload ?? { confirm: "DELETE" },
  });
}
