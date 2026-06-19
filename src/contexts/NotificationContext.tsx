import { createContext, useContext } from 'react';
import { type ToastItem } from '../lib/toast';


// --- Notification Center (persistent history of toasts) ---
// Optional deep-link target so a notification can be clicked to jump to its
// subject (an incident in the Incidents tab, or an alert in Investigation).
interface NotificationLink { type: 'incident' | 'alert'; id: string; }
interface NotificationItem { id: string; message: string; type: ToastItem['type']; timestamp: number; read: boolean; link?: NotificationLink; }
interface NotificationContextValue {
  notifications: NotificationItem[];
  unreadCount: number;
  markAllRead: () => void;
  clearAll: () => void;
  remove: (id: string) => void;
  navigate: (link: NotificationLink) => void;
}
const NotificationContext = createContext<NotificationContextValue>({
  notifications: [], unreadCount: 0, markAllRead: () => {}, clearAll: () => {}, remove: () => {}, navigate: () => {},
});
const useNotifications = () => useContext(NotificationContext);


export { NotificationContext, useNotifications };
export type { NotificationItem, NotificationContextValue, NotificationLink };
