/**
 * Travas antiabuso do cadastro (doc 02 §Cadastro, PL2), só no servidor: um trial por domínio de e-mail de empresa e
 * o teto de organizações por IP por dia (`SIGNUP_PER_IP_PER_DAY`, contando o IP do aceite dos termos). A revisão
 * manual do e-mail grátis é decidida em `email-domain.ts` e gravada em `review_status`.
 */
import { pool } from '@/lib/auth/db';

/** Organizações criadas pelo IP nas últimas `hours` horas (pelo IP gravado no aceite dos termos). */
export async function countOrganizationsFromIp(ip: string, hours = 24): Promise<number> {
  const { rows } = await pool.query<{ n: number }>(
    `select count(*)::int as n from billing.organization
      where terms_accepted_ip = $1 and created_at > now() - make_interval(hours => $2)`,
    [ip, hours],
  );
  return rows[0]?.n ?? 0;
}

export interface TrialOrganization {
  id: string;
  name: string;
}

/**
 * A organização em trial cujo Dono tem e-mail no mesmo domínio (de empresa), se houver: a segunda pessoa da mesma
 * empresa pede um convite em vez de abrir outro trial. "Em trial" = alguma marca com `trial_ends_at` no futuro.
 */
export async function findTrialOrganizationForDomain(domain: string): Promise<TrialOrganization | null> {
  const { rows } = await pool.query<{ id: string; name: string }>(
    `select o.id::text, o.name
       from billing.organization o
       join billing.organization_member om on om.organization_id = o.id and om.role = 'owner'
       join "user" u on u.id = om.user_id
      where split_part(lower(u.email), '@', 2) = $1
        and exists (select 1 from api.tenant t where t.organization_id = o.id and t.trial_ends_at > now())
      order by o.created_at
      limit 1`,
    [domain.toLowerCase()],
  );
  return rows[0] ?? null;
}

/**
 * A pessoa já tem cargo em alguma marca ou organização? (quem tem vai para o painel, não para o assistente). O cliente
 * de antes dos cargos, só com `tenant_id` no usuário, também conta: vira Dono no primeiro acesso ao painel.
 */
export async function hasAnyMembership(userId: string): Promise<boolean> {
  const { rows } = await pool.query<{ found: boolean }>(
    `select exists (select 1 from api.tenant_member where user_id = $1)
         or exists (select 1 from billing.organization_member where user_id = $1)
         or exists (select 1 from "user" u where u.id = $1 and u.tenant_id is not null) as found`,
    [userId],
  );
  return rows[0]?.found ?? false;
}
