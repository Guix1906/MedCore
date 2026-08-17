import { logActivity } from "@/services/activity-log.service";

type LogInput = {
  action: string;
  entity_type: string;
  entity_id?: string | null;
  entity_label?: string | null;
  metadata?: Record<string, unknown> | null;
};

/**
 * Fire-and-forget activity logger. Never throws — instrumentation must
 * never break the user's action. Deduped in-flight calls by a compact key.
 */
const inflight = new Set<string>();

export function logClient(input: LogInput): void {
  const key = `${input.action}:${input.entity_type}:${input.entity_id ?? ""}:${Date.now() >> 10}`;
  if (inflight.has(key)) return;
  inflight.add(key);
  void logActivity({
    data: {
      action: input.action,
      entity_type: input.entity_type,
      entity_id: input.entity_id ?? null,
      entity_label: input.entity_label ?? null,
      metadata: input.metadata ?? null,
    },
  })
    .catch(() => {})
    .finally(() => inflight.delete(key));
}
