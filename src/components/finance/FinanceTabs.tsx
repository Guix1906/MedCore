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
  CreditCard,
  UserCheck,
  CheckCheck,
  FileText,
  PieChart,
} from "lucide-react";

export type FinanceTabId =
  | "lancamentos"
  | "receber"
  | "pagar"
  | "extrato"
  | "fluxo"
  | "dre"
  | "contas"
  | "centros-custo"
  | "caixa"
  | "cartoes"
  | "repasses"
  | "conciliacao"
  | "planos"
  | "relatorios";

export interface FinanceTabItem {
  id: FinanceTabId;
  label: string;
  icon: React.ElementType;
}

export const financeTabs: FinanceTabItem[] = [
  { id: "lancamentos", label: "Lançamentos", icon: List },
  { id: "receber", label: "A Receber", icon: ArrowDownLeft },
  { id: "pagar", label: "A Pagar", icon: ArrowUpRight },
  { id: "extrato", label: "Extrato", icon: ScrollText },
  { id: "fluxo", label: "Fluxo de Caixa", icon: LineChart },
  { id: "dre", label: "DRE", icon: FileBarChart },
  { id: "contas", label: "Contas", icon: Wallet },
  { id: "centros-custo", label: "Centros de Custo", icon: FolderTree },
  { id: "caixa", label: "Caixa", icon: DoorOpen },
  { id: "cartoes", label: "Cartões", icon: CreditCard },
  { id: "repasses", label: "Repasses", icon: UserCheck },
  { id: "conciliacao", label: "Conciliação", icon: CheckCheck },
  { id: "planos", label: "Planos", icon: FileText },
  { id: "relatorios", label: "Relatórios", icon: PieChart },
];

interface FinanceTabsProps {
  activeTab: string;
  onSelectTab: (tabId: FinanceTabId) => void;
  disabled?: boolean;
}

export default function FinanceTabs({
  activeTab,
  onSelectTab,
  disabled = false,
}: FinanceTabsProps) {
  return (
    <div className="border-b border-[#E5E7EB] bg-white -mx-6 -mt-6 mb-6">
      <div className="px-6 flex gap-1 overflow-x-auto no-scrollbar">
        {financeTabs.map((t) => {
          const active = activeTab === t.id;
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              disabled={disabled}
              onClick={() => onSelectTab(t.id)}
              className={`inline-flex items-center gap-2 px-3 h-11 text-[13px] font-medium whitespace-nowrap border-b-2 transition-colors disabled:opacity-50 cursor-pointer ${
                active
                  ? "text-[#8B47FF] border-[#8B47FF]"
                  : "text-[#6B7280] border-transparent hover:text-[#111827] hover:border-[#E5E7EB]"
              }`}
            >
              <Icon size={15} />
              {t.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
