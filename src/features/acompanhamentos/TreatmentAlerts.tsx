import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { currency, errorMessage, formatClinicalDate, localDate } from "./followup-utils";

export default function TreatmentAlerts({
  scope = "all",
  treatmentId,
}: {
  scope?: "all" | "clinical" | "financial";
  treatmentId?: string;
}) {
  const query = useQuery({
    queryKey: ["treatment-alerts"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_treatment_alerts");
      if (error) throw error;
      return data;
    },
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
  if (query.isPending)
    return <p className="p-3 text-sm text-slate-500">Carregando alertas dos planos...</p>;
  if (query.error)
    return (
      <p role="alert" className="p-3 text-sm text-red-700">
        Falha nos alertas dos planos: {errorMessage(query.error)}
      </p>
    );
  const alerts = query.data
    .filter(
      (a) =>
        (!treatmentId || a.treatment_id === treatmentId) &&
        (scope === "all" ||
          (scope === "financial" ? a.kind === "pagamento" : a.kind !== "pagamento")),
    )
    .sort((a, b) => (a.target_date || "9999").localeCompare(b.target_date || "9999"));
  return (
    <section
      className="rounded-2xl border border-amber-200 bg-amber-50 p-4 space-y-2"
      aria-label="Alertas de acompanhamento"
    >
      <h3 className="font-semibold text-sm">Alertas dos planos ({alerts.length})</h3>
      {alerts.length === 0 && (
        <p className="text-sm text-slate-600">Nenhum alerta de vencimento ou conclusão.</p>
      )}
      <div className="max-h-64 overflow-y-auto space-y-2">
        {alerts.map((a) => (
          <div key={a.id} className="text-sm border-t border-amber-200 pt-2">
            <p className="font-medium">
              {a.patient_name} - {a.title}
            </p>
            <p>
              {a.kind === "concluido"
                ? "Plano concluído"
                : `${a.kind === "retorno" ? "Retorno necessário" : a.kind === "pagamento" ? "Pagamento" : "Protocolo"}: ${formatClinicalDate(a.target_date)}${a.target_date && a.target_date < localDate() ? " (vencido)" : a.target_date === localDate() ? " (hoje)" : " (a vencer)"}`}
              {a.amount !== null && ` - ${currency(a.amount)}`}
            </p>
            {a.kind === "pagamento" ? (
              <Link to="/financeiro" className="text-purple-700 underline">
                Abrir Financeiro
              </Link>
            ) : (
              <Link
                to="/acompanhamentos/$id"
                params={{ id: a.treatment_id }}
                className="text-purple-700 underline"
              >
                Abrir acompanhamento
              </Link>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
