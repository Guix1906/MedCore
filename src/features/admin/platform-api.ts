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
  statusReason: string | null;
  role: string | null;
  roleId: string | null;
  isOwner: boolean;
  isPlatformAdmin: boolean;
  lastSignInAt: string | null;
};

export type ClientRole = { id: string; name: string; key: string | null; isOwner: boolean };

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
  branding: ClientBranding;
  users: ClientUser[];
  roles: ClientRole[];
};

/** Identidade visual da tela de login do cliente (meedcore.vercel.app/<slug>). */
export type ClientBranding = {
  slug: string;
  logo_url: string;
  logo_white: boolean;
  primary: string;
  secondary: string;
  tagline: string;
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
      branding: {
        slug: s(r.slug) ?? "",
        logo_url: s(r.brand_logo_url) ?? "",
        logo_white: r.brand_logo_white !== false,
        primary: s(r.brand_primary) ?? "",
        secondary: s(r.brand_secondary) ?? "",
        tagline: s(r.brand_tagline) ?? "",
      },
      users: (Array.isArray(r.users) ? r.users : []).map((u) => {
        const x = (u ?? {}) as Record<string, unknown>;
        return {
          memberId: String(x.member_id),
          userId: String(x.user_id),
          email: s(x.email),
          fullName: s(x.full_name) ?? "Usuário",
          status: String(x.status ?? ""),
          statusReason: s(x.status_reason),
          role: s(x.role),
          roleId: s(x.role_id),
          isOwner: x.is_owner === true,
          isPlatformAdmin: x.is_platform_admin === true,
          lastSignInAt: s(x.last_sign_in_at),
        };
      }),
      roles: (Array.isArray(r.roles) ? r.roles : []).map((v) => {
        const x = (v ?? {}) as Record<string, unknown>;
        return { id: String(x.id), name: s(x.name) ?? "Perfil", key: s(x.key), isOwner: x.is_owner === true };
      }),
    };
  });
}

export async function saveClient(id: string | null, data: ClientData): Promise<string> {
  const r = await rpc<string>("platform_save_client", { p_id: id, p_data: data });
  return String(r);
}

export async function saveClientBranding(companyId: string, data: ClientBranding) {
  await rpc("platform_save_client_branding", { p_company_id: companyId, p_data: data });
}

/** Envia a logo para o bucket público e devolve o endereço da imagem. */
export async function uploadClientLogo(companyId: string, file: File): Promise<string> {
  const ext = (file.name.split(".").pop() ?? "png").toLowerCase().replace(/[^a-z0-9]/g, "") || "png";
  const path = `${companyId}/logo-${Date.now()}.${ext}`;
  const { error } = await supabase.storage
    .from("client-branding")
    .upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw toAdminError(error);
  return supabase.storage.from("client-branding").getPublicUrl(path).data.publicUrl;
}

/** Sugestão de endereço a partir do nome: "Clínica Senyor" → "clinica-senyor". */
export function slugify(name: string) {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

export async function createClientUser(input: {
  companyId: string;
  email: string;
  password: string;
  fullName: string;
  /** Sem perfil: Proprietário */
  roleId?: string | null;
}) {
  const r = await rpc<Record<string, unknown>>("platform_create_client_user", {
    p_company_id: input.companyId,
    p_email: input.email.trim(),
    p_password: input.password,
    p_full_name: input.fullName.trim(),
    ...(input.roleId ? { p_role_id: input.roleId } : {}),
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

export type ClientUserStatus = "active" | "suspended" | "removed";

export async function updateClientUser(input: {
  memberId: string;
  fullName: string;
  roleId: string | null;
  status: ClientUserStatus;
  reason?: string;
}) {
  await rpc("platform_update_client_user", {
    p_member_id: input.memberId,
    p_full_name: input.fullName.trim() || null,
    p_role_id: input.roleId,
    p_status: input.status,
    p_reason: input.reason?.trim() || null,
  });
}

export async function setClientUserPassword(memberId: string, password: string) {
  await rpc("platform_set_client_user_password", { p_member_id: memberId, p_password: password });
}

export async function setClientStatus(companyId: string, status: ClientStatus, reason?: string) {
  await rpc("platform_set_client_status", {
    p_company_id: companyId,
    p_status: status,
    p_reason: reason?.trim() || null,
  });
}
