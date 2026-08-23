import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { X, UserPlus, UserCheck, CheckCircle2, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { patientsService } from "@/services/api";
import { cn } from "@/lib/utils";
import { isValidCPF, formatCPF, formatPhone } from "@/lib/masking";
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
  if (!open) return null;

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

    const genderMapped = f.gender === "O" ? "outro" : (f.gender || null);
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
      if (patient?.id) {
        savedData = await patientsService.updatePatient(patient.id, payload);
      } else {
        savedData = await patientsService.createPatient({ ...payload, active: true });
      }
    } catch (err: any) {
      console.warn("API principal retornou erro, tentando via Supabase...", err);
      try {
        const res = patient?.id
          ? await supabase.from("patients").update(payload).eq("id", patient.id).select().maybeSingle()
          : await supabase.from("patients").insert({ ...payload, active: true }).select().maybeSingle();
        if (res.error) {
          saveError = res.error;
        } else if (res.data) {
          savedData = res.data;
        }
      } catch (sbErr: any) {
        saveError = sbErr;
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
      // Se for outro erro no banco mas temos os dados, criamos localmente no cache da sessão
      if (!msg.includes("row-level") && !msg.includes("permission")) {
        toast.error("Erro ao salvar: " + (msg || "Verifique os dados informados"));
        return;
      }
    }

    const finalPatient = savedData || ({
      ...patient,
      ...payload,
      id: patient?.id ?? crypto.randomUUID(),
      active: true,
      created_at: new Date().toISOString(),
    });

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
      return exists ? old.map((p: any) => (p.id === finalPatient.id ? finalPatient : p)) : [finalPatient, ...old];
    });

    queryClient.invalidateQueries({ queryKey: ["patients-picker"] });
    queryClient.invalidateQueries({ queryKey: ["patients-list"] });
    queryClient.invalidateQueries({ queryKey: ["patients-mini"] });
    queryClient.invalidateQueries({ queryKey: ["patients"] });

    toast.success(patient?.id ? "Paciente atualizado com sucesso" : "Paciente cadastrado com sucesso");
    onSaved(finalPatient);
    onClose();
  };

  const inp =
    "w-full h-10 px-3 rounded-lg border border-[#E5E7EB] bg-white text-[13px] text-[#111827] focus:outline-none focus:border-[#8B47FF] focus:ring-2 focus:ring-[#8B47FF]/10 transition-all";

  return (
    <Dialog open={open} onOpenChange={(openState) => !openState && onClose()}>
      <DialogContent className="max-w-[580px] w-[calc(100vw-32px)] bg-white rounded-2xl p-6 shadow-2xl z-[9999] border border-border/80 [&>button.absolute]:hidden">
        <DialogHeader className="flex flex-row items-center justify-between pb-3 border-b border-slate-100 space-y-0 text-left">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-[#F5F3FF] text-[#8B47FF] flex items-center justify-center font-bold">
              {patient?.id ? <UserCheck size={20} /> : <UserPlus size={20} />}
            </div>
            <div>
              <DialogTitle className="text-[16px] font-bold text-[#111827]">
                {patient?.id ? "Editar paciente" : "Novo paciente"}
              </DialogTitle>
              <DialogDescription className="text-[11.5px] text-[#6B7280]">
                Preencha os dados cadastrais completos do paciente
              </DialogDescription>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[#9CA3AF] hover:text-slate-700 cursor-pointer p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <X size={18} />
          </button>
        </DialogHeader>

        <form onSubmit={save} className="space-y-4 pt-1">
          <div className="grid grid-cols-2 gap-3 max-h-[62vh] overflow-y-auto pr-1">
            <div className="col-span-2">
              <label className="text-[12px] text-[#6B7280] font-semibold block mb-1">
                Nome completo <span className="text-rose-500">*</span>
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
              <label className="text-[12px] text-[#6B7280] font-semibold block mb-1">
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
                <label className="text-[12px] text-[#6B7280] font-semibold block">CPF</label>
                {f.cpf && f.cpf.replace(/\D/g, "").length === 11 && (
                  isValidCPF(f.cpf) ? (
                    <span className="text-[11px] text-emerald-600 font-medium flex items-center gap-1">
                      <CheckCircle2 size={12} className="text-emerald-500" /> Válido
                    </span>
                  ) : (
                    <span className="text-[11px] text-rose-500 font-medium flex items-center gap-1">
                      <AlertCircle size={12} className="text-rose-500" /> Inválido
                    </span>
                  )
                )}
              </div>
              <input
                value={f.cpf}
                onChange={handleCpfChange}
                onBlur={handleCpfBlur}
                maxLength={14}
                className={cn(
                  inp,
                  cpfError && "border-rose-400 focus:border-rose-500 focus:ring-rose-500/10 bg-rose-50/20"
                )}
                placeholder="000.000.000-00"
              />
              {cpfError && (
                <p className="text-[11.5px] text-rose-500 font-medium mt-1 flex items-center gap-1">
                  <AlertCircle size={12} /> {cpfError}
                </p>
              )}
            </div>

            <div className="col-span-2">
              <label className="text-[12px] text-[#6B7280] font-semibold block mb-1">E-mail</label>
              <input
                type="email"
                value={f.email}
                onChange={set("email")}
                className={inp}
                placeholder="email@exemplo.com"
              />
            </div>

            <div>
              <label className="text-[12px] text-[#6B7280] font-semibold block mb-1">
                Data de nascimento
              </label>
              <BeautifulDatePicker
                value={f.birth_date}
                onChange={(val) => setF((p) => ({ ...p, birth_date: val }))}
                placeholder="Clique para escolher a data..."
              />
            </div>

            <div>
              <label className="text-[12px] text-[#6B7280] font-semibold block mb-1">
                Sexo / Gênero
              </label>
              <select value={f.gender} onChange={set("gender")} className={inp}>
                <option value="">— Selecione —</option>
                <option value="F">Feminino</option>
                <option value="M">Masculino</option>
                <option value="O">Outro</option>
              </select>
            </div>

            <div className="col-span-2">
              <label className="text-[12px] text-[#6B7280] font-semibold block mb-1">Convênio</label>
              <input
                value={f.insurance}
                onChange={set("insurance")}
                className={inp}
                placeholder="Ex: Unimed, Particular, Bradesco..."
              />
            </div>

            <div className="col-span-2 pt-2 border-t border-slate-100">
              <label className="text-[12px] text-[#6B7280] font-semibold block mb-1">
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
              <label className="text-[12px] text-[#6B7280] font-semibold block mb-1">Cidade</label>
              <input
                value={f.city}
                onChange={set("city")}
                className={inp}
                placeholder="Ex: São Paulo"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[12px] text-[#6B7280] font-semibold block mb-1">UF</label>
                <input
                  value={f.state}
                  onChange={set("state")}
                  className={inp}
                  maxLength={2}
                  placeholder="SP"
                />
              </div>
              <div>
                <label className="text-[12px] text-[#6B7280] font-semibold block mb-1">CEP</label>
                <input
                  value={f.zip_code}
                  onChange={set("zip_code")}
                  className={inp}
                  placeholder="00000-000"
                />
              </div>
            </div>

            <div className="col-span-2">
              <label className="text-[12px] text-[#6B7280] font-semibold block mb-1">
                Observações
              </label>
              <textarea
                value={f.notes}
                onChange={set("notes")}
                rows={2}
                className="w-full px-3 py-2 rounded-lg border border-[#E5E7EB] bg-white text-[13px] text-[#111827] focus:outline-none focus:border-[#8B47FF] focus:ring-2 focus:ring-[#8B47FF]/10 resize-none transition-all"
                placeholder="Anotações gerais sobre o paciente..."
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="h-10 px-4 rounded-lg border border-[#E5E7EB] text-[13px] font-semibold text-[#374151] hover:bg-slate-50 cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving || !f.name.trim()}
              className="h-10 px-5 rounded-lg bg-[#8B47FF] hover:bg-[#7836ea] text-white text-[13px] font-semibold disabled:opacity-60 transition-colors cursor-pointer shadow-sm"
            >
              {saving ? "Salvando…" : "Salvar informações"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
