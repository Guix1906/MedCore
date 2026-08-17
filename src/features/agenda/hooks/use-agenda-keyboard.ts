import { useEffect } from "react";

/**
 * Atalhos de teclado da agenda:
 * ← / →  dia anterior/próximo
 * T      hoje
 * N      nova atividade (tarefa)
 */
export function useAgendaKeyboard(handlers: {
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onNew: () => void;
}) {
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const tag = (ev.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (ev.target as HTMLElement)?.isContentEditable)
        return;
      if (ev.key === "ArrowLeft") handlers.onPrev();
      else if (ev.key === "ArrowRight") handlers.onNext();
      else if (ev.key.toLowerCase() === "t") handlers.onToday();
      else if (ev.key.toLowerCase() === "n") handlers.onNew();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handlers]);
}
