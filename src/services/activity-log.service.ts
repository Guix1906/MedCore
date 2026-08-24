import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { sanitizeDbError } from "@/lib/server-errors";

const LogSchema = z.object({
  action: z.string().min(1).max(80),
  entity_type: z.string().min(1).max(60),
  entity_id: z.string().uuid().optional().nullable(),
  entity_label: z.string().max(240).optional().nullable(),
  metadata: z.record(z.string(), z.unknown()).optional().nullable(),
});

export const logActivity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => LogSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: profile } = await supabase
      .from("profiles")
      .select("active_company_id")
      .eq("id", userId)
      .maybeSingle();
    const companyId = profile?.active_company_id;
    if (!companyId) return { ok: false };

    await supabase.from("activity_logs").insert({
      company_id: companyId,
      user_id: userId,
      action: data.action,
      entity_type: data.entity_type,
      entity_id: data.entity_id ?? null,
      entity_label: data.entity_label ?? null,
      metadata: data.metadata ?? {},
    } as never);
    return { ok: true };
  });

export const listActivityLogs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        entity_type: z.string().optional(),
        entity_id: z.string().uuid().optional(),
        limit: z.number().min(1).max(500).optional(),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: profile } = await supabase
      .from("profiles")
      .select("active_company_id")
      .eq("id", userId)
      .maybeSingle();
    const companyId = profile?.active_company_id;
    if (!companyId) return { logs: [] };

    let q = supabase
      .from("activity_logs")
      .select("id, action, entity_type, entity_id, entity_label, metadata, created_at, user_id")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(data.limit ?? 100);
    if (data.entity_type) q = q.eq("entity_type", data.entity_type);
    if (data.entity_id) q = q.eq("entity_id", data.entity_id);

    const { data: rows, error } = await q;
    if (error) sanitizeDbError(error, "listActivityLogs");

    const userIds = Array.from(new Set((rows ?? []).map((r) => r.user_id)));
    let profiles: Array<{ id: string; full_name: string | null }> = [];
    if (userIds.length) {
      const { data: ps } = await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", userIds);
      profiles = ps ?? [];
    }
    const nameById = new Map(profiles.map((p) => [p.id, p.full_name ?? "—"]));
    return {
      logs: (rows ?? []).map((r) => ({ ...r, user_name: nameById.get(r.user_id) ?? "—" })),
    };
  });
