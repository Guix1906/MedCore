-- ============================================================================
-- Migração: Permissão e função para exclusão de evoluções de acompanhamento
-- e prescrições clínicas
-- ============================================================================

-- 1. Permissões na tabela treatment_evolutions
GRANT DELETE ON public.treatment_evolutions TO authenticated;

DROP POLICY IF EXISTS treatment_evolution_delete ON public.treatment_evolutions;
CREATE POLICY treatment_evolution_delete ON public.treatment_evolutions
  FOR DELETE TO authenticated
  USING (true);

-- 2. Função RPC segura com SECURITY DEFINER para garantir exclusão sem restrição de RLS
CREATE OR REPLACE FUNCTION public.delete_treatment_evolution(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_id IS NULL THEN
    RAISE EXCEPTION 'Identificador da evolução obrigatório';
  END IF;

  DELETE FROM public.treatment_evolutions WHERE id = p_id;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_treatment_evolution(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_treatment_evolution(uuid) TO authenticated;

-- 3. Permissões de exclusão na tabela prescriptions
GRANT DELETE ON public.prescriptions TO authenticated;

DROP POLICY IF EXISTS prescriptions_delete ON public.prescriptions;
CREATE POLICY prescriptions_delete ON public.prescriptions
  FOR DELETE TO authenticated
  USING (true);
