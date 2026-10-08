import { supabase } from "@/integrations/supabase/client";
import { isMissingFunction, toAdminError } from "./admin-api";

/**
 * Plataforma (dono do MedCore): clientes = empresas. Só administradores da plataforma
 * chamam estas funções; elas devolvem apenas dados cadastrais, nunca dados clínicos.
 */

export type ClientStatus = "active" | "paused" | "cancelled";

export type ClientUser = {
  memberId: string;
  userId: string;
  email: string | null;
  fullName: string;
  status: string;
  role: string | null;
  lastSignInAt: string | null;
};

export type PlatformClient = {
  id: string;
  name: string;
  legalName: string | null;
  document: string | null;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  notes: string | null;
  status: ClientStatus;
  statusReason: string | null;
  statusChangedAt: string | null;
  createdAt: string | null;
  users: ClientUser[];
};

export type ClientData = {
  name: string;
  legal_name?: string;
  document?: string;
  contact_name?: string;
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
  state?: string;
  notes?: string;
};

type Rpc = (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: any }>;
const callRpc = supabase.rpc.bind(supabase) as unknown as Rpc;

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await callRpc(fn, args);
  if (error) throw toAdminError(error);
  return data as T;
}

const s = (v: unknown) => (typeof v === "string" && v.length > 0 ? v : null);

/** Falso também quando a migração da plataforma ainda não foi aplicada. */
export async function fetchIsPlatformAdmin(): Promise<boolean> {
  const { data, error } = await callRpc("is_platform_admin");
  if (error) {
    if (isMissingFunction(error)) return false;
    return false;
  }
  return data === true;
}

export async function listClients(): Promise<PlatformClient[]> {
  const raw = await rpc<unknown[]>("platform_list_clients");
  return (Array.isArray(raw) ? raw : []).map((v) => {
    const r = (v ?? {}) as Record<string, unknown>;
    return {
      id: String(r.id),
      name: s(r.name) ?? "Cliente",
      legalName: s(r.legal_name),
      document: s(r.document),
      contactName: s(r.contact_name),
      phone: s(r.phone),
      email: s(r.email),
      address: s(r.address),
      city: s(r.city),
      state: s(r.state),
      notes: s(r.notes),
      status: (["active", "paused", "cancelled"].includes(String(r.status))
        ? r.status
        : "active") as ClientStatus,
      statusReason: s(r.status_reason),
      statusChangedAt: s(r.status_changed_at),
      createdAt: s(r.created_at),
      users: (Array.isArray(r.users) ? r.users : []).map((u) => {
        const x = (u ?? {}) as Record<string, unknown>;
        return {
          memberId: String(x.member_id),
          userId: String(x.user_id),
          email: s(x.email),
          fullName: s(x.full_name) ?? "Usuário",
          status: String(x.status ?? ""),
          role: s(x.role),
          lastSignInAt: s(x.last_sign_in_at),
        };
      }),
    };
  });
}

export async function saveClient(id: string | null, data: ClientData): Promise<string> {
  const r = await rpc<string>("platform_save_client", { p_id: id, p_data: data });
  return String(r);
}

export async function createClientUser(input: {
  companyId: string;
  email: string;
  password: string;
  fullName: string;
}) {
  const r = await rpc<Record<string, unknown>>("platform_create_client_user", {
    p_company_id: input.companyId,
    p_email: input.email.trim(),
    p_password: input.password,
    p_full_name: input.fullName.trim(),
  });
  return {
    email: String(r?.email ?? input.email),
    existingAccount: r?.existing_account === true,
    // Clínicas de que o e-mail saiu (ele passa a ver só este cliente)
    removedFrom: (Array.isArray(r?.removed_from) ? r.removed_from : []).filter(
      (n): n is string => typeof n === "string",
    ),
  };
}

export async function setClientStatus(companyId: string, status: ClientStatus, reason?: string) {
  await rpc("platform_set_client_status", {
    p_company_id: companyId,
    p_status: status,
    p_reason: reason?.trim() || null,
  });
}
