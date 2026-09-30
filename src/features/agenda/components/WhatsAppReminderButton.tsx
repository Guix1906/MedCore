import { useQuery } from "@tanstack/react-query";
import { MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { isUuid } from "@/lib/uuid";
import { cn } from "@/utils/cn";

/** Telefone brasileiro em dígitos, com DDI 55; null se não parecer um número válido. */
export function whatsappNumber(raw: string | null | undefined): string | null {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith("55")) return digits;
  return null;
}

export function buildReminderMessage(patientName: string, start: Date): string {
  const first = patientName.trim().split(/\s+/)[0] || "";
  const day = start.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit" });
  const time = start.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return [
    `Olá${first ? `, ${first}` : ""}! Passando para confirmar sua consulta: ${day}, às ${time}.`,
    "Responda SIM para confirmar ou NÃO para remarcar.",
  ].join("\n");
}

/**
 * Abre o WhatsApp do paciente com a confirmação de consulta já escrita.
 * Não usa API: o envio é feito pelo próprio usuário no WhatsApp Web/aplicativo.
 */
export function WhatsAppReminderButton({
  patientId,
  patientName,
  start,
  className,
}: {
  patientId?: string | null;
  patientName: string;
  start: Date;
  className?: string;
}) {
  const { data: phone, isLoading } = useQuery({
    queryKey: ["patient-phone", patientId],
    enabled: !!patientId && isUuid(patientId),
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("patients")
        .select("phone")
        .eq("id", patientId!)
        .maybeSingle();
      if (error) throw error;
      return data?.phone ?? null;
    },
  });

  if (!patientId) return null;

  const number = whatsappNumber(phone);
  if (!number) {
    return (
      <p className={cn("text-xs text-muted-foreground", className)}>
        {isLoading ? "Buscando telefone do paciente…" : "Cadastre o telefone do paciente para enviar o lembrete pelo WhatsApp."}
      </p>
    );
  }

  const href = `https://wa.me/${number}?text=${encodeURIComponent(buildReminderMessage(patientName, start))}`;
  return (
    <Button asChild variant="outline" className={cn("font-semibold", className)}>
      <a href={href} target="_blank" rel="noopener noreferrer">
        <MessageCircle className="mr-1.5 size-4" aria-hidden="true" />
        Confirmar pelo WhatsApp
      </a>
    </Button>
  );
}
