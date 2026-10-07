-- Meta de peso por plano de acompanhamento: peso inicial, peso-alvo e altura (para IMC).
-- Colunas opcionais; planos existentes continuam válidos.
ALTER TABLE public.treatments
  ADD COLUMN IF NOT EXISTS initial_weight_kg numeric(5,2),
  ADD COLUMN IF NOT EXISTS target_weight_kg numeric(5,2),
  ADD COLUMN IF NOT EXISTS height_cm numeric(5,1);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'treatments_initial_weight_range') THEN
    ALTER TABLE public.treatments
      ADD CONSTRAINT treatments_initial_weight_range
      CHECK (initial_weight_kg IS NULL OR (initial_weight_kg > 0 AND initial_weight_kg <= 700));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'treatments_target_weight_range') THEN
    ALTER TABLE public.treatments
      ADD CONSTRAINT treatments_target_weight_range
      CHECK (target_weight_kg IS NULL OR (target_weight_kg > 0 AND target_weight_kg <= 700));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'treatments_height_range') THEN
    ALTER TABLE public.treatments
      ADD CONSTRAINT treatments_height_range
      CHECK (height_cm IS NULL OR (height_cm >= 50 AND height_cm <= 250));
  END IF;
END $$;

COMMENT ON COLUMN public.treatments.initial_weight_kg IS 'Peso no início do plano (kg)';
COMMENT ON COLUMN public.treatments.target_weight_kg IS 'Meta de peso do plano (kg)';
COMMENT ON COLUMN public.treatments.height_cm IS 'Altura do paciente (cm), para IMC';

-- Recarrega o cache de esquema da API para as colunas novas ficarem visíveis na hora
NOTIFY pgrst, 'reload schema';
