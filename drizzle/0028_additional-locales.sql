ALTER TABLE "legal_acceptances" DROP CONSTRAINT "legal_acceptances_locale_check";--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_discussion_email_locale_check";--> statement-breakpoint
ALTER TABLE "legal_acceptances" ADD CONSTRAINT "legal_acceptances_locale_check" CHECK ("legal_acceptances"."locale" IN ('en', 'es', 'fr', 'pt', 'de', 'it'));--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_discussion_email_locale_check" CHECK ("users"."discussion_email_locale" IN ('en', 'es', 'fr', 'pt', 'de', 'it'));