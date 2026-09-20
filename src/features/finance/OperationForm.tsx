import { createContext, useContext, useId, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { errorMessage, moneyCents } from "@/features/acompanhamentos/followup-utils";
import { refreshFinance } from "./finance-api";

export class OperationInputError extends Error {}
export const OperationLock = createContext<{
  active: string | null;
  setActive: (id: string | null) => void;
}>({
  active: null,
  setActive: () => {
    throw new Error("Controle de operacao indisponivel.");
  },
});
export const fieldClass = "w-full rounded-lg border p-2 text-sm";
export const formText = (form: FormData, name: string) => String(form.get(name) ?? "").trim();
export const formMoney = (form: FormData, name: string) => {
  try {
    return moneyCents(formText(form, name)) / 100;
  } catch (error) {
    throw new OperationInputError(errorMessage(error));
  }
};
export function Field({
  name,
  label,
  type = "text",
  value,
  options,
  minLength,
  max,
}: {
  name: string;
  label: string;
  type?: string;
  value?: string;
  options?: { id: string; name: string }[];
  minLength?: number;
  max?: string;
}) {
  return (
    <label className="block text-sm">
      {label}
      {options ? (
        <select name={name} required defaultValue={value ?? ""} className={fieldClass}>
          <option value="">Selecione</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      ) : (
        <input
          name={name}
          required
          type={type}
          defaultValue={value}
          minLength={minLength}
          max={max}
          className={fieldClass}
        />
      )}
    </label>
  );
}
export function Reason() {
  return <Field name="reason" label="Justificativa / referencia de conferencia" minLength={5} />;
}
export default function OperationForm({
  title,
  children,
  execute,
  onSuccess,
}: {
  title: string;
  children: ReactNode;
  onSuccess?: () => void;
  execute: (
    data: FormData,
    id: string,
  ) => PromiseLike<{ error: { message: string; code?: string } | null }>;
}) {
  const qc = useQueryClient();
  const key = useId();
  const lock = useContext(OperationLock);
  const request = useRef<{ data: FormData; id: string } | null>(null);
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [generation, setGeneration] = useState(0);
  const blocked = lock.active !== null && lock.active !== key;
  return (
    <form
      className="space-y-3 rounded-xl border bg-white p-4"
      onSubmit={async (event) => {
        event.preventDefault();
        if (inFlight.current || blocked) return;
        request.current ??= { data: new FormData(event.currentTarget), id: crypto.randomUUID() };
        inFlight.current = true;
        setBusy(true);
        setSubmitted(true);
        lock.setActive(key);
        try {
          const result = await execute(request.current.data, request.current.id);
          if (result.error) {
            if (
              /^(P0001|22|23|42501|PGRST202$|PGRST203$|PGRST301$)/.test(result.error.code ?? "")
            ) {
              request.current = null;
              setSubmitted(false);
              lock.setActive(null);
            }
            throw result.error;
          }
          request.current = null;
          setSubmitted(false);
          lock.setActive(null);
          setGeneration((g) => g + 1);
          await refreshFinance(qc);
          onSuccess?.();
          toast.success("Operacao registrada. Nenhuma transacao bancaria foi executada.");
        } catch (error) {
          if (error instanceof OperationInputError) {
            request.current = null;
            setSubmitted(false);
            lock.setActive(null);
          }
          toast.error(errorMessage(error));
        } finally {
          inFlight.current = false;
          setBusy(false);
        }
      }}
    >
      <h3 className="font-semibold">{title}</h3>
      <fieldset
        key={generation}
        disabled={busy || submitted || blocked}
        className="grid gap-3 sm:grid-cols-2"
      >
        {children}
      </fieldset>
      {submitted && (
        <p role="alert" className="text-sm text-amber-800">
          Solicitacao enviada. Se a resposta falhar, repita aqui com a mesma identificacao antes de
          sair.
        </p>
      )}
      <button
        disabled={busy || blocked}
        className="rounded-lg bg-purple-600 px-4 py-2 text-white disabled:opacity-50"
      >
        {busy ? "Registrando..." : submitted ? "Repetir mesma solicitacao" : "Confirmar"}
      </button>
    </form>
  );
}
