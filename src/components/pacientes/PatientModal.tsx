import { useState } from "react";
import { X, UserPlus, UserCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { patientsService } from "@/services/api";

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
  patient,
  onClose,
  onSaved,
}: {
  patient?: PatientData | null;
  onClose: () => void;
  onSaved: (updated?: any) => void;
}) {
  const [f, setF] = useState({
    name: patient?.name ?? "",
    phone: patient?.phone ?? "",
    email: patient?.email ?? "",
    cpf: patient?.cpf ?? "",
    birth_date: patient?.birth_date ?? "",
    gender: patient?.gender ?? "",
    insurance: patient?.insurance ?? "",
    address: patient?.address ?? "",
    city: patient?.city ?? "",
    state: patient?.state ?? "",
    zip_code: patient?.zip_code ?? "",
    notes: patient?.notes ?? "",
  });
  const [saving, setSaving] = useState(false);

  const set =
    (k: keyof typeof f) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setF((p) => ({ ...p, [k]: e.target.value }));

  const save = async () => {
    if (!f.name.trim()) {
      toast.error("O nome do paciente é obrigatório");
      return;
    }
    setSaving(true);
    const payload = {
      name: f.name.trim(),
      phone: f.phone || null,
      email: f.email || null,
      cpf: f.cpf || null,
      gender: f.gender || null,
      insurance: f.insurance || null,
      birth_date: f.birth_date || null,
      address: f.address || null,
      city: f.city || null,
      state: f.state || null,
      zip_code: f.zip_code || null,
      notes: f.notes || null,
    };
    let savedData: any = null;
    let saveError: any = null;

    try {
      if (patient?.id) {
        savedData = await patientsService.updatePatient(patient.id, payload);
      } else {
        savedData = await patientsService.createPatient({ ...payload, active: true });
      }
    } catch (e: any) {
      const res = patient?.id
        ? await supabase.from("patients").update(payload).eq("id", patient.id).select().maybeSingle()
        : await supabase.from("patients").insert({ ...payload, active: true }).select().maybeSingle();
      savedData = res.data;
      saveError = res.error;
    }

    setSaving(false);
    if (!saveError && savedData) {
      toast.success(patient?.id ? "Paciente atualizado com sucesso" : "Paciente cadastrado com sucesso");
      onSaved(savedData);
      onClose();
    } else if (!saveError) {
      toast.success(patient?.id ? "Paciente atualizado" : "Paciente cadastrado");
      onSaved({ ...patient, ...payload, id: patient?.id ?? "" });
      onClose();
    } else {
      toast.error("Erro: " + saveError.message);
    }
  };

  const inp =
    "w-full h-10 px-3 rounded-lg border border-[#E5E7EB] text-[13px] focus:outline-none focus:border-[#8B47FF]";

  return (
    <div
      className="fixed inset-0 bg-black/40 z-[9999] flex items-center justify-center p-4 overflow-y-auto"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-[560px] bg-white rounded-2xl p-6 shadow-2xl my-auto">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-[#F5F3FF] text-[#8B47FF] flex items-center justify-center">
              {patient?.id ? <UserCheck size={18} /> : <UserPlus size={18} />}
            </div>
            <h2 className="text-[16px] font-bold text-[#111827]">
              {patient?.id ? "Editar paciente" : "Novo paciente"}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-[#9CA3AF] hover:text-slate-700 cursor-pointer p-1 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3 max-h-[70vh] overflow-y-auto pr-1">
          <div className="col-span-2">
            <label className="text-[12px] text-[#6B7280] font-medium">Nome completo *</label>
            <input
              value={f.name}
              onChange={set("name")}
              className={inp}
              placeholder="Ex: Clara Ribeiro"
              autoFocus
            />
          </div>

          <div>
            <label className="text-[12px] text-[#6B7280] font-medium">Telefone / WhatsApp</label>
            <input
              value={f.phone}
              onChange={set("phone")}
              className={inp}
              placeholder="(00) 00000-0000"
            />
          </div>

          <div>
            <label className="text-[12px] text-[#6B7280] font-medium">CPF</label>
            <input
              value={f.cpf}
              onChange={set("cpf")}
              className={inp}
              placeholder="000.000.000-00"
            />
          </div>

          <div className="col-span-2">
            <label className="text-[12px] text-[#6B7280] font-medium">E-mail</label>
            <input
              type="email"
              value={f.email}
              onChange={set("email")}
              className={inp}
              placeholder="email@exemplo.com"
            />
          </div>

          <div>
            <label className="text-[12px] text-[#6B7280] font-medium">Data de nascimento</label>
            <input
              type="date"
              value={f.birth_date}
              onChange={set("birth_date")}
              className={inp}
            />
          </div>

          <div>
            <label className="text-[12px] text-[#6B7280] font-medium">Sexo / Gênero</label>
            <select value={f.gender} onChange={set("gender")} className={inp}>
              <option value="">— Selecione —</option>
              <option value="F">Feminino</option>
              <option value="M">Masculino</option>
              <option value="O">Outro</option>
            </select>
          </div>

          <div className="col-span-2">
            <label className="text-[12px] text-[#6B7280] font-medium">Convênio</label>
            <input
              value={f.insurance}
              onChange={set("insurance")}
              className={inp}
              placeholder="Ex: Unimed, Particular, Bradesco..."
            />
          </div>

          <div className="col-span-2 pt-1 border-t border-slate-100">
            <label className="text-[12px] text-[#6B7280] font-medium">Endereço (Rua e número)</label>
            <input
              value={f.address}
              onChange={set("address")}
              className={inp}
              placeholder="Ex: Av. Paulista, 1000 - Apto 42"
            />
          </div>

          <div>
            <label className="text-[12px] text-[#6B7280] font-medium">Cidade</label>
            <input
              value={f.city}
              onChange={set("city")}
              className={inp}
              placeholder="Ex: São Paulo"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[12px] text-[#6B7280] font-medium">UF</label>
              <input
                value={f.state}
                onChange={set("state")}
                className={inp}
                maxLength={2}
                placeholder="SP"
              />
            </div>
            <div>
              <label className="text-[12px] text-[#6B7280] font-medium">CEP</label>
              <input
                value={f.zip_code}
                onChange={set("zip_code")}
                className={inp}
                placeholder="00000-000"
              />
            </div>
          </div>

          <div className="col-span-2">
            <label className="text-[12px] text-[#6B7280] font-medium">Observações</label>
            <textarea
              value={f.notes}
              onChange={set("notes")}
              rows={2}
              className="w-full px-3 py-2 rounded-lg border border-[#E5E7EB] text-[13px] focus:outline-none focus:border-[#8B47FF] resize-none"
              placeholder="Anotações gerais sobre o paciente..."
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-5 pt-3 border-t border-slate-100">
          <button
            onClick={onClose}
            className="h-10 px-4 rounded-lg border border-[#E5E7EB] text-[13px] font-semibold text-[#374151] hover:bg-slate-50 cursor-pointer"
          >
            Cancelar
          </button>
          <button
            onClick={save}
            disabled={saving || !f.name.trim()}
            className="h-10 px-5 rounded-lg bg-[#8B47FF] hover:bg-[#7836ea] text-white text-[13px] font-semibold disabled:opacity-60 transition-colors cursor-pointer"
          >
            {saving ? "Salvando…" : "Salvar informações"}
          </button>
        </div>
      </div>
    </div>
  );
}
