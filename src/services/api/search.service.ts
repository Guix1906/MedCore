import { apiClient } from "./api-client";

export interface SearchResult {
  kind: "patient" | "doctor" | "treatment" | "inventory";
  id: string;
  label: string;
  extra?: string | null;
  created_at?: string;
}

export const searchService = {
  async search(query: string): Promise<SearchResult[]> {
    if (!query.trim()) return [];
    return apiClient.get<SearchResult[]>(`/search?q=${encodeURIComponent(query.trim())}`);
  },
};
