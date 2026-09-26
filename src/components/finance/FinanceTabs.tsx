import type { ElementType } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  CheckCheck,
  FileBarChart,
  LineChart,
  Wallet,
} from "lucide-react";
import { SegmentedControl } from "@/components/ui-app/SegmentedControl";
import { StickyToolbar } from "@/components/ui-app/StickyToolbar";

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

/** Seções do financeiro num controle segmentado de vidro que acompanha a rolagem. */
export default function FinanceTabs({
  activeTab,
  onSelectTab,
  disabled = false,
}: {
  activeTab: FinanceTabId;
  onSelectTab: (tab: FinanceTabId) => void;
  disabled?: boolean;
}) {
  // Fragmento: a barra fixa precisa ser filha direta do container alto da página.
  return (
    <>
      <label className="block text-sm font-medium md:hidden">
        Seção
        <select
          className="mt-1 h-10 w-full rounded-full border border-input bg-card px-4 text-foreground shadow-xs"
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
      <StickyToolbar className="mb-0 hidden md:flex">
        <nav aria-label="Seções do financeiro" className="min-w-0">
          <SegmentedControl
            aria-label="Seções do financeiro"
            semantics="navigation"
            value={activeTab}
            onChange={onSelectTab}
            options={financeTabs.map(({ id, label, icon: Icon }) => ({
              value: id,
              disabled,
              label: (
                <>
                  <Icon aria-hidden="true" />
                  {label}
                </>
              ),
            }))}
          />
        </nav>
      </StickyToolbar>
    </>
  );
}
