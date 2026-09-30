/**
 * Limpeza de dados clínicos e financeiros que versões anteriores gravavam no navegador.
 *
 * O banco (Supabase, com RLS) é a única fonte desses dados. Cópias locais expunham dados de
 * pacientes em texto claro (LGPD) e faziam cada computador exibir valores diferentes.
 */

const LEGACY_KEYS = [
  "medcore_local_events",
  "medcore_local_titles",
  "medcore_local_payments",
  "medcore_local_patients",
  "medcore_deleted_titles",
  "medcore_deleted_cash_entries",
  "medcore_deleted_event_ids",
  "medcore_events_purged_v2",
  "medcore_system_wipe_cutoff_v7",
  "medcore_system_wipe_executed_v7",
  "medcore_system_wipe_v7_total_clean",
];

const LEGACY_PREFIXES = ["medcore_prontuario_"];

function purge(storage: Storage | undefined) {
  if (!storage) return;
  try {
    LEGACY_KEYS.forEach((key) => storage.removeItem(key));
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (key && LEGACY_PREFIXES.some((prefix) => key.startsWith(prefix))) keys.push(key);
    }
    keys.forEach((key) => storage.removeItem(key));
  } catch {
    // Armazenamento indisponível (modo privado, bloqueio do navegador): nada a limpar.
  }
}

/** Remove dados de pacientes/financeiro deixados no navegador. Chamada na carga e no logout. */
export function purgeLocalClinicalData(): void {
  if (typeof window === "undefined") return;
  purge(window.localStorage);
  purge(window.sessionStorage);
}
