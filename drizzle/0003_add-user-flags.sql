ALTER TABLE "users" ADD COLUMN "admin" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_confirmed" boolean DEFAULT false NOT NULL;