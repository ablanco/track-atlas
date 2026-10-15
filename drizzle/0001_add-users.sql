CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"display_name" text,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"date_of_birth" date NOT NULL,
	"avatar_url" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_first_name_nonblank" CHECK (btrim("users"."first_name") <> ''),
	CONSTRAINT "users_last_name_nonblank" CHECK (btrim("users"."last_name") <> ''),
	CONSTRAINT "users_email_nonblank" CHECK (btrim("users"."email") <> ''),
	CONSTRAINT "users_email_trimmed" CHECK ("users"."email" = btrim("users"."email")),
	CONSTRAINT "users_password_hash_nonblank" CHECK (btrim("users"."password_hash") <> '')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree (lower("email"));
--> statement-breakpoint
CREATE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := statement_timestamp();
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER users_set_updated_at
BEFORE UPDATE ON public.users
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();
