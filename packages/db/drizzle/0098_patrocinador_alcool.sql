-- #1021 (seguimento do #1102): categoria `alcohol`, separada de `beverage`. Só amplia a lista do CHECK (expandir):
-- todo valor que já passava continua passando. NOT VALID + VALIDATE para não segurar a tabela durante a conferência.
ALTER TABLE "engage"."sponsor" DROP CONSTRAINT "sponsor_category";--> statement-breakpoint
ALTER TABLE "engage"."sponsor" ADD CONSTRAINT "sponsor_category" CHECK (category in ('alcohol', 'apparel', 'automotive', 'beverage', 'education', 'energy', 'finance', 'food', 'health', 'media', 'retail', 'technology', 'telecom', 'travel', 'other')) NOT VALID;--> statement-breakpoint
ALTER TABLE "engage"."sponsor" VALIDATE CONSTRAINT "sponsor_category";
