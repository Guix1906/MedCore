import type { DbRow, Json, IconType } from "@/lib/types";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  List,
  ArrowDownLeft,
  ArrowUpRight,
  ScrollText,
  LineChart,
  FileBarChart,
  Wallet,
  FolderTree,
  DoorOpen,
  FileText,
} from "lucide-react";

type Tab = { to: string; label: string; icon: React.ElementType; exact?: boolean };
const tabs: Tab[] = [
  { to: "/financeiro", label: "Lançamentos", icon: List, exact: true },
  { to: "/financeiro/receber", label: "A Receber", icon: ArrowDownLeft },
  { to: "/financeiro/pagar", label: "A Pagar", icon: ArrowUpRight },
  { to: "/financeiro/extrato", label: "Extrato", icon: ScrollText },
  { to: "/financeiro/fluxo", label: "Fluxo de Caixa", icon: LineChart },
  { to: "/financeiro/dre", label: "DRE", icon: FileBarChart },
  { to: "/financeiro/contas", label: "Contas", icon: Wallet },
  { to: "/financeiro/centros-custo", label: "Centros de Custo", icon: FolderTree },
  { to: "/financeiro/caixa", label: "Caixa", icon: DoorOpen },
  { to: "/financeiro/relatorios", label: "Relatórios", icon: FileText },
];

export default function FinanceTabs() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <div className="border-b border-[#E5E7EB] bg-white">
      <div className="px-6 flex gap-1 overflow-x-auto no-scrollbar">
        {tabs.map((t) => {
          const active = t.exact
            ? pathname === t.to
            : pathname === t.to || pathname.startsWith(t.to + "/");
          const Icon = t.icon;
          return (
            <Link
              key={t.to}
              to={t.to}
              className={`inline-flex items-center gap-2 px-3 h-11 text-[13px] font-medium whitespace-nowrap border-b-2 transition-colors ${
                active
                  ? "text-[#8B47FF] border-[#8B47FF]"
                  : "text-[#6B7280] border-transparent hover:text-[#111827] hover:border-[#E5E7EB]"
              }`}
            >
              <Icon size={15} />
              {t.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
