-- Plataforma comercial (#1136, F2, PL9): cargos `developer` (quem integra: chaves, webhooks, Builder) e `billing`
-- (financeiro: cobrança e faturas). Só amplia a lista dos dois CHECKs: todo valor que já passava continua passando.
-- O migrate roda numa transação só, então o lock do DROP vale até o fim; as tabelas são pequenas (a equipe de cada
-- cliente e as permissões que o Dono mudou), e a conferência do CHECK novo é instantânea. `tenant_member_event` não
-- tem CHECK de cargo. As permissões dos cargos novos (`@galaxie/engage`) e as telas ficam para o PR seguinte.
ALTER TABLE "api"."tenant_member" DROP CONSTRAINT "tenant_member_role";--> statement-breakpoint
ALTER TABLE "api"."tenant_role_permission" DROP CONSTRAINT "tenant_role_permission_role";--> statement-breakpoint
ALTER TABLE "api"."tenant_member" ADD CONSTRAINT "tenant_member_role" CHECK ("api"."tenant_member"."role" in ('owner', 'admin', 'developer', 'billing', 'senior_moderator', 'moderator', 'volunteer'));--> statement-breakpoint
ALTER TABLE "api"."tenant_role_permission" ADD CONSTRAINT "tenant_role_permission_role" CHECK ("api"."tenant_role_permission"."role" in ('admin', 'developer', 'billing', 'senior_moderator', 'moderator', 'volunteer'));
