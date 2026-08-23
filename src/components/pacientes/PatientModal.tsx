import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { X, UserPlus, UserCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { patientsService } from "@/services/api";
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

  useEffect(() => {
    if (open) {
      setF({
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
    }
  }, [patient, open]);

  const set =
    (k: keyof typeof f) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setF((p) => ({ ...p, [k]: e.target.value }));

  const save = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
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
    } catch (err: any) {
      const res = patient?.id
        ? await supabase.from("patients").update(payload).eq("id", patient.id).select().maybeSingle()
        : await supabase.from("patients").insert({ ...payload, active: true }).select().maybeSingle();
      savedData = res.data;
      saveError = res.error;
    }

    setSaving(false);
    const finalPatient = savedData || ({ ...patient, ...payload, id: patient?.id ?? crypto.randomUUID() });

    if (!saveError) {
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
    } else {
      toast.error("Erro: " + (saveError?.message || "Não foi possível salvar"));
    }
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
                autoFocus
                required
              />
            </div>

            <div>
              <label className="text-[12px] text-[#6B7280] font-semibold block mb-1">
                Telefone / WhatsApp
              </label>
              <input
                value={f.phone}
                onChange={set("phone")}
                className={inp}
                placeholder="(00) 00000-0000"
              />
            </div>

            <div>
              <label className="text-[12px] text-[#6B7280] font-semibold block mb-1">CPF</label>
              <input
                value={f.cpf}
                onChange={set("cpf")}
                className={inp}
                placeholder="000.000.000-00"
              />
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
