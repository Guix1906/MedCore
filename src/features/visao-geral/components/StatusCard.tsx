import {
  CalendarCheck,
  CalendarClock,
  CheckCircle2,
  CircleSlash,
  UserX,
  XCircle,
} from "lucide-react";
import { DashCard, CardTitle } from "./cards";

export type StatusRow = { key: string; label: string; count: number; pct: number };

const META: Record<string, { icon: typeof CalendarCheck; color: string; bg: string }> = {
  agendado: { icon: CalendarCheck, color: "#7C5CFA", bg: "#F1EDFF" },
  reservado: { icon: CalendarClock, color: "#9CA3AF", bg: "#F3F4F6" },
  confirmado: { icon: CheckCircle2, color: "#4F8EF7", bg: "#E8F1FE" },
  nao_compareceu: { icon: UserX, color: "#6B7280", bg: "#F3F4F6" },
  concluido: { icon: CircleSlash, color: "#16b364", bg: "#E7F8EF" },
  cancelado: { icon: XCircle, color: "#EF4444", bg: "#FDECEC" },
};

export function StatusCard({ rows, delay = 0 }: { rows: StatusRow[]; delay?: number }) {
  return (
    <DashCard delay={delay}>
      <CardTitle>Agendamentos por status</CardTitle>
      <ul className="space-y-3">
        {rows.map((r) => {
          const m = META[r.key] ?? META.reservado;
          const Icon = m.icon;
          return (
            <li key={r.key} className="flex items-center gap-3">
              <span
                className="grid h-7 w-7 shrink-0 place-items-center rounded-lg"
                style={{ background: m.bg }}
              >
                <Icon className="h-3.5 w-3.5" style={{ color: m.color }} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15.5px] font-bold leading-[1.35] tracking-[-0.01em] text-[#1B2A4A]">
                  {r.label}
                </p>
                <p className="text-[14px] font-semibold text-[#6B7280]">{r.count}</p>
              </div>
              <span className="shrink-0 text-[14px] font-bold text-[#6B7280]">{r.pct}%</span>
            </li>
          );
        })}
      </ul>
    </DashCard>
  );
}
