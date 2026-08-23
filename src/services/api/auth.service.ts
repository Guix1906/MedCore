import {
  apiClient,
  setStoredToken,
  setStoredUser,
  removeStoredToken,
  getStoredToken,
  getStoredUser,
} from "./api-client";

export interface UserProfile {
  id: string;
  email: string;
  full_name: string;
  avatar_url?: string | null;
  phone?: string | null;
  active_company_id?: string | null;
}

export interface AuthSession {
  token: string;
  user: UserProfile;
  companies?: any[];
}

export const authService = {
  async signIn(email: string, password: string, remember: boolean = true): Promise<AuthSession> {
    const data = await apiClient.post<AuthSession>("/auth/login", { email, password });
    if (data.token) {
      setStoredToken(data.token, remember);
    }
    if (data.user) {
      setStoredUser(data.user, remember);
    }
    return data;
  },

  async signUp(email: string, password: string, fullName: string): Promise<AuthSession> {
    const data = await apiClient.post<AuthSession>("/auth/register", {
      email,
      password,
      full_name: fullName,
    });
    if (data.token) {
      setStoredToken(data.token, true);
    }
    if (data.user) {
      setStoredUser(data.user, true);
    }
    return data;
  },

  async signOut(): Promise<void> {
    removeStoredToken();
  },

  async getMe(): Promise<{ user: UserProfile; companies: any[] }> {
    return apiClient.get("/auth/me");
  },

  getSession(): { token: string | null; user: UserProfile | null } {
    return {
      token: getStoredToken(),
      user: getStoredUser(),
    };
  },

  isAuthenticated(): boolean {
    return !!getStoredToken();
  },
};
