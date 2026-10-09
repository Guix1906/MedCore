import type { QueryClient } from "@tanstack/react-query";
import { clearStoredLocalPatients } from "@/lib/local-patients";

const USER_STORAGE_KEY = "medcore_php_user";

/**
 * Apaga tudo o que pertence ao usuário anterior neste navegador: cache de consultas (pacientes,
 * planos, financeiro...), perfil guardado e pacientes em memória. Chamado ao sair e ao entrar
 * com outro usuário, para que os dados de uma clínica nunca apareçam na sessão de outra.
 */
export function clearUserScopedData(queryClient: QueryClient) {
  queryClient.cancelQueries();
  queryClient.clear();
  clearStoredLocalPatients();
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(USER_STORAGE_KEY);
    sessionStorage.removeItem(USER_STORAGE_KEY);
  } catch {
    /* navegador sem armazenamento */
  }
}
