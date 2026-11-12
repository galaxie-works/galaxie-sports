-- #1104 (épico #1103): a chave da ficha por país aceita `DEFAULT`, a ficha restritiva de quem vem de país sem
-- ficha e fora da LATAM. Só amplia a lista do CHECK: toda chave que já passava continua passando. A ficha em si
-- entra na 0100, com o código.
ALTER TABLE "engage"."country_policy" DROP CONSTRAINT "country_policy_key";--> statement-breakpoint
ALTER TABLE "engage"."country_policy" ADD CONSTRAINT "country_policy_key" CHECK ("engage"."country_policy"."country" ~ '^([A-Z]{2}|LATAM|DEFAULT)$');
