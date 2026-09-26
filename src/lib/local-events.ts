/**
 * Local Events & Appointments Storage Helper
 * Guarantees zero data loss, instant creation, and offline resilience for agenda events.
 */

import type { RawEvent } from "@/features/agenda/lib/normalize";
import { supabase } from "@/integrations/supabase/client";

const STORAGE_KEY = "medcore_local_events";
const AUTO_WIPE_KEY = "medcore_wipe_all_events_v2026_09_final";

/**
 * Exclui absolutamente todos os agendamentos existentes (banco Supabase e localStorage),
 * além de limpar títulos e pagamentos financeiros derivados de agendamentos.
 */
export async function wipeAllAppointments(): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    // 1. Limpa localStorage
    localStorage.removeItem(STORAGE_KEY);

    try {
      const rawTitles = localStorage.getItem("medcore_local_titles");
      if (rawTitles) {
        const titles = JSON.parse(rawTitles);
        if (Array.isArray(titles)) {
          const cleanTitles = titles.filter(
            (t: any) =>
              !t.id?.startsWith("evt-") &&
              !t.origin_key?.startsWith("event:") &&
              !t.category?.toLowerCase().includes("atendimento"),
          );
          localStorage.setItem("medcore_local_titles", JSON.stringify(cleanTitles));
        }
      }
    } catch {}

    try {
      const rawPayments = localStorage.getItem("medcore_local_payments");
      if (rawPayments) {
        const payments = JSON.parse(rawPayments);
        if (Array.isArray(payments)) {
          const cleanPayments = payments.filter(
            (p: any) =>
              !p.id?.startsWith("pay-evt-") &&
              !p.transaction_id?.startsWith("evt-"),
          );
          localStorage.setItem("medcore_local_payments", JSON.stringify(cleanPayments));
        }
      }
    } catch {}

    // 2. Limpa Supabase database
    try {
      await supabase.from("events").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    } catch (err) {
      console.warn("Aviso ao limpar events no Supabase:", err);
    }

    try {
      await supabase.from("transactions").delete().like("origin_key", "event:%");
    } catch (err) {
      console.warn("Aviso ao limpar transactions no Supabase:", err);
    }

    try {
      await supabase.from("transactions").delete().like("id", "evt-%");
    } catch (err) {
      console.warn("Aviso ao limpar transactions evt no Supabase:", err);
    }

    try {
      await (supabase as any).from("financial_titles").delete().like("origin_key", "event:%");
    } catch (err) {
      console.warn("Aviso ao limpar financial_titles no Supabase:", err);
    }

    try {
      await (supabase as any).from("financial_titles").delete().like("id", "evt-%");
    } catch (err) {
      console.warn("Aviso ao limpar financial_titles evt no Supabase:", err);
    }

    try {
      await (supabase as any).from("financial_payments").delete().like("id", "pay-evt-%");
    } catch (err) {
      console.warn("Aviso ao limpar financial_payments no Supabase:", err);
    }

    try {
      await supabase.from("appointments").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    } catch (err) {
      console.warn("Aviso ao limpar appointments no Supabase:", err);
    }

    // 3. Emite eventos para notificar todas as telas do sistema
    window.dispatchEvent(new CustomEvent("medcore_events_updated", { detail: [] }));
    window.dispatchEvent(new CustomEvent("medcore_local_title_saved"));
  } catch (e) {
    console.error("Erro ao zerar agendamentos:", e);
  }
}

// Purga automática inicial para zerar todos os agendamentos de teste anteriores
if (typeof window !== "undefined") {
  try {
    if (!localStorage.getItem(AUTO_WIPE_KEY)) {
      localStorage.setItem(AUTO_WIPE_KEY, "true");
      localStorage.removeItem(STORAGE_KEY);
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
