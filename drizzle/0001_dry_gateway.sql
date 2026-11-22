CREATE TABLE "digest_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipient_id" uuid NOT NULL,
	"delivery_day" date NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"window_end" timestamp with time zone NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"attempt_id" uuid,
	"sending_started_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"outcome_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "digest_deliveries_window_check" CHECK ("digest_deliveries"."window_start" < "digest_deliveries"."window_end" AND "digest_deliveries"."window_end" = date_trunc('day',"digest_deliveries"."window_end" AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AND ("digest_deliveries"."window_end" AT TIME ZONE 'UTC')::date = "digest_deliveries"."delivery_day"),
	CONSTRAINT "digest_deliveries_attempt_check" CHECK ("digest_deliveries"."attempt_count" BETWEEN 0 AND 3),
	CONSTRAINT "digest_deliveries_state_check" CHECK ("digest_deliveries"."state" IN ('pending','sending','retryable','sent','empty','suppressed','uncertain','failed','superseded')),
	CONSTRAINT "digest_deliveries_timestamps_check" CHECK (("digest_deliveries"."state" NOT IN ('sending','retryable','sent','uncertain','failed') OR ("digest_deliveries"."attempt_count">0 AND "digest_deliveries"."attempt_id" IS NOT NULL AND "digest_deliveries"."sending_started_at" IS NOT NULL)) AND (("digest_deliveries"."state"='sent') = ("digest_deliveries"."accepted_at" IS NOT NULL)) AND (("digest_deliveries"."state"='retryable') = ("digest_deliveries"."next_attempt_at" IS NOT NULL))),
	CONSTRAINT "digest_deliveries_outcome_check" CHECK ("digest_deliveries"."outcome_code" IS NULL OR "digest_deliveries"."outcome_code" IN ('accepted','empty','disabled','inactive','rejected','unknown','staleSending','retryExhausted','notAttempted','superseded'))
);
--> statement-breakpoint
CREATE TABLE "digest_dispatch_days" (
	"recipient_id" uuid NOT NULL,
	"dispatch_day" date NOT NULL,
	"delivery_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "digest_dispatch_days_recipient_id_dispatch_day_pk" PRIMARY KEY("recipient_id","dispatch_day")
);
--> statement-breakpoint
CREATE TABLE "digest_opt_out_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipient_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "digest_opt_out_tokens_hash_check" CHECK ("digest_opt_out_tokens"."token_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "digest_scheduler_progress" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"after_recipient_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "digest_scheduler_singleton" CHECK ("digest_scheduler_progress"."id"=1)
);
--> statement-breakpoint
CREATE TABLE "uploader_follows" (
	"follower_id" uuid NOT NULL,
	"uploader_id" uuid NOT NULL,
	"followed_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uploader_follows_follower_id_uploader_id_pk" PRIMARY KEY("follower_id","uploader_id"),
	CONSTRAINT "uploader_follows_nonself" CHECK ("uploader_follows"."follower_id" <> "uploader_follows"."uploader_id")
);
--> statement-breakpoint
ALTER TABLE "tracks" ADD COLUMN "digest_published_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "digest_emails_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "digest_email_locale" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "digest_resume_after" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "digest_cursor_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "digest_deliveries" ADD CONSTRAINT "digest_deliveries_recipient_id_users_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "digest_dispatch_days" ADD CONSTRAINT "digest_dispatch_days_recipient_id_users_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "digest_dispatch_days" ADD CONSTRAINT "digest_dispatch_days_delivery_id_digest_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."digest_deliveries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "digest_opt_out_tokens" ADD CONSTRAINT "digest_opt_out_tokens_recipient_id_users_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uploader_follows" ADD CONSTRAINT "uploader_follows_follower_id_users_id_fk" FOREIGN KEY ("follower_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uploader_follows" ADD CONSTRAINT "uploader_follows_uploader_id_users_id_fk" FOREIGN KEY ("uploader_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "digest_deliveries_recipient_day_unique" ON "digest_deliveries" USING btree ("recipient_id","delivery_day");--> statement-breakpoint
CREATE INDEX "digest_deliveries_due_index" ON "digest_deliveries" USING btree ("state","next_attempt_at","recipient_id");--> statement-breakpoint
CREATE UNIQUE INDEX "digest_opt_out_tokens_hash_unique" ON "digest_opt_out_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "digest_opt_out_tokens_recipient_index" ON "digest_opt_out_tokens" USING btree ("recipient_id");--> statement-breakpoint
CREATE INDEX "digest_opt_out_tokens_expiry_index" ON "digest_opt_out_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "uploader_follows_uploader_index" ON "uploader_follows" USING btree ("uploader_id","follower_id");--> statement-breakpoint
CREATE INDEX "uploader_follows_page_index" ON "uploader_follows" USING btree ("follower_id","followed_at" DESC NULLS LAST,"uploader_id");--> statement-breakpoint
CREATE INDEX "tracks_digest_publication_index" ON "tracks" USING btree ("digest_published_at","id") WHERE "tracks"."digest_published_at" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_digest_locale_check" CHECK ("users"."digest_email_locale" IN ('en','es','fr','pt','de','it'));--> statement-breakpoint
CREATE TRIGGER uploader_follows_set_updated_at BEFORE UPDATE ON public.uploader_follows FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER digest_deliveries_set_updated_at BEFORE UPDATE ON public.digest_deliveries FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER digest_dispatch_days_set_updated_at BEFORE UPDATE ON public.digest_dispatch_days FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER digest_opt_out_tokens_set_updated_at BEFORE UPDATE ON public.digest_opt_out_tokens FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER digest_scheduler_progress_set_updated_at BEFORE UPDATE ON public.digest_scheduler_progress FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
INSERT INTO public.digest_scheduler_progress(id) VALUES (1);
--> statement-breakpoint
CREATE FUNCTION public.preserve_digest_publication() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.digest_published_at IS DISTINCT FROM OLD.digest_published_at THEN
  RAISE EXCEPTION 'digest publication evidence is immutable';
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER tracks_preserve_digest_publication BEFORE UPDATE ON public.tracks FOR EACH ROW EXECUTE FUNCTION public.preserve_digest_publication();
