import { apiClient } from "./api-client";

export interface NotificationItem {
  id: string;
  user_id?: string | null;
  company_id?: string | null;
  title: string;
  message: string;
  type: string;
  read: boolean;
  snoozed_until?: string | null;
  created_at: string;
}

export const notificationsService = {
  async getNotifications(): Promise<NotificationItem[]> {
    return apiClient.get<NotificationItem[]>("/notifications");
  },

  async markAsRead(idOrIds?: string | string[]): Promise<void> {
    if (Array.isArray(idOrIds)) {
      return apiClient.post("/notifications/read", { ids: idOrIds });
    } else if (idOrIds) {
      return apiClient.post("/notifications/read", { id: idOrIds });
    } else {
      return apiClient.post("/notifications/read", {});
    }
  },

  async snooze(id: string, until: string): Promise<void> {
    return apiClient.post("/notifications/snooze", { id, snooze_until: until });
  },
};
