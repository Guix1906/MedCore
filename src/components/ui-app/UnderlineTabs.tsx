import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { StickyToolbar } from "@/components/ui-app/StickyToolbar";
import { cn } from "@/utils/cn";

/**
 * Abas de seção com sublinhado que desliza até a aba ativa (Financeiro, Relatórios).
 * A barra fica fixa abaixo do cabeçalho ao rolar. Use com `useTabDirection` + `.fin-tab-enter`
 * no conteúdo para ele entrar deslizando no sentido da navegação.
 */
export function UnderlineTabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
  disabled = false,
  className,
}: {
  tabs: { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
  label: string;
  disabled?: boolean;
  className?: string;
}) {
  const navRef = useRef<HTMLElement>(null);
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const measure = () => {
      const el = navRef.current?.querySelector<HTMLElement>(`[data-tab="${value}"]`);
      if (el) setIndicator({ left: el.offsetLeft, width: el.offsetWidth });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [value]);

  return (
    <StickyToolbar
      className={cn("mb-0", className)}
      innerClassName="w-full gap-0 rounded-none border-0 border-b border-border bg-background/90 p-0 shadow-none"
    >
      <nav ref={navRef} aria-label={label} className="relative flex min-w-0 items-center gap-6">
        {indicator && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute bottom-0 h-0.5 rounded-full bg-primary fin-tab-indicator"
            style={{ left: indicator.left, width: indicator.width }}
          />
        )}
        {tabs.map(({ id, label: text }) => {
          const active = id === value;
          return (
            <button
              key={id}
              data-tab={id}
              type="button"
              disabled={disabled}
              aria-current={active ? "page" : undefined}
              onClick={() => onChange(id)}
              className={cn(
                "cursor-pointer whitespace-nowrap pb-2.5 pt-2 text-sm font-medium transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-50",
                active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {text}
            </button>
          );
        })}
      </nav>
    </StickyToolbar>
  );
}

/** Sentido da troca de aba: 1 (foi para a direita), -1 (esquerda) ou 0 (mesma aba). */
export function useTabDirection<T>(ids: readonly T[], value: T) {
  const index = ids.indexOf(value);
  const prev = useRef(index);
  const direction = Math.sign(index - prev.current);
  useEffect(() => {
    prev.current = index;
  }, [index]);
  return direction;
}
