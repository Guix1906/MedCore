import type { ReactNode } from "react";
import { Sparkles } from "lucide-react";
import { cn } from "@/utils/cn";

/**
 * Cabeçalho padrão de página do app.
 *
 * - "Eyebrow": pequeno rótulo em caps com ícone à esquerda.
 * - Título grande (h1) usando a fonte display.
 * - Slot `actions` à direita para botões/menus.
 *
 * Não altera cores nem espaçamentos existentes das páginas —
 * é a extração literal do padrão já usado em Agenda.
 */
export type PageHeaderProps = {
  eyebrow?: string;
  title: string;
  icon?: React.ComponentType<{ className?: string }>;
  actions?: ReactNode;
  className?: string;
};

export function PageHeader({
  eyebrow,
  title,
  icon: Icon = Sparkles,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <div className={cn("flex items-start justify-between gap-4 mb-6 flex-wrap", className)}>
      <div>
        {eyebrow && (
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-muted-foreground mb-1.5">
            <Icon className="h-3.5 w-3.5 text-primary" /> {eyebrow}
          </div>
        )}
        <h1 className="font-display text-4xl md:text-5xl font-normal tracking-tight text-balance">
          {title}
        </h1>
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
