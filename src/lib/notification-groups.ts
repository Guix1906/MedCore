export type DayGroupId = "today" | "yesterday" | "older";

const LABELS: Record<DayGroupId, string> = {
  today: "Hoje",
  yesterday: "Ontem",
  older: "Anteriores",
};

export function groupByDay<T extends { created_at: string }>(items: T[], now = new Date()) {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const buckets: Record<DayGroupId, T[]> = { today: [], yesterday: [], older: [] };
  for (const item of items) {
    const time = new Date(item.created_at).getTime();
    if (Number.isNaN(time)) buckets.older.push(item);
    else if (time >= today.getTime()) buckets.today.push(item);
    else if (time >= yesterday.getTime()) buckets.yesterday.push(item);
    else buckets.older.push(item);
  }
  return (Object.keys(LABELS) as DayGroupId[])
    .filter((id) => buckets[id].length > 0)
    .map((id) => ({ id, label: LABELS[id], items: buckets[id] }));
}

export function formatNotificationTime(value: string, group: DayGroupId) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return group === "older"
    ? date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })
    : date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}
