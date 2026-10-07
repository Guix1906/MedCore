-- Meta de peso como variação (kg a perder: negativo; a ganhar: positivo). O peso-alvo em kg
-- é calculado pelo sistema quando o peso inicial for informado (peso inicial + variação).
ALTER TABLE public.treatments
  ADD COLUMN IF NOT EXISTS weight_goal_change_kg numeric(5,2);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'treatments_weight_goal_change_range') THEN
    ALTER TABLE public.treatments
      ADD CONSTRAINT treatments_weight_goal_change_range
      CHECK (weight_goal_change_kg IS NULL OR (weight_goal_change_kg <> 0 AND weight_goal_change_kg BETWEEN -300 AND 300));
  END IF;
END $$;

COMMENT ON COLUMN public.treatments.weight_goal_change_kg IS
  'Meta de variação de peso do plano em kg (negativo = perder, positivo = ganhar)';

-- Metas já escritas no objetivo dos planos existentes (levantamento de 07/10/2026).
-- Só preenche onde ainda não há meta; planos de "definição" ficam sem meta em kg.
UPDATE public.treatments AS t
SET weight_goal_change_kg = v.change
FROM (VALUES
  ('86998812-a5e3-4bc6-a953-6b3e6a5821a9'::uuid, -10.0),  -- Andre: perder 10kgs de gordura
  ('eb29bb93-124b-4b99-9124-daba3c2a0bfa'::uuid, -20.0),  -- Kayro: -20KG
  ('121502b7-410d-4109-bcaf-22680c1afce2'::uuid, -15.0),  -- Vandeks: - 15kgs
  ('37a0ae70-e24b-4eb6-859c-5f386a4b3242'::uuid,  -9.0),  -- Ivilla: - 9kgs de gordura + massa muscular
  ('77974471-5218-4193-97eb-e85fc9733720'::uuid,  -7.0),  -- Eliana: -7 kgs de gordura
  ('a14c44e7-2ee8-4a2b-9d1e-7cdda7d1fa1e'::uuid,  -8.5),  -- Julyana: -8,5 KG gordura + 500 g massa
  ('83094b3d-e769-403f-b8b1-6187b36fcfbc'::uuid,   5.0),  -- Pedro: +5KG MASSA
  ('836b7be4-6043-4946-9b37-961b19f7db5e'::uuid, -15.0),  -- Ithanna: - 15kgs
  ('a9503f48-d750-40b4-879d-93b03a9ae408'::uuid, -15.0),  -- Francisca: - 15 kgs
  ('2f2ff199-e84b-4877-9b2c-45a03296ac10'::uuid, -15.0),  -- Bianca: Perder 15 kgs de gordura
  ('e4d6939f-3483-4b74-9fd7-b61248c4daba'::uuid, -15.0)   -- Rayenne: - 15kgs
) AS v(id, change)
WHERE t.id = v.id AND t.weight_goal_change_kg IS NULL;

NOTIFY pgrst, 'reload schema';
