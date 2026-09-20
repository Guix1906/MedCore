import type { ElementType } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  CheckCheck,
  FileBarChart,
  LineChart,
  Wallet,
} from "lucide-react";

export type FinanceTabId = "fluxo" | "pagar" | "receber" | "conciliacao" | "dre" | "dfc";
export const financeTabs: { id: FinanceTabId; label: string; icon: ElementType }[] = [
  { id: "fluxo", label: "Fluxo de Caixa", icon: LineChart },
  { id: "pagar", label: "Contas a Pagar", icon: ArrowUpRight },
  { id: "receber", label: "Contas a Receber", icon: ArrowDownLeft },
  { id: "conciliacao", label: "Conciliação OFX", icon: CheckCheck },
  { id: "dre", label: "DRE", icon: FileBarChart },
  { id: "dfc", label: "DFC", icon: Wallet },
];

export function resolveFinanceTab(value: unknown): FinanceTabId {
  const current = financeTabs.find((tab) => tab.id === value);
  if (current) return current.id;
  if (value === "planos") return "receber";
  if (value === "repasses") return "pagar";
  if (value === "relatorios") return "dre";
  return "fluxo";
}

export default function FinanceTabs({
  activeTab,
  onSelectTab,
  disabled = false,
}: {
  activeTab: FinanceTabId;
  onSelectTab: (tab: FinanceTabId) => void;
  disabled?: boolean;
}) {
  return (
    <nav aria-label="Seções do financeiro" className="border-b border-slate-200">
      <label className="block pb-3 text-sm md:hidden">
        Seção
        <select
          className="mt-1 w-full rounded-lg border bg-white p-2"
          value={activeTab}
          disabled={disabled}
          onChange={(event) => onSelectTab(resolveFinanceTab(event.target.value))}
        >
          {financeTabs.map((tab) => (
            <option key={tab.id} value={tab.id}>
              {tab.label}
            </option>
          ))}
        </select>
      </label>
      <div className="hidden gap-1 overflow-x-auto md:flex">
        {financeTabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            disabled={disabled}
            aria-current={id === activeTab ? "page" : undefined}
            onClick={() => onSelectTab(id)}
            className={`inline-flex shrink-0 items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors disabled:opacity-50 ${id === activeTab ? "border-primary text-primary" : "border-transparent text-slate-500 hover:text-slate-900"}`}
          >
            <Icon size={16} aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>
    </nav>
  );
}
