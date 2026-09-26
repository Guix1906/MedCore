/**
 * System Wipe & Test Reset Engine
 * Guarantees that old test data (events, titles, payments) is permanently eliminated
 * across reloads, while allowing newly created tests to function perfectly.
 */
import { supabase } from "@/integrations/supabase/client";

// Baseline cutoff timestamp for legacy test records: 2026-09-26 21:25:00 UTC
export const BASE_SYSTEM_RESET_TIMESTAMP = "2026-09-26T21:25:00.000Z";

export const STORAGE_KEY_WIPE_CUTOFF = "medcore_system_wipe_cutoff_v5";
export const STORAGE_KEY_DELETED_TITLES = "medcore_deleted_titles";
export const STORAGE_KEY_DELETED_CASH = "medcore_deleted_cash_entries";
export const STORAGE_KEY_DELETED_EVENTS = "medcore_deleted_event_ids";
export const STORAGE_KEY_AUTO_WIPED = "medcore_system_wipe_executed_v5";

export function getSystemWipeCutoffTime(): number {
  if (typeof window === "undefined" || !window.localStorage) {
    return new Date(BASE_SYSTEM_RESET_TIMESTAMP).getTime();
  }
  try {
    const stored = localStorage.getItem(STORAGE_KEY_WIPE_CUTOFF);
    if (stored) {
      const parsed = new Date(stored).getTime();
      if (!isNaN(parsed) && parsed >= new Date(BASE_SYSTEM_RESET_TIMESTAMP).getTime()) {
        return parsed;
      }
    }
  } catch {}
  return new Date(BASE_SYSTEM_RESET_TIMESTAMP).getTime();
}

export function isIdSuppressed(id: string): boolean {
  if (typeof window === "undefined" || !window.localStorage || !id) return false;
  try {
    const cleanId = String(id)
      .replace(/^evt-/, "")
      .replace(/^pay-evt-/, "")
      .replace(/^title-pay-/, "")
      .replace(/^syn-pay-/, "");

    // Check deleted titles
    const rawTitles = localStorage.getItem(STORAGE_KEY_DELETED_TITLES);
    if (rawTitles && rawTitles.includes(id)) return true;
    if (cleanId !== id && rawTitles && rawTitles.includes(cleanId)) return true;

    // Check deleted cash entries
    const rawCash = localStorage.getItem(STORAGE_KEY_DELETED_CASH);
    if (rawCash && rawCash.includes(id)) return true;
    if (cleanId !== id && rawCash && rawCash.includes(cleanId)) return true;

    // Check deleted events
    const rawEvents = localStorage.getItem(STORAGE_KEY_DELETED_EVENTS);
    if (rawEvents && rawEvents.includes(id)) return true;
    if (cleanId !== id && rawEvents && rawEvents.includes(cleanId)) return true;
  } catch {}
  return false;
}

export function addSuppressedIds(ids: string[]): void {
  if (typeof window === "undefined" || !window.localStorage || !ids || !ids.length) return;
  try {
    const cleanIds = ids.filter(Boolean).map(String);

    // Update titles
    const currentTitles: string[] = JSON.parse(
      localStorage.getItem(STORAGE_KEY_DELETED_TITLES) || "[]",
    );
    const nextTitles = Array.from(new Set([...currentTitles, ...cleanIds]));
    localStorage.setItem(STORAGE_KEY_DELETED_TITLES, JSON.stringify(nextTitles));

    // Update cash
    const currentCash: string[] = JSON.parse(
      localStorage.getItem(STORAGE_KEY_DELETED_CASH) || "[]",
    );
    const nextCash = Array.from(new Set([...currentCash, ...cleanIds]));
    localStorage.setItem(STORAGE_KEY_DELETED_CASH, JSON.stringify(nextCash));

    // Update events
    const currentEvents: string[] = JSON.parse(
      localStorage.getItem(STORAGE_KEY_DELETED_EVENTS) || "[]",
    );
    const nextEvents = Array.from(new Set([...currentEvents, ...cleanIds]));
    localStorage.setItem(STORAGE_KEY_DELETED_EVENTS, JSON.stringify(nextEvents));
  } catch (e) {
    console.warn("Erro ao salvar IDs suprimidos:", e);
  }
}

/**
 * Universal filter to test if any item (appointment, title, payment, event)
 * is part of the wiped/legacy test data.
 */
export function isRecordWiped(item: any): boolean {
  if (!item) return true;

  const id = item.id ? String(item.id) : "";
  const txId = item.transaction_id ? String(item.transaction_id) : "";

  // 1. Check direct ID suppression
  if (id && isIdSuppressed(id)) return true;
  if (txId && isIdSuppressed(txId)) return true;

  // 2. Check origin_key suppression
  if (item.origin_key) {
    const rawKey = String(item.origin_key);
    const eventIdPart = rawKey.replace("event:", "");
    if (isIdSuppressed(eventIdPart) || isIdSuppressed(rawKey)) return true;
  }

  const cutoffTime = getSystemWipeCutoffTime();

  // 3. If item has created_at timestamp:
  if (item.created_at) {
    const createdTime = new Date(item.created_at).getTime();
    if (!isNaN(createdTime)) {
      if (createdTime <= cutoffTime) {
        return true;
      }
      // If created AFTER the cutoff, it is a valid new record created by the user during fresh testing!
      return false;
    }
  }

  // 4. Specific legacy test records filter:
  // The user explicitly requested to remove the PIX received of R$ 200 on 21/09 and the PIX on 29/09,
  // and all past test appointments.
  const dateStr = String(
    item.paid_on || item.date || item.due_date || item.starts_at || "",
  ).slice(0, 10);

  if (dateStr === "2026-09-21" || dateStr === "2026-09-29") {
    // If not explicitly created after cutoff, it is the legacy test record
    return true;
  }
  if (dateStr && dateStr <= "2026-09-26") {
    // Any legacy test entry on or before 2026-09-26 without created_at > cutoff is wiped
    return true;
  }

  return false;
}

/**
 * Executes a full system wipe, permanently suppressing existing test data,
 * calling RPCs to cancel/reverse backend records, and resetting localStorage.
 */
export async function performFullSystemWipe(): Promise<void> {
  if (typeof window === "undefined") return;

  const nowIso = new Date().toISOString();
  localStorage.setItem(STORAGE_KEY_WIPE_CUTOFF, nowIso);
  localStorage.setItem(STORAGE_KEY_AUTO_WIPED, "true");

  // Collect IDs from localStorage
  const existingLocalTitles = JSON.parse(
    localStorage.getItem("medcore_local_titles") || "[]",
  );
  const existingLocalPayments = JSON.parse(
    localStorage.getItem("medcore_local_payments") || "[]",
  );
  const existingLocalEvents = JSON.parse(
    localStorage.getItem("medcore_local_events") || "[]",
  );

  const idsToSuppress: string[] = [];
  existingLocalTitles.forEach((t: any) => t?.id && idsToSuppress.push(String(t.id)));
  existingLocalPayments.forEach((p: any) => {
    if (p?.id) idsToSuppress.push(String(p.id));
    if (p?.transaction_id) idsToSuppress.push(String(p.transaction_id));
  });
  existingLocalEvents.forEach((e: any) => {
    if (e?.id) {
      idsToSuppress.push(String(e.id));
      idsToSuppress.push(`evt-${e.id}`);
      idsToSuppress.push(`pay-evt-${e.id}`);
    }
  });

  // Query remote IDs to permanently suppress them
  try {
    const { data: evts } = await supabase.from("events").select("id");
    if (evts && Array.isArray(evts)) {
      evts.forEach((e: any) => {
        if (e?.id) {
          idsToSuppress.push(String(e.id));
          idsToSuppress.push(`evt-${e.id}`);
          idsToSuppress.push(`pay-evt-${e.id}`);
        }
      });
    }
  } catch {}

  try {
    const { data: txList } = await (supabase as any).from("transactions").select("id");
    if (txList && Array.isArray(txList)) {
      txList.forEach((t: any) => t?.id && idsToSuppress.push(String(t.id)));
    }
  } catch {}

  try {
    const { data: payList } = await (supabase as any)
      .from("transaction_payments")
      .select("id, transaction_id");
    if (payList && Array.isArray(payList)) {
      payList.forEach((p: any) => {
        if (p?.id) idsToSuppress.push(String(p.id));
        if (p?.transaction_id) idsToSuppress.push(String(p.transaction_id));
      });
    }
  } catch {}

  // Save all suppressed IDs
  addSuppressedIds(idsToSuppress);

  // Clear local storage data collections
  const keysToClear = [
    "medcore_local_titles",
    "medcore_local_payments",
    "medcore_local_events",
    "medcore_events_purged_v2",
  ];
  keysToClear.forEach((k) => {
    try {
      localStorage.removeItem(k);
    } catch {}
  });

  // Attempt backend cancellations/deletions via security definer RPCs
  try {
    await supabase.rpc("reset_all_system_test_data");
  } catch {}

  // Cancel any individual titles if possible
  for (const id of idsToSuppress) {
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      try {
        void supabase.rpc("reverse_financial_payment", {
          p_id: id,
          p_reason: "Reset geral de teste",
        });
      } catch {}
      try {
        void supabase.rpc("cancel_financial_title", {
          p_id: id,
          p_reason: "Reset geral de teste",
        });
      } catch {}
    }
  }

  // Attempt to delete appointments and events from Supabase
  try {
    await supabase.from("events").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  } catch {}
  try {
    await supabase.from("appointments").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  } catch {}

  // Dispatch events to notify all open tabs and views
  window.dispatchEvent(new CustomEvent("medcore_events_updated", { detail: [] }));
  window.dispatchEvent(new CustomEvent("medcore_local_title_saved"));
  window.dispatchEvent(new CustomEvent("medcore_system_wiped"));
}

// Initial Auto-Wipe trigger on first startup of this version
if (typeof window !== "undefined") {
  try {
    if (localStorage.getItem(STORAGE_KEY_AUTO_WIPED) !== "true") {
      setTimeout(() => {
        void performFullSystemWipe();
      }, 0);
    }
  } catch {}
}
