import { createContext, useContext } from 'react';
import { type ToastItem } from '../lib/toast';


// --- Notification Center (persistent history of toasts) ---
interface NotificationItem { id: string; message: string; type: ToastItem['type']; timestamp: number; read: boolean; }
interface NotificationContextValue {
  notifications: NotificationItem[];
  unreadCount: number;
  markAllRead: () => void;
  clearAll: () => void;
  remove: (id: string) => void;
}
const NotificationContext = createContext<NotificationContextValue>({
  notifications: [], unreadCount: 0, markAllRead: () => {}, clearAll: () => {}, remove: () => {},
});
const useNotifications = () => useContext(NotificationContext);


export { NotificationContext, useNotifications };
export type { NotificationItem, NotificationContextValue };
