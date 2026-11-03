ALTER TABLE "users" ADD COLUMN "erasure_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_erasure_inactive" CHECK ("users"."erasure_started_at" IS NULL OR NOT "users"."active");--> statement-breakpoint
CREATE FUNCTION public.guard_account_erasure() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.erasure_started_at IS NOT NULL AND
     (to_jsonb(NEW) - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'updated_at') THEN
    RAISE EXCEPTION 'Account erasure is irreversible' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER users_guard_erasure BEFORE UPDATE ON public.users
FOR EACH ROW EXECUTE FUNCTION public.guard_account_erasure();
--> statement-breakpoint
CREATE FUNCTION public.guard_erasing_account_token() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM id FROM public.users WHERE id=NEW.user_id AND erasure_started_at IS NULL FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Account unavailable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER sessions_guard_erasure BEFORE INSERT OR UPDATE ON public.sessions
FOR EACH ROW EXECUTE FUNCTION public.guard_erasing_account_token();
--> statement-breakpoint
CREATE TRIGGER account_tokens_guard_erasure BEFORE INSERT ON public.account_action_tokens
FOR EACH ROW EXECUTE FUNCTION public.guard_erasing_account_token();
