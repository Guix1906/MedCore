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

export interface FinanceGroup {
  id: string;
  label: string;
  icon: React.ElementType;
  tabs: FinanceTabItem[];
}

export const financeGroups: FinanceGroup[] = [
  {
    id: "overview",
    label: "Visão Geral",
    icon: LineChart,
    tabs: [
      { id: "lancamentos", label: "Lançamentos Gerais", icon: List },
      { id: "fluxo", label: "Fluxo de Caixa", icon: LineChart },
      { id: "dre", label: "DRE Gerencial", icon: FileBarChart },
      { id: "relatorios", label: "Relatórios", icon: PieChart },
    ],
  },
  {
    id: "receber_group",
    label: "A Receber",
    icon: ArrowDownLeft,
    tabs: [
      { id: "receber", label: "Títulos a Receber", icon: ArrowDownLeft },
      { id: "planos", label: "Planos & Contratos", icon: FileText },
    ],
  },
  {
    id: "pagar_group",
    label: "A Pagar",
    icon: ArrowUpRight,
    tabs: [
      { id: "pagar", label: "Títulos a Pagar", icon: ArrowUpRight },
      { id: "repasses", label: "Repasses Médicos", icon: UserCheck },
    ],
  },
  {
    id: "caixa_group",
    label: "Contas & Caixa",
    icon: Wallet,
    tabs: [
      { id: "caixa", label: "Frente de Caixa", icon: DoorOpen },
      { id: "extrato", label: "Extrato de Contas", icon: ScrollText },
      { id: "contas", label: "Contas Bancárias", icon: Wallet },
      { id: "cartoes", label: "Cartões & Maquininhas", icon: CreditCard },
      { id: "conciliacao", label: "Conciliação", icon: CheckCheck },
    ],
  },
  {
    id: "config_group",
    label: "Estrutura & Custos",
    icon: FolderTree,
    tabs: [
      { id: "centros-custo", label: "Centros de Custo", icon: FolderTree },
    ],
  },
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
  // Encontra o grupo ativo baseado na activeTab
  const currentGroup =
    financeGroups.find((g) => g.tabs.some((t) => t.id === activeTab)) || financeGroups[0];

  return (
    <div className="bg-white border-b border-[#E5E7EB] -mx-6 -mt-6 mb-6">
      {/* 1º Nível: 5 Eixos Principais */}
      <div className="px-6 flex gap-2 overflow-x-auto border-b border-slate-100 no-scrollbar">
        {financeGroups.map((group) => {
          const isActiveGroup = currentGroup.id === group.id;
          const GroupIcon = group.icon;

          return (
            <button
              key={group.id}
              type="button"
              disabled={disabled}
              onClick={() => {
                // Se já estiver no grupo, mantém ou vai pro primeiro
                if (!isActiveGroup) {
                  onSelectTab(group.tabs[0].id);
                }
              }}
              className={`inline-flex items-center gap-2 px-4 h-12 text-sm font-semibold whitespace-nowrap border-b-2 transition-all cursor-pointer disabled:opacity-50 ${
                isActiveGroup
                  ? "text-primary border-primary bg-primary/5"
                  : "text-slate-600 border-transparent hover:text-slate-900 hover:border-slate-300"
              }`}
            >
              <GroupIcon className={`h-4 w-4 ${isActiveGroup ? "text-primary" : "text-slate-400"}`} />
              {group.label}
            </button>
          );
        })}
      </div>

      {/* 2º Nível: Sub-abas / Pílulas da Categoria Ativa */}
      {currentGroup.tabs.length > 1 && (
        <div className="px-6 py-2.5 bg-slate-50/70 flex items-center gap-2 overflow-x-auto no-scrollbar">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mr-1 shrink-0">
            Submódulos:
          </span>
          {currentGroup.tabs.map((tab) => {
            const isTabActive = activeTab === tab.id;
            const TabIcon = tab.icon;

            return (
              <button
                key={tab.id}
                type="button"
                disabled={disabled}
                onClick={() => onSelectTab(tab.id)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition cursor-pointer disabled:opacity-50 ${
                  isTabActive
                    ? "bg-white text-primary shadow-xs border border-slate-200"
                    : "text-slate-600 hover:bg-white/60 hover:text-slate-900"
                }`}
              >
                <TabIcon className={`h-3.5 w-3.5 ${isTabActive ? "text-primary" : "text-slate-400"}`} />
                {tab.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
