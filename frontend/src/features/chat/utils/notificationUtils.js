/**
 * Thin re-export so chat code can import from here without change.
 * Single implementation lives at @/utils/notificationUtils.
 */
export {
  getNotificationCapability,
  requestNotificationPermission,
  canNotify,
  showDesktopNotification,
  showNotification,
  testDesktopNotification,
} from "@/utils/notificationUtils";
