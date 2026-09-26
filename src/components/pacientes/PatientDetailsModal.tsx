import { BrandLoader, EmptyState } from "@/components/ui-app";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { usePatient } from "@/hooks/use-patient";
import { usePermissions } from "@/hooks/use-permissions";
import { patientProfileData } from "@/lib/patient-display";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { PatientFullProfileView, type PatientProfileData } from "./PatientFullProfileView";
import { PatientModal } from "./PatientModal";

export type PatientDetailsData = PatientProfileData;

export function PatientDetailsModal({
  open,
  onOpenChange,
  patientData,
  onEdit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patientData?: Partial<PatientDetailsData> | null;
  onEdit?: () => void;
}) {
  const patient = usePatient(patientData?.id, open);
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const [editing, setEditing] = useState(false);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[90dvh] w-[calc(100vw-24px)] max-w-6xl flex-col gap-0 overflow-hidden p-0">
        <DialogTitle className="sr-only">Ficha do paciente</DialogTitle>
        <DialogDescription className="sr-only">
          Cadastro, histórico clínico, planos e financeiro do paciente selecionado.
        </DialogDescription>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {!patientData?.id ? (
            <EmptyState
              title="Paciente não vinculado"
              description="Este agendamento ainda não está vinculado a um cadastro. Edite o agendamento para selecionar o paciente correto."
              className="m-6"
            />
          ) : patient.isPending ? (
            <div className="flex h-full items-center justify-center">
              <BrandLoader label="Carregando paciente…" />
            </div>
          ) : patient.error ? (
            <EmptyState
              title="Não foi possível carregar a ficha"
              description="Verifique sua conexão e tente novamente."
              action={
                <Button variant="outline" onClick={() => void patient.refetch()}>
                  Tentar novamente
                </Button>
              }
              className="m-6"
            />
          ) : patient.data ? (
            <PatientFullProfileView
              key={patient.data.id}
              patient={patientProfileData(patient.data)}
              onBack={() => onOpenChange(false)}
              onEdit={can("patients.manage") ? (onEdit ?? (() => setEditing(true))) : undefined}
            />
          ) : (
            <EmptyState
              title="Paciente não encontrado"
              description="O cadastro não está disponível para este acesso."
              className="m-6"
            />
          )}
        </div>
        {editing && patient.data && (
          <PatientModal
            patient={patient.data}
            onClose={() => setEditing(false)}
            onSaved={() => {
              void queryClient.invalidateQueries({
                queryKey: ["patient-profile", patientData?.id],
              });
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
