/**
 * Admin feature entry.
 * Phase 8A: Dashboard + Users at /admin, /admin/users.
 * No default export — admin routes use pages/admin/* and AdminLayout via direct paths.
 */
export { AdminLayout } from "./ui/AdminLayout";
export { useAdminDashboard, useAdminUsers } from "./adapters";
export { default as AdminPlaceholder } from "./AdminPlaceholder";
