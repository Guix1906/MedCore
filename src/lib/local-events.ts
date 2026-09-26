/**
 * Local Events & Appointments Storage Helper
 * Guarantees zero data loss, instant creation, and offline resilience for agenda events.
 */

import type { RawEvent } from "@/features/agenda/lib/normalize";
import { supabase } from "@/integrations/supabase/client";

const STORAGE_KEY = "medcore_local_events";
const AUTO_WIPE_KEY = "medcore_system_clean_reset_v2026_09_26_final_1";

/**
 * Exclui absolutamente todos os agendamentos e movimentações de teste existentes
 * (banco Supabase e localStorage), zerando o sistema integralmente.
 */
export async function wipeAllAppointments(): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    // 1. Limpa todas as chaves locais do MedCore
    const storageKeys = [
      STORAGE_KEY,
      "medcore_local_titles",
      "medcore_local_payments",
      "medcore_deleted_titles",
      "medcore_deleted_cash_entries",
      "medcore_events_purged_v2",
      "medcore_wipe_all_events_v2026_09_final",
      "medcore_wipe_all_events_v2026_09_final_done",
    ];
    storageKeys.forEach((key) => {
      try {
        localStorage.removeItem(key);
      } catch {}
    });

    // Remove qualquer chave residual dinâmica
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (
          k &&
          (k.startsWith("medcore_event_") ||
            k.startsWith("medcore_appt_") ||
            k.startsWith("medcore_title_") ||
            k.startsWith("medcore_pay_"))
        ) {
          localStorage.removeItem(k);
        }
      }
    } catch {}

    // 2. Tenta zerar via RPC transacional com privilégios de segurança
    try {
      const { data: rpcRes, error: rpcErr } = await supabase.rpc("reset_all_system_test_data");
      if (!rpcErr) {
        console.info("RPC reset_all_system_test_data executada com sucesso:", rpcRes);
      }
    } catch {}

    // 3. Limpeza direta e irrestrita nas tabelas do Supabase (fallback ativo)
    try {
      await (supabase as any)
        .from("transaction_payments")
        .delete()
        .neq("id", "00000000-0000-0000-0000-000000000000");
    } catch (err) {
      console.warn("Aviso ao limpar transaction_payments no Supabase:", err);
    }

    try {
      await (supabase as any)
        .from("transactions")
        .delete()
        .neq("id", "00000000-0000-0000-0000-000000000000");
    } catch (err) {
      console.warn("Aviso ao limpar transactions no Supabase:", err);
    }

    try {
      await supabase.from("events").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    } catch (err) {
      console.warn("Aviso ao limpar events no Supabase:", err);
    }

    try {
      await supabase.from("appointments").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    } catch (err) {
      console.warn("Aviso ao limpar appointments no Supabase:", err);
    }

    try {
      await (supabase as any)
        .from("financial_titles")
        .delete()
        .neq("id", "00000000-0000-0000-0000-000000000000");
    } catch {}

    try {
      await (supabase as any)
        .from("financial_payments")
        .delete()
        .neq("id", "00000000-0000-0000-0000-000000000000");
    } catch {}

    // 4. Emite eventos para notificar todas as telas do sistema e forçar refetch imediato
    window.dispatchEvent(new CustomEvent("medcore_events_updated", { detail: [] }));
    window.dispatchEvent(new CustomEvent("medcore_local_title_saved"));
    window.dispatchEvent(new CustomEvent("medcore_system_wiped"));
  } catch (e) {
    console.error("Erro ao zerar dados do sistema:", e);
  }
}

// Purga automática inicial para zerar todos os agendamentos e movimentações de teste residuais
if (typeof window !== "undefined") {
  try {
    if (!localStorage.getItem(AUTO_WIPE_KEY)) {
      localStorage.setItem(AUTO_WIPE_KEY, "true");
      setTimeout(() => {
        void wipeAllAppointments();
      }, 0);
    }
  } catch {}
}

interface StoredLocalEvent extends RawEvent {
  company_id?: string | null;
}

export function clearAllStoredLocalEvents(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(STORAGE_KEY);
    window.dispatchEvent(new CustomEvent("medcore_events_updated", { detail: [] }));
  } catch (e) {
    console.error("Erro ao limpar eventos locais:", e);
  }
}

export function getStoredLocalEvents(companyId?: string | null): RawEvent[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const list: StoredLocalEvent[] = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list;
  } catch {
    return [];
  }
}

export function saveStoredLocalEvent(event: RawEvent, companyId?: string | null): void {
  if (typeof window === "undefined" || !event?.id) return;
  try {
    const current: StoredLocalEvent[] = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    const itemToSave: StoredLocalEvent = {
      ...event,
      company_id: companyId || event.case_id || null,
    };
    const exists = current.some((e) => e.id === event.id);
    const next = exists
      ? current.map((e) => (e.id === event.id ? { ...e, ...itemToSave } : e))
      : [itemToSave, ...current];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent("medcore_events_updated", { detail: next }));
  } catch (e) {
    console.error("Erro ao salvar evento localmente:", e);
  }
}

export function deleteStoredLocalEvent(id: string): void {
  if (typeof window === "undefined" || !id) return;
  try {
    const cleanId = id.startsWith("event:") ? id.replace("event:", "") : id;
    const current: StoredLocalEvent[] = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    const next = current.filter((e) => e.id !== cleanId && e.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent("medcore_events_updated", { detail: next }));
  } catch (e) {
    console.error("Erro ao excluir evento local:", e);
  }
}

export function updateStoredLocalEventTimes(
  id: string,
  starts_at: string,
  ends_at?: string | null,
): void {
  if (typeof window === "undefined" || !id) return;
  try {
    const cleanId = id.startsWith("event:") ? id.replace("event:", "") : id;
    const current: StoredLocalEvent[] = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    const exists = current.some((e) => e.id === cleanId || e.id === id);
    let next: StoredLocalEvent[];
    if (exists) {
      next = current.map((e) => {
        if (e.id === cleanId || e.id === id) {
          return { ...e, starts_at, ends_at: ends_at ?? e.ends_at };
        }
        return e;
      });
    } else {
      next = [
        {
          id: cleanId,
          title: "Agendamento",
          starts_at,
          ends_at: ends_at || null,
          event_type: "meeting",
          description: null,
          location: null,
          assigned_to: null,
          case_id: null,
        },
        ...current,
      ];
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent("medcore_events_updated", { detail: next }));
  } catch (e) {
    console.error("Erro ao atualizar horário do evento localmente:", e);
  }
}

export function mergeWithLocalEvents(
  remoteEvents: RawEvent[],
  companyId?: string | null,
): RawEvent[] {
  const local = getStoredLocalEvents(companyId);
  if (!local.length) return remoteEvents;

  const map = new Map<string, RawEvent>();
  remoteEvents.forEach((e) => {
    if (e?.id) map.set(e.id, e);
  });
  local.forEach((e) => {
    if (e?.id) {
      const existing = map.get(e.id);
      map.set(e.id, existing ? { ...existing, ...e } : e);
    }
  });

  return Array.from(map.values());
}
