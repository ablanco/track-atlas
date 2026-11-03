CREATE TABLE "legal_acceptances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"terms_version" text NOT NULL,
	"privacy_version" text NOT NULL,
	"locale" text NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "legal_acceptances_locale_check" CHECK ("legal_acceptances"."locale" IN ('en', 'es')),
	CONSTRAINT "legal_acceptances_terms_version_check" CHECK (btrim("legal_acceptances"."terms_version") <> ''),
	CONSTRAINT "legal_acceptances_privacy_version_check" CHECK (btrim("legal_acceptances"."privacy_version") <> '')
);
--> statement-breakpoint
ALTER TABLE "legal_acceptances" ADD CONSTRAINT "legal_acceptances_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "legal_acceptances_user_index" ON "legal_acceptances" USING btree ("user_id");
--> statement-breakpoint
CREATE TRIGGER legal_acceptances_set_updated_at
BEFORE UPDATE ON public.legal_acceptances
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
CREATE FUNCTION public.reject_legal_acceptance_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Legal acceptance evidence is immutable' USING ERRCODE = '23514';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER legal_acceptances_immutable
BEFORE UPDATE ON public.legal_acceptances
FOR EACH ROW EXECUTE FUNCTION public.reject_legal_acceptance_update();
