
-- 1. Extend app_role enum with clinic roles
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'medico';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'secretaria';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'recepcionista';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'enfermeiro';
