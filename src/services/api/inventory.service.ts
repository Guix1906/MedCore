import { apiClient } from "./api-client";

export interface InventoryItem {
  id: string;
  name: string;
  category?: string | null;
  unit: string;
  quantity: number;
  min_quantity: number;
  unit_cost: number;
  selling_price: number;
  expiration_date?: string | null;
  batch_number?: string | null;
  supplier?: string | null;
  notes?: string | null;
  active: boolean;
  created_at: string;
}

export const inventoryService = {
  async getItems(params?: { q?: string; category?: string }): Promise<InventoryItem[]> {
    const query = new URLSearchParams();
    if (params?.q) query.set("q", params.q);
    if (params?.category) query.set("category", params.category);
    const qs = query.toString();
    return apiClient.get<InventoryItem[]>(qs ? `/inventory-items?${qs}` : "/inventory-items");
  },

  async createItem(data: Partial<InventoryItem>): Promise<InventoryItem> {
    return apiClient.post<InventoryItem>("/inventory-items", data);
  },

  async updateItem(id: string, data: Partial<InventoryItem>): Promise<InventoryItem> {
    return apiClient.put<InventoryItem>(`/inventory-items/${id}`, data);
  },

  async deleteItem(id: string): Promise<void> {
    return apiClient.delete(`/inventory-items/${id}`);
  },
};
