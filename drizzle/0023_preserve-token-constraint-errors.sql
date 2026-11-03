-- Preserve native NOT NULL / foreign-key diagnostics for malformed or missing
-- accounts. Only an existing account in permanent erasure needs this guard.
CREATE OR REPLACE FUNCTION public.guard_erasing_account_token() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE erasing boolean;
BEGIN
  SELECT erasure_started_at IS NOT NULL INTO erasing
    FROM public.users WHERE id=NEW.user_id FOR SHARE;
  IF erasing THEN
    RAISE EXCEPTION 'Account unavailable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
