ALTER TABLE "engage"."moderation_list" DROP CONSTRAINT "moderation_list_name";--> statement-breakpoint
ALTER TABLE "engage"."moderation_list" DROP CONSTRAINT "moderation_list_domain_locale";--> statement-breakpoint
ALTER TABLE "engage"."moderation_list" ADD CONSTRAINT "moderation_list_name" CHECK (list in ('hate', 'threat', 'harassment', 'sexual', 'profanity', 'betting', 'allowed_domains', 'bet_domains', 'exceptions', 'allowed_handles'));--> statement-breakpoint
ALTER TABLE "engage"."moderation_list" ADD CONSTRAINT "moderation_list_domain_locale" CHECK ("engage"."moderation_list"."list" not in ('allowed_domains', 'bet_domains', 'exceptions', 'allowed_handles') or "engage"."moderation_list"."locale" = 'all');
