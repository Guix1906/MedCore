import type { Patient } from "@/services/api/patients.service";
import type { PatientProfileData } from "@/components/pacientes/PatientFullProfileView";

export function patientAge(
  birthDate: string | null | undefined,
  today = new Date(),
): number | null {
  if (!birthDate) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/.exec(birthDate);
  if (!match) return null;
  const [, year, month, day] = match.map(Number);
  const birth = new Date(year, month - 1, day);
  if (
    birth.getFullYear() !== year ||
    birth.getMonth() !== month - 1 ||
    birth.getDate() !== day ||
    birth > today
  )
    return null;
  const birthdayPending =
    today.getMonth() < month - 1 || (today.getMonth() === month - 1 && today.getDate() < day);
  return today.getFullYear() - year - Number(birthdayPending);
}

export function patientProfileData(patient: Patient): PatientProfileData {
  const age = patientAge(patient.birth_date);
  const birthDate =
    age === null || !patient.birth_date
      ? null
      : patient.birth_date.slice(0, 10).split("-").reverse().join("/");
  return {
    ...patient,
    birth_date: birthDate,
    age: age === null ? null : `${age} anos`,
    cep: patient.zip_code,
    created_at: patient.created_at ? new Date(patient.created_at).toLocaleString("pt-BR") : null,
  };
}
