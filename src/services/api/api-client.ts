/**
 * Cliente HTTP Ultra-Rápido para o Backend PHP do MedCore
 * Integração de alta performance com cache inteligente, injeção de JWT e deduplicação de requisições.
 */

const API_BASE_URL = (import.meta.env?.VITE_API_URL as string) || "http://127.0.0.1:8000/api";

const TOKEN_STORAGE_KEY = "medcore_php_token";
const USER_STORAGE_KEY = "medcore_php_user";

// Cache em memória para requisições GET idênticas concorrentes (Request Deduplication)
const inFlightRequests = new Map<string, Promise<any>>();

export interface ApiResponse<T = any> {
  success: boolean;
  message?: string;
  data: T;
  error?: string;
  details?: any;
}

export class ApiError extends Error {
  statusCode: number;
  details?: any;

  constructor(message: string, statusCode: number = 400, details?: any) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.details = details;
  }
}

export function getStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_STORAGE_KEY) || sessionStorage.getItem(TOKEN_STORAGE_KEY);
}

export function setStoredToken(token: string, remember: boolean = true): void {
  if (typeof window === "undefined") return;
  if (remember) {
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } else {
    sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
  }
}

export function removeStoredToken(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(TOKEN_STORAGE_KEY);
  sessionStorage.removeItem(TOKEN_STORAGE_KEY);
  localStorage.removeItem(USER_STORAGE_KEY);
  sessionStorage.removeItem(USER_STORAGE_KEY);
}

export function getStoredUser(): any | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(USER_STORAGE_KEY) || sessionStorage.getItem(USER_STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function setStoredUser(user: any, remember: boolean = true): void {
  if (typeof window === "undefined") return;
  const raw = JSON.stringify(user);
  if (remember) {
    localStorage.setItem(USER_STORAGE_KEY, raw);
  } else {
    sessionStorage.setItem(USER_STORAGE_KEY, raw);
  }
}

const BACKEND_OFFLINE_KEY = "medcore_backend_offline";
let backendOfflineUntil = 0;

export function isBackendReachable(): boolean {
  if (typeof window === "undefined") return false;
  // Bloqueio imediato de Mixed Content e localhost em ambientes HTTPS ou remotos (Vercel/produção)
  const isHttps = window.location.protocol === "https:";
  const isLocalHost = API_BASE_URL.includes("localhost") || API_BASE_URL.includes("127.0.0.1");
  const isRemoteSite =
    window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1";
  if ((isHttps || isRemoteSite) && isLocalHost) {
    return false;
  }
  // Se não há token do PHP armazenado, o app usa prioritariamente o Supabase;
  // evita requisições fantasmas que atrasam o carregamento das telas com timeout
  if (!getStoredToken()) {
    return false;
  }
  // Se já foi marcado como indisponível na sessão, responde 0ms sem travar a navegação
  try {
    if (sessionStorage.getItem(BACKEND_OFFLINE_KEY) === "1") {
      return false;
    }
  } catch {}

  if (backendOfflineUntil && Date.now() < backendOfflineUntil) {
    return false;
  }
  return true;
}

export function markBackendOffline(): void {
  backendOfflineUntil = Date.now() + 24 * 3600_000; // 24h
  try {
    if (typeof window !== "undefined") {
      sessionStorage.setItem(BACKEND_OFFLINE_KEY, "1");
    }
  } catch {}
}

async function request<T = any>(endpoint: string, options: RequestInit = {}): Promise<T> {
  if (!isBackendReachable()) {
    throw new ApiError("Backend local indisponível. Usando banco em nuvem.", 503);
  }

  const cleanEndpoint = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  const url = `${API_BASE_URL}${cleanEndpoint}`;

  const token = getStoredToken();
  const headers = new Headers(options.headers || {});

  if (!headers.has("Content-Type") && !(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const method = (options.method || "GET").toUpperCase();
  const cacheKey = method === "GET" ? `${url}?${headers.get("Authorization") || ""}` : null;

  if (cacheKey && inFlightRequests.has(cacheKey)) {
    return inFlightRequests.get(cacheKey) as Promise<T>;
  }

  const fetchWithRetry = async (): Promise<T> => {
    const controller = new AbortController();
    const timeoutMs = 250; // 250ms max para fail-fast imediato
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...options,
        headers,
        signal: options.signal || controller.signal,
      });
      clearTimeout(timeoutId);

      const json: ApiResponse<T> = await response.json().catch(() => ({
        success: response.ok,
        data: null as any,
        error: response.statusText,
      }));

      if (!response.ok || json.success === false) {
        if (response.status === 401) {
          removeStoredToken();
        }

        throw new ApiError(
          json.error || json.message || `Erro HTTP ${response.status}`,
          response.status,
          json.details,
        );
      }

      return json.data;
    } catch (err: any) {
      clearTimeout(timeoutId);
      if (err instanceof ApiError) throw err;

      // Ativa circuit breaker imediato para a sessão caso não responda em 400ms
      markBackendOffline();

      const isAbort = err.name === "AbortError" || err.message?.includes("aborted");
      throw new ApiError(
        isAbort ? "Tempo limite esgotado." : err.message || "Erro de conexão.",
        0,
      );
    }
  };

  const fetchPromise = (async () => {
    try {
      return await fetchWithRetry();
    } finally {
      if (cacheKey) {
        inFlightRequests.delete(cacheKey);
      }
    }
  })();

  if (cacheKey) {
    inFlightRequests.set(cacheKey, fetchPromise);
  }

  return fetchPromise;
}

export const apiClient = {
  get: <T = any>(endpoint: string, headers?: HeadersInit) =>
    request<T>(endpoint, { method: "GET", headers }),

  post: <T = any>(endpoint: string, body?: any, headers?: HeadersInit) =>
    request<T>(endpoint, {
      method: "POST",
      body: body ? JSON.stringify(body) : undefined,
      headers,
    }),

  put: <T = any>(endpoint: string, body?: any, headers?: HeadersInit) =>
    request<T>(endpoint, {
      method: "PUT",
      body: body ? JSON.stringify(body) : undefined,
      headers,
    }),

  patch: <T = any>(endpoint: string, body?: any, headers?: HeadersInit) =>
    request<T>(endpoint, {
      method: "PATCH",
      body: body ? JSON.stringify(body) : undefined,
      headers,
    }),

  delete: <T = any>(endpoint: string, headers?: HeadersInit) =>
    request<T>(endpoint, { method: "DELETE", headers }),
};
