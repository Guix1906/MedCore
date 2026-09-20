import { useContext, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { errorMessage, localDate } from "@/features/acompanhamentos/followup-utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import type { FinanceSnapshot, FinancialTitle } from "./finance-schema";
import OperationForm, {
  Field,
  OperationLock,
  fieldClass,
  formMoney,
  formText,
  OperationInputError,
} from "./OperationForm";

export default function NewTitle({
  finance,
  type,
  onClose,
}: {
  finance: FinanceSnapshot;
  type: FinancialTitle["type"];
  onClose: () => void;
}) {
  const { active } = useContext(OperationLock);
  const scopes = finance.scopes.filter((s) => s.can_create && (type === "receita" || s.can_pay));
  const [scope, setScope] = useState(scopes[0]?.id ?? "legacy");
  const [patient, setPatient] = useState("");
  const [payer, setPayer] = useState("");
  const company = scope === "legacy" ? null : scope;
  const categories = useQuery({
    queryKey: ["financial-title-categories"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("finance_categories")
        .select("id,name,type")
        .order("name");
      if (error) throw error;
      return data;
    },
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !active) onClose();
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {type === "receita" ? "Nova conta a receber" : "Nova conta a pagar"}
          </DialogTitle>
          <DialogDescription>
            Cadastre a obrigação. O caixa só será movimentado ao registrar o pagamento efetivo.
          </DialogDescription>
        </DialogHeader>
        {categories.error && (
          <p role="alert" className="text-sm text-red-700">
            Não foi possível carregar as categorias: {errorMessage(categories.error)}{" "}
            <button onClick={() => categories.refetch()} className="underline">
              Tentar novamente
            </button>
          </p>
        )}
        <OperationForm
          title="Dados da conta"
          onSuccess={onClose}
          execute={async (form, id) => {
            if (!scopes.some((s) => s.id === company))
              throw new OperationInputError("Selecione uma clínica autorizada.");
            const result = await supabase.rpc("create_financial_title", {
              p_id: id,
              p_type: type,
              p_amount: formMoney(form, "amount"),
              p_due_date: formText(form, "due"),
              p_competence_date: formText(form, "competence"),
              p_description: formText(form, "description"),
              p_category: formText(form, "category"),
              p_company_id: company,
              p_patient_id: type === "receita" ? patient || null : null,
              p_payer_name: formText(form, "payer"),
            });
            return result;
          }}
        >
          {scopes.length > 1 && (
            <label className="text-sm">
              Clínica
              <select
                className={fieldClass}
                value={scope}
                onChange={(e) => {
                  setScope(e.target.value);
                  setPatient("");
                  setPayer("");
                }}
              >
                {scopes.map((s) => (
                  <option key={s.id ?? "legacy"} value={s.id ?? "legacy"}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <Field name="description" label="Descrição administrativa" />
          <Field name="amount" label="Valor (R$)" />
          <Field name="due" label="Vencimento" type="date" value={localDate()} />
          <Field name="competence" label="Competência do serviço / despesa" type="date" />
          <Field
            name="category"
            label="Categoria"
            options={(categories.data ?? [])
              .filter((c) => c.type === (type === "receita" ? "income" : "expense"))
              .map((c) => ({ id: c.name, name: c.name }))}
          />
          {type === "receita" && (
            <label className="text-sm">
              Paciente (opcional)
              <select
                className={fieldClass}
                value={patient}
                onChange={(e) => {
                  setPatient(e.target.value);
                  const selected = finance.patients.find((p) => p.id === e.target.value);
                  if (selected) setPayer(selected.name);
                }}
              >
                <option value="">Sem vínculo</option>
                {finance.patients
                  .filter((p) => p.company_id === company)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </label>
          )}
          <label className="text-sm">
            {type === "receita" ? "Pagador" : "Fornecedor / favorecido"}
            <input
              name="payer"
              required
              className={fieldClass}
              value={payer}
              onChange={(e) => setPayer(e.target.value)}
            />
          </label>
          <p className="text-xs text-slate-500 sm:col-span-2">
            Planos, entrada e parcelamento são configurados em Acompanhamentos. Não recadastre
            cobranças já geradas pela agenda ou pelos planos. Categorias são cadastradas em
            Configurações.
          </p>
        </OperationForm>
      </DialogContent>
    </Dialog>
  );
}
