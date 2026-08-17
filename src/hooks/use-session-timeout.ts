import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutos de inatividade

/**
 * Hook para encerramento de sessão automático por inatividade (Hardening LGPD/HIPAA)
 */
export function useSessionTimeout(timeoutMs: number = DEFAULT_TIMEOUT_MS) {
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const resetTimer = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(async () => {
        toast.warning("Sessão encerrada por inatividade para proteção dos dados dos pacientes.");
        try {
          await supabase.auth.signOut();
          window.location.href = "/auth";
        } catch (e) {
          console.error("Erro ao encerrar sessão por inatividade:", e);
        }
      }, timeoutMs);
    };

    // Eventos que indicam atividade do usuário
    const events = ["mousemove", "keydown", "click", "touchstart", "scroll"];
    events.forEach((ev) => window.addEventListener(ev, resetTimer, { passive: true }));

    resetTimer();

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      events.forEach((ev) => window.removeEventListener(ev, resetTimer));
    };
  }, [timeoutMs]);
}
