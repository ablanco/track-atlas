CREATE TABLE "account_action_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_action_tokens_purpose_check" CHECK ("account_action_tokens"."purpose" IN ('email-confirmation','password-reset'))
);
--> statement-breakpoint
CREATE TABLE "email_send_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"attempted_at" timestamp with time zone[] DEFAULT '{}'::timestamptz[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account_action_tokens" ADD CONSTRAINT "account_action_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_action_tokens_hash_unique" ON "account_action_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "account_action_tokens_user_purpose_index" ON "account_action_tokens" USING btree ("user_id","purpose");--> statement-breakpoint
CREATE INDEX "account_action_tokens_expiry_index" ON "account_action_tokens" USING btree ("expires_at");
--> statement-breakpoint
CREATE TRIGGER account_action_tokens_set_updated_at BEFORE UPDATE ON account_action_tokens FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER email_send_limits_set_updated_at BEFORE UPDATE ON email_send_limits FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
