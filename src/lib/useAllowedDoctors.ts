import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type DoctorRef = { id: string; name: string; specialty: string | null };

export type AccessProfile = {
  role: "admin" | "medico" | "secretaria" | "recepcionista" | "enfermeiro";
  selfId: string;
  allowedDoctorIds: string[];
  allowedDoctors: DoctorRef[];
  isRestricted: boolean;
  loading: boolean;
};

const DOCTORS_QUERY_KEY = ["allowed-doctors"] as const;

export function useAllowedDoctors(): AccessProfile {
  const queryClient = useQueryClient();

  // Cache doctors list por 10min
  const doctorsQuery = useQuery({
    queryKey: DOCTORS_QUERY_KEY,
    queryFn: async () => {
      const { data } = await supabase
        .from("doctors")
        .select("id, name, specialty")
        .eq("active", true)
        .order("name");
      return (data ?? []) as DoctorRef[];
    },
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
  });

  // Get current user's doctor record — cache separado por user id
  const { data: session } = useQuery({
    queryKey: ["auth", "session"],
    queryFn: async () => {
      const { data } = await supabase.auth.getSession();
      return data.session;
    },
    staleTime: 30 * 60_000,
    gcTime: 60 * 60_000,
  });

  const meQuery = useQuery({
    queryKey: ["doctor-me", session?.user?.id],
    queryFn: async () => {
      if (!session?.user?.id) return null;
      const { data } = await supabase
        .from("doctors")
        .select("id, role, name, specialty")
        .eq("auth_id", session.user!.id)
        .maybeSingle();
      return data;
    },
    enabled: !!session?.user?.id,
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
  });

  const doctors = doctorsQuery.data ?? [];
  const me = meQuery.data;

  if (meQuery.isLoading || doctorsQuery.isLoading) {
    return {
      role: "medico",
      selfId: "",
      allowedDoctorIds: [],
      allowedDoctors: [],
      isRestricted: false,
      loading: true,
    };
  }

  if (!me) {
    return {
      role: "admin",
      selfId: doctors[0]?.id ?? "",
      allowedDoctorIds: doctors.map((d) => d.id),
      allowedDoctors: doctors,
      isRestricted: false,
      loading: false,
    };
  }

  return {
    role: (me.role as AccessProfile["role"]) ?? "medico",
    selfId: me.id,
    allowedDoctorIds: doctors.map((d) => d.id),
    allowedDoctors: doctors,
    isRestricted: false,
    loading: false,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyDoctorFilter<T extends { in: (...a: any[]) => any; eq: (...a: any[]) => any }>(
  query: T,
  allowedDoctorIds: string[],
  column = "doctor_id",
): T {
  if (allowedDoctorIds.length === 0) {
    return query.eq(column, "00000000-0000-0000-0000-000000000000") as T;
  }
  return query.in(column, allowedDoctorIds) as T;
}
