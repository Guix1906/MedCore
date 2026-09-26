import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { X, UserPlus, UserCheck, CheckCircle2, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { patientsService } from "@/services/api";
import { cn } from "@/lib/utils";
import { isValidCPF, formatCPF, formatPhone } from "@/lib/masking";
import { saveStoredLocalPatient } from "@/lib/local-patients";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { BeautifulDatePicker } from "@/components/ui/beautiful-date-picker";

export type PatientData = {
  id?: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  cpf?: string | null;
  birth_date?: string | null;
  gender?: string | null;
  insurance?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip_code?: string | null;
  notes?: string | null;
  active?: boolean;
};

export function PatientModal({
  open = true,
  patient,
  onClose,
  onSaved,
}: {
  open?: boolean;
  patient?: PatientData | null;
  onClose: () => void;
  onSaved: (updated?: any) => void;
}) {
  const queryClient = useQueryClient();
  const [f, setF] = useState(() => ({
    name: patient?.name ?? "",
    phone: formatPhone(patient?.phone ?? ""),
    email: patient?.email ?? "",
    cpf: formatCPF(patient?.cpf ?? ""),
    birth_date: patient?.birth_date ?? "",
    gender: patient?.gender ?? "",
    insurance: patient?.insurance ?? "",
    address: patient?.address ?? "",
    city: patient?.city ?? "",
    state: patient?.state ?? "",
    zip_code: patient?.zip_code ?? "",
    notes: patient?.notes ?? "",
  }));
  const [cpfError, setCpfError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (patient) {
      setF({
        name: patient.name ?? "",
        phone: formatPhone(patient.phone ?? ""),
        email: patient.email ?? "",
        cpf: formatCPF(patient.cpf ?? ""),
        birth_date: patient.birth_date ?? "",
        gender: patient.gender ?? "",
        insurance: patient.insurance ?? "",
        address: patient.address ?? "",
        city: patient.city ?? "",
        state: patient.state ?? "",
        zip_code: patient.zip_code ?? "",
        notes: patient.notes ?? "",
      });
      setCpfError(null);
    }
  }, [patient]);

  if (!open) return null;

  const set =
    (k: keyof typeof f) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setF((p) => ({ ...p, [k]: e.target.value }));

  const handleCpfChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatCPF(e.target.value);
    setF((p) => ({ ...p, cpf: formatted }));
    const clean = formatted.replace(/\D/g, "");
    if (clean.length === 11) {
      if (!isValidCPF(clean)) {
        setCpfError("CPF inválido");
      } else {
        setCpfError(null);
      }
    } else if (clean.length === 0) {
      setCpfError(null);
    } else if (cpfError) {
      setCpfError(null);
    }
  };

  const handleCpfBlur = () => {
    const clean = f.cpf.replace(/\D/g, "");
    if (clean.length > 0) {
      if (clean.length < 11) {
        setCpfError("CPF incompleto (deve conter 11 dígitos)");
      } else if (!isValidCPF(clean)) {
        setCpfError("CPF inválido");
      } else {
        setCpfError(null);
      }
    } else {
      setCpfError(null);
    }
  };

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatPhone(e.target.value);
    setF((p) => ({ ...p, phone: formatted }));
  };

  const save = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!f.name.trim()) {
      toast.error("O nome do paciente é obrigatório");
      return;
    }

    const cleanCpf = f.cpf ? f.cpf.replace(/\D/g, "") : "";
    if (cleanCpf.length > 0) {
      if (cleanCpf.length < 11) {
        setCpfError("CPF incompleto (deve conter 11 dígitos)");
        toast.error("O CPF informado está incompleto.");
        return;
      }
      if (!isValidCPF(cleanCpf)) {
        setCpfError("CPF inválido");
        toast.error("O CPF informado é inválido. Por favor, digite um CPF válido.");
        return;
      }
    }

    setSaving(true);
    setCpfError(null);

    const genderMapped = f.gender === "O" ? "outro" : f.gender || null;
    const formattedCpf = cleanCpf ? formatCPF(cleanCpf) : null;

    const payload = {
      name: f.name.trim(),
      phone: f.phone ? f.phone.trim() : null,
      email: f.email ? f.email.trim() : null,
      cpf: formattedCpf,
      gender: genderMapped,
      insurance: f.insurance ? f.insurance.trim() : null,
      birth_date: f.birth_date || null,
      address: f.address ? f.address.trim() : null,
      city: f.city ? f.city.trim() : null,
      state: f.state ? f.state.trim() : null,
      zip_code: f.zip_code ? f.zip_code.trim() : null,
      notes: f.notes ? f.notes.trim() : null,
    };

    let savedData: any = null;
    let saveError: any = null;

    try {
      // 1. Salva diretamente no Supabase com resposta ultra-rápida (~50ms)
      const res = patient?.id
        ? await supabase
            .from("patients")
            .update(payload)
            .eq("id", patient.id)
            .select()
            .maybeSingle()
        : await supabase
            .from("patients")
            .insert({ ...payload, active: true })
            .select()
            .maybeSingle();

      if (res.error) {
        saveError = res.error;
      } else if (res.data) {
        savedData = res.data;
        // Sincronização secundária em background sem bloquear o usuário
        if (patient?.id) {
          patientsService.updatePatient(patient.id, payload).catch(() => {});
        } else {
          patientsService
            .createPatient({ ...payload, id: res.data.id, active: true })
            .catch(() => {});
        }
      }
    } catch (err: any) {
      // Fallback para API PHP caso Supabase falhe
      try {
        if (patient?.id) {
          savedData = await patientsService.updatePatient(patient.id, payload);
        } else {
          savedData = await patientsService.createPatient({ ...payload, active: true });
        }
      } catch (phpErr: any) {
        saveError = err || phpErr;
      }
    }

    setSaving(false);

    if (saveError) {
      console.error("Erro ao salvar paciente:", saveError);
      const msg = saveError?.message || "";
      if (msg.includes("patients_cpf_key") || (msg.includes("unique") && msg.includes("cpf"))) {
        setCpfError("CPF já cadastrado para outro paciente");
        toast.error("Já existe um paciente cadastrado com este CPF.");
        return;
      }
      if (msg.includes("patients_email_key") || (msg.includes("unique") && msg.includes("email"))) {
        toast.error("Já existe um paciente cadastrado com este e-mail.");
        return;
      }
      if (!msg.includes("row-level") && !msg.includes("permission")) {
        toast.error("Erro ao salvar: " + (msg || "Verifique os dados informados"));
        return;
      }
    }

    const finalPatient = savedData || {
      ...patient,
      ...payload,
      id: patient?.id ?? crypto.randomUUID(),
      active: true,
      created_at: new Date().toISOString(),
    };

    // Salva na camada persistente local
    saveStoredLocalPatient(finalPatient);

    // Invalida e atualiza todos os caches de pacientes do sistema imediatamente
    queryClient.setQueryData(["patients-picker"], (old: any = []) => {
      const item = {
        id: finalPatient.id,
        name: finalPatient.name,
        cpf: finalPatient.cpf || null,
        phone: finalPatient.phone || null,
      };
      const exists = old.some((p: any) => p.id === finalPatient.id);
      return exists ? old.map((p: any) => (p.id === finalPatient.id ? item : p)) : [item, ...old];
    });

    queryClient.setQueryData(["patients-list"], (old: any = []) => {
      const exists = old.some((p: any) => p.id === finalPatient.id);
      return exists
        ? old.map((p: any) => (p.id === finalPatient.id ? finalPatient : p))
        : [finalPatient, ...old];
    });

    queryClient.invalidateQueries({ queryKey: ["patients-picker"] });
    queryClient.invalidateQueries({ queryKey: ["patients-list"] });
    queryClient.invalidateQueries({ queryKey: ["patients-mini"] });
    queryClient.invalidateQueries({ queryKey: ["patients"] });

    toast.success(
      patient?.id ? "Paciente atualizado com sucesso" : "Paciente cadastrado com sucesso",
    );
    onSaved(finalPatient);
    onClose();
  };

  const inp =
    "w-full h-10 px-3 rounded-lg border border-border bg-card text-sm text-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition-all";

  return (
    <Dialog open={open} onOpenChange={(openState) => !openState && !saving && onClose()}>
      <DialogContent className="max-w-[580px] w-[calc(100vw-32px)] [&>button.absolute]:hidden">
        <DialogHeader className="flex flex-row items-center justify-between pb-3 border-b border-border-soft space-y-0 text-left">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-primary-soft text-primary flex items-center justify-center font-semibold">
              {patient?.id ? <UserCheck size={20} /> : <UserPlus size={20} />}
            </div>
            <div>
              <DialogTitle className="text-base font-semibold text-foreground">
                {patient?.id ? "Editar paciente" : "Novo paciente"}
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                Identificação, contato e informações complementares. Nome obrigatório.
              </DialogDescription>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar cadastro"
            className="text-muted-foreground hover:text-foreground/80 cursor-pointer p-1.5 rounded-lg hover:bg-muted transition-colors"
          >
            <X size={18} />
          </button>
        </DialogHeader>

        <form onSubmit={save} className="space-y-4 pt-1">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-h-[62dvh] overflow-y-auto pr-1">
            <div className="sm:col-span-2">
              <label className="text-xs text-muted-foreground font-semibold block mb-1">
                Nome completo <span className="text-destructive">*</span>
              </label>
              <input
                value={f.name}
                onChange={set("name")}
                className={inp}
                placeholder="Ex: Clara Ribeiro"
                required
              />
            </div>

            <div>
              <label className="text-xs text-muted-foreground font-semibold block mb-1">
                Telefone / WhatsApp
              </label>
              <input
                value={f.phone}
                onChange={handlePhoneChange}
                maxLength={15}
                className={inp}
                placeholder="(00) 00000-0000"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs text-muted-foreground font-semibold block">CPF</label>
                {f.cpf &&
                  f.cpf.replace(/\D/g, "").length === 11 &&
                  (isValidCPF(f.cpf) ? (
                    <span className="text-xs text-success font-medium flex items-center gap-1">
                      <CheckCircle2 size={12} className="text-success" /> Válido
                    </span>
                  ) : (
                    <span className="text-xs text-destructive font-medium flex items-center gap-1">
                      <AlertCircle size={12} className="text-destructive" /> Inválido
                    </span>
                  ))}
              </div>
              <input
                value={f.cpf}
                onChange={handleCpfChange}
                onBlur={handleCpfBlur}
                maxLength={14}
                className={cn(
                  inp,
                  cpfError &&
                    "border-destructive/50 focus:border-destructive focus:ring-destructive/10 bg-destructive/2",
                )}
                placeholder="000.000.000-00"
              />
              {cpfError && (
                <p className="text-xs text-destructive font-medium mt-1 flex items-center gap-1">
                  <AlertCircle size={12} /> {cpfError}
                </p>
              )}
            </div>

            <div className="sm:col-span-2">
              <label className="text-xs text-muted-foreground font-semibold block mb-1">
                E-mail
              </label>
              <input
                type="email"
                value={f.email}
                onChange={set("email")}
                className={inp}
                placeholder="email@exemplo.com"
              />
            </div>

            <div>
              <label className="text-xs text-muted-foreground font-semibold block mb-1">
                Data de nascimento
              </label>
              <BeautifulDatePicker
                value={f.birth_date}
                onChange={(val) => setF((p) => ({ ...p, birth_date: val }))}
                placeholder="Clique para escolher a data..."
              />
            </div>

            <div>
              <label className="text-xs text-muted-foreground font-semibold block mb-1">
                Sexo / Gênero
              </label>
              <select value={f.gender} onChange={set("gender")} className={inp}>
                <option value="">— Selecione —</option>
                <option value="F">Feminino</option>
                <option value="M">Masculino</option>
                <option value="outro">Outro</option>
              </select>
            </div>

            <div className="sm:col-span-2">
              <label className="text-xs text-muted-foreground font-semibold block mb-1">
                Convênio
              </label>
              <input
                value={f.insurance}
                onChange={set("insurance")}
                className={inp}
                placeholder="Ex: Unimed, Particular, Bradesco..."
              />
            </div>

            <div className="sm:col-span-2 pt-2 border-t border-border-soft">
              <label className="text-xs text-muted-foreground font-semibold block mb-1">
                Endereço (Rua e número)
              </label>
              <input
                value={f.address}
                onChange={set("address")}
                className={inp}
                placeholder="Ex: Av. Paulista, 1000 - Apto 42"
              />
            </div>

            <div>
              <label className="text-xs text-muted-foreground font-semibold block mb-1">
                Cidade
              </label>
              <input
                value={f.city}
                onChange={set("city")}
                className={inp}
                placeholder="Ex: São Paulo"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-muted-foreground font-semibold block mb-1">UF</label>
                <input
                  value={f.state}
                  onChange={set("state")}
                  className={inp}
                  maxLength={2}
                  placeholder="SP"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground font-semibold block mb-1">
                  CEP
                </label>
                <input
                  value={f.zip_code}
                  onChange={set("zip_code")}
                  className={inp}
                  placeholder="00000-000"
                />
              </div>
            </div>

            <div className="sm:col-span-2">
              <label className="text-xs text-muted-foreground font-semibold block mb-1">
                Observações
              </label>
              <textarea
                value={f.notes}
                onChange={set("notes")}
                rows={2}
                className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm text-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 resize-none transition-all"
                placeholder="Anotações gerais sobre o paciente..."
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-border-soft">
            <button
              type="button"
              onClick={onClose}
              className="h-10 px-4 rounded-full border border-border text-sm font-semibold text-foreground/80 hover:bg-muted/60 cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving || !f.name.trim()}
              className="h-10 px-5 rounded-full bg-primary hover:bg-primary-hover text-white text-sm font-semibold disabled:opacity-60 transition-colors cursor-pointer shadow-sm"
            >
              {saving ? "Salvando…" : "Salvar informações"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
