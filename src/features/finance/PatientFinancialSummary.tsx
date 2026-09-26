import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getFinancialSnapshot } from "./finance-api";
import { remaining, titleStatus } from "./finance-math";
import PaymentHistory from "./PaymentHistory";
import {
  currency,
  errorMessage,
  formatClinicalDate,
  localDate,
} from "@/features/acompanhamentos/followup-utils";

export default function PatientFinancialSummary({ patientId }: { patientId: string }) {
  const query = useQuery({ queryKey: ["financial-snapshot"], queryFn: getFinancialSnapshot });
  const [selected, setSelected] = useState("");
  if (query.isPending) return <p>Carregando financeiro...</p>;
  if (query.error)
    return (
      <p role="alert" className="text-destructive">
        {errorMessage(query.error)}
      </p>
    );
  if (!query.data.scopes.length) return <p role="alert">Sem permissão financeira.</p>;
  const titles = query.data.titles.filter((t) => t.patient_id === patientId);
  const current = titles.find((t) => t.id === selected);
  return (
    <div className="space-y-3">
      {!titles.length && <p>Nenhuma cobrança vinculada ao paciente.</p>}
      {titles.map((t) => (
        <article className="rounded-lg border p-3 text-sm" key={t.id}>
          <strong>{t.description || "Lançamento"}</strong>
          <p>
            {t.type} · Vencimento: {formatClinicalDate(t.due_date)}
          </p>
          <p>
            Original: {currency(t.amount)} · Liquidado: {currency(t.paid_amount)} · Saldo:{" "}
            {currency(remaining(t))}
          </p>
          <p>
            {titleStatus(t, localDate())} · Pagador: {t.payer_name || "Não informado"}
          </p>
          <button className="text-primary underline" onClick={() => setSelected(t.id)}>
            Baixas e histórico
          </button>
        </article>
      ))}
      {current && (
        <PaymentHistory
          key={current.id}
          title={current}
          data={query.data}
          onClose={() => setSelected("")}
        />
      )}
    </div>
  );
}
