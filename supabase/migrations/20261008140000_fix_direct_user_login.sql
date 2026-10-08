-- =============================================================================
-- Corrige o login de usuários cadastrados com senha pela Administração.
--
-- admin_create_direct_user inseria em auth.users deixando NULL nas colunas de token
-- (confirmation_token, recovery_token, email_change...). O serviço de login do Supabase
-- não aceita NULL nelas e falha ("Database error querying schema"), mesmo com a senha certa.
--
--  1. Conserta as contas já existentes (troca NULL por '' nessas colunas).
--  2. Gatilho em auth.users: qualquer cadastro futuro feito por SQL já nasce correto.
-- Reaplicável.
-- =============================================================================

BEGIN;

-- 1. Contas já criadas -------------------------------------------------------------
UPDATE auth.users SET
  confirmation_token         = COALESCE(confirmation_token, ''),
  recovery_token             = COALESCE(recovery_token, ''),
  email_change_token_new     = COALESCE(email_change_token_new, ''),
  email_change_token_current = COALESCE(email_change_token_current, ''),
  email_change               = COALESCE(email_change, ''),
  phone_change               = COALESCE(phone_change, ''),
  phone_change_token         = COALESCE(phone_change_token, ''),
  reauthentication_token     = COALESCE(reauthentication_token, '')
WHERE confirmation_token IS NULL
   OR recovery_token IS NULL
   OR email_change_token_new IS NULL
   OR email_change_token_current IS NULL
   OR email_change IS NULL
   OR phone_change IS NULL
   OR phone_change_token IS NULL
   OR reauthentication_token IS NULL;

-- 2. Cadastros futuros ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.auth_users_fill_tokens()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.confirmation_token         := COALESCE(NEW.confirmation_token, '');
  NEW.recovery_token             := COALESCE(NEW.recovery_token, '');
  NEW.email_change_token_new     := COALESCE(NEW.email_change_token_new, '');
  NEW.email_change_token_current := COALESCE(NEW.email_change_token_current, '');
  NEW.email_change               := COALESCE(NEW.email_change, '');
  NEW.phone_change               := COALESCE(NEW.phone_change, '');
  NEW.phone_change_token         := COALESCE(NEW.phone_change_token, '');
  NEW.reauthentication_token     := COALESCE(NEW.reauthentication_token, '');
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.auth_users_fill_tokens() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_auth_users_fill_tokens ON auth.users;
CREATE TRIGGER trg_auth_users_fill_tokens
  BEFORE INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.auth_users_fill_tokens();

COMMIT;
