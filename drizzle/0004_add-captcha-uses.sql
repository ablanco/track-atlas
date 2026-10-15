CREATE TABLE "captcha_uses" (
	"challenge_hash" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "captcha_uses_expires_at_index" ON "captcha_uses" USING btree ("expires_at");
--> statement-breakpoint
CREATE TRIGGER captcha_uses_set_updated_at
BEFORE UPDATE ON public.captcha_uses
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();
