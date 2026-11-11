-- #1021 (seguimento do #1102): categoria `alcohol`, separada de `beverage`. Só amplia a lista do CHECK: todo valor
-- que já passava continua passando. O migrate roda numa transação só, então o lock do DROP vale até o fim; a tabela
-- é pequena (dezenas de patrocinadores por cliente), e a conferência do CHECK novo é instantânea.
ALTER TABLE "engage"."sponsor" DROP CONSTRAINT "sponsor_category";--> statement-breakpoint
ALTER TABLE "engage"."sponsor" ADD CONSTRAINT "sponsor_category" CHECK (category in ('alcohol', 'apparel', 'automotive', 'beverage', 'education', 'energy', 'finance', 'food', 'health', 'media', 'retail', 'technology', 'telecom', 'travel', 'other'));
