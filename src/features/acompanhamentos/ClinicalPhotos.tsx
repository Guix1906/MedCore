import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { ClinicalPhoto } from "./followup-schema";
import { errorMessage, formatClinicalDate, localDate } from "./followup-utils";

const input = "w-full rounded-lg border border-border p-2 text-sm";
const bucket = "treatment-photos";

function PrivateImage({ photo }: { photo: ClinicalPhoto }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let disposed = false;
    let objectUrl = "";
    supabase.storage
      .from(bucket)
      .download(photo.storage_path)
      .then(({ data, error }) => {
        if (disposed) return;
        if (error) {
          setError(error.message);
          return;
        }
        objectUrl = URL.createObjectURL(data);
        setUrl(objectUrl);
      })
      .catch((error) => {
        if (!disposed) setError(errorMessage(error));
      });
    return () => {
      disposed = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [photo.storage_path]);
  return (
    <figure className="rounded-xl border bg-card p-3 space-y-2">
      {error ? (
        <p role="alert" className="text-destructive text-sm">
          Não foi possível carregar a foto: {error}
        </p>
      ) : url ? (
        <a href={url} target="_blank" rel="noreferrer">
          <img src={url} alt={photo.title} className="h-64 w-full object-contain rounded-lg" />
        </a>
      ) : (
        <p>Carregando imagem...</p>
      )}
      <figcaption className="text-sm">
        <strong>{photo.title}</strong> - {formatClinicalDate(photo.taken_on)}
        <p className="whitespace-pre-wrap">Objetivo: {photo.objective || "Não informado"}</p>
      </figcaption>
    </figure>
  );
}

export default function ClinicalPhotos({
  treatmentId,
  patientId,
  objective = "",
}: {
  treatmentId?: string;
  patientId?: string;
  objective?: string | null;
}) {
  const qc = useQueryClient();
  const [selectedPlan, setSelectedPlan] = useState(treatmentId || "");
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [takenOn, setTakenOn] = useState(localDate());
  const [photoObjective, setPhotoObjective] = useState(objective || "");
  const [busy, setBusy] = useState(false);
  const [fileKey, setFileKey] = useState(0);
  const plans = useQuery({
    queryKey: ["photo-plans", patientId],
    enabled: !treatmentId && !!patientId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("treatments")
        .select("id,title,objective")
        .eq("patient_id", patientId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
  const ids = treatmentId ? [treatmentId] : (plans.data || []).map((p) => p.id);
  const photos = useQuery({
    queryKey: ["treatment-photos", treatmentId || patientId, ids],
    enabled: ids.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("treatment_photos")
        .select("*")
        .in("treatment_id", ids)
        .order("taken_on", { ascending: true })
        .order("created_at");
      if (error) throw error;
      return data;
    },
  });

  const upload = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedPlan || !file || !title.trim()) {
      toast.error("Selecione o plano, uma imagem e informe a descrição.");
      return;
    }
    if (
      !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
      file.size > 10 * 1024 * 1024
    ) {
      toast.error("Use JPEG, PNG ou WebP de até 10 MB.");
      return;
    }
    if (!takenOn || takenOn > localDate()) {
      toast.error("A data da foto não pode estar no futuro.");
      return;
    }
    setBusy(true);
    const extension = file.type === "image/jpeg" ? "jpg" : file.type.split("/")[1];
    const path = `${selectedPlan}/${crypto.randomUUID()}.${extension}`;
    let uploaded = false;
    try {
      const result = await supabase.storage
        .from(bucket)
        .upload(path, file, { contentType: file.type, upsert: false });
      if (result.error) throw result.error;
      uploaded = true;
      const { error } = await supabase.from("treatment_photos").insert({
        treatment_id: selectedPlan,
        storage_path: path,
        taken_on: takenOn,
        title: title.trim(),
        objective: photoObjective.trim(),
      });
      if (error) throw error;
      uploaded = false;
      setFile(null);
      setTitle("");
      setFileKey((k) => k + 1);
      await qc.invalidateQueries({ queryKey: ["treatment-photos"] });
      toast.success("Foto salva no histórico do paciente.");
    } catch (error) {
      toast.error(errorMessage(error));
      if (uploaded) {
        const cleanup = await supabase.storage.from(bucket).remove([path]);
        if (cleanup.error)
          toast.error(`Não foi possível remover o envio incompleto: ${cleanup.error.message}`);
      }
    } finally {
      setBusy(false);
    }
  };

  if (!treatmentId && !patientId)
    return <p role="alert">Selecione um paciente salvo para visualizar as fotos.</p>;
  return (
    <section className="rounded-2xl border bg-card p-5 space-y-4">
      <h3 className="font-semibold">Fotos clínicas e objetivo do paciente</h3>
      {plans.error && (
        <p role="alert" className="text-destructive">
          {errorMessage(plans.error)}
        </p>
      )}
      <form onSubmit={upload} className="grid sm:grid-cols-2 gap-3">
        {!treatmentId && (
          <label className="text-sm">
            Plano de acompanhamento
            <select
              required
              className={input}
              value={selectedPlan}
              onChange={(e) => {
                setSelectedPlan(e.target.value);
                setPhotoObjective(
                  plans.data?.find((p) => p.id === e.target.value)?.objective || "",
                );
              }}
            >
              <option value="">Selecione um plano</option>
              {plans.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="text-sm">
          Imagem (JPEG, PNG ou WebP, até 10 MB)
          <input
            key={fileKey}
            required
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className={input}
            onChange={(e) => setFile(e.target.files?.[0] || null)}
          />
        </label>
        <label className="text-sm">
          Data da foto
          <input
            required
            type="date"
            max={localDate()}
            className={input}
            value={takenOn}
            onChange={(e) => setTakenOn(e.target.value)}
          />
        </label>
        <label className="text-sm">
          Descrição / região fotografada
          <input
            required
            className={input}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label className="text-sm">
          Objetivo registrado nesta foto
          <textarea
            className={input}
            value={photoObjective}
            onChange={(e) => setPhotoObjective(e.target.value)}
          />
        </label>
        <button
          disabled={busy || !selectedPlan}
          className="rounded-xl bg-primary text-white p-2 disabled:opacity-50 self-end"
        >
          {busy ? "Salvando..." : "Adicionar foto"}
        </button>
      </form>
      <p className="text-xs text-muted-foreground">
        Imagens privadas, vinculadas ao paciente pelo plano. Registros em ordem cronológica para
        comparação antes/depois.
      </p>
      {photos.error && (
        <p role="alert" className="text-destructive">
          {errorMessage(photos.error)}
        </p>
      )}
      {photos.isFetching && <p>Carregando fotos...</p>}
      {!photos.error && !photos.isFetching && !photos.data?.length && (
        <p className="text-sm text-muted-foreground">
          Nenhuma foto registrada. No prontuário, selecione um plano existente para adicionar fotos.
        </p>
      )}
      <div className="grid sm:grid-cols-2 gap-4">
        {photos.data?.map((photo) => (
          <PrivateImage key={photo.id} photo={photo} />
        ))}
      </div>
    </section>
  );
}
