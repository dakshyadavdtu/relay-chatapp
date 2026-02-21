/**
 * Admin users domain types.
 * Phase 8A: Stub types for adapter boundary.
 */

/** @typedef {{
 *   id: number;
 *   username: string;
 *   status: "online" | "offline";
 *   flagged: boolean;
 *   lastSeen: string;
 *   messages: number;
 *   failures: number;
 *   reconnects: number;
 *   violations: number;
 *   latency: string;
 *   role: string;
 *   email: string;
 * }} AdminUser */

/** @typedef {{
 *   device: string;
 *   ip: string;
 *   location: string;
 *   current: boolean;
 *   icon: import("lucide-react").LucideIcon;
 * }} AdminSession */
