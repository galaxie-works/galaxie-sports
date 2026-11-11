/**
 * Cargos da equipe do cliente e a matriz de permissões (#1019). Tabela única: Chat ao vivo, Comunidades,
 * Gamificação, Shopping e Cosmos AI consultam só este arquivo, sempre no servidor, pelo `can()`.
 *
 * - **Dono** (`owner`): tudo, inclusive comprar créditos, cuidar dos cargos e pedir a Exportação judicial.
 * - **Admin** (`admin`): configura os módulos, nomeia moderadores e aplica o Banimento.
 * - **Moderador sênior** (`senior_moderator`): tudo do moderador, Expulsão, banir de todas as Salas do Jogo e julgar a
 *   segunda apelação.
 * - **Moderador** (`moderator`): esconder, silenciar, suspender por tempo, fixar, modo lento e julgar a primeira
 *   apelação.
 * - **Voluntário** (`volunteer`): torcedor promovido. Esconde e silencia por até 1 hora; o resto vai para a Fila.
 *
 * A equipe da Galaxie (papel `admin` do console) passa por cima de tudo, em qualquer tenant (`galaxieStaff`).
 */

/** Do mais alto ao mais baixo. A ordem decide quem pode dar qual cargo. */
export const TENANT_ROLES = ['owner', 'admin', 'senior_moderator', 'moderator', 'volunteer'] as const;
export type TenantRole = (typeof TENANT_ROLES)[number];

export const isTenantRole = (value: unknown): value is TenantRole =>
  typeof value === 'string' && (TENANT_ROLES as readonly string[]).includes(value);

/** Posição do cargo (0 = Dono). Menor = mais poder. */
export const roleRank = (role: TenantRole) => TENANT_ROLES.indexOf(role);

/** Pelo menos tão alto quanto `min`? */
export const atLeast = (role: TenantRole, min: TenantRole) => roleRank(role) <= roleRank(min);

/**
 * Ações e o cargo mínimo de cada uma. Ação nova entra aqui com nome `area.verbo` (as da Cosmos, #996, como
 * `cosmos.*`), e o teste da matriz cobre a tabela inteira.
 */
export const ACTIONS = {
  // Conta
  'billing.view': 'admin',
  'billing.buy_credits': 'owner',
  'members.view': 'admin',
  /** Convidar, trocar e tirar cargos até o próprio nível (Dono só pelo Dono). */
  'members.manage': 'admin',
  'settings.manage': 'admin',
  'audit.view': 'admin',
  /** Exportação judicial: pedido do Dono (ADR 0004). */
  'legal.export': 'owner',

  // Moderação (Fila única, #953)
  'moderation.queue.view': 'volunteer',
  'moderation.hide': 'volunteer',
  /** Silenciar: voluntário até `MUTE_LIMIT_SEC.volunteer`. */
  'moderation.mute': 'volunteer',
  'moderation.pin': 'moderator',
  'moderation.slow_mode': 'moderator',
  'moderation.suspend': 'moderator',
  'moderation.appeal.first': 'moderator',
  /** Silêncio oculto: só pessoa, com prazo (ADR 0003). */
  'moderation.shadow_mute': 'senior_moderator',
  'moderation.expel': 'senior_moderator',
  /** Banir de todas as Salas do Jogo do cliente. */
  'moderation.ban_rooms': 'senior_moderator',
  'moderation.appeal.second': 'senior_moderator',
  /** Banimento: todas as Comunidades e Salas do Jogo do cliente. */
  'moderation.ban': 'admin',
  'moderation.word_list.manage': 'admin',
} as const satisfies Record<string, TenantRole>;
export type TenantAction = keyof typeof ACTIONS;
export const TENANT_ACTIONS = Object.keys(ACTIONS) as TenantAction[];

/** Teto de tempo para silenciar, por cargo (segundos). Sem entrada = sem teto além da Escada. */
export const MUTE_LIMIT_SEC: Partial<Record<TenantRole, number>> = { volunteer: 3_600 };

/** Onde o cargo vale: o tenant inteiro (`null`) ou só algumas Comunidades e Salas do Jogo. */
export interface MemberScope {
  communities?: readonly string[];
  rooms?: readonly string[];
}

/** Quem age: um membro do tenant (com cargo e escopo) ou a equipe da Galaxie. */
export type Actor =
  | { kind: 'member'; tenantId: string; role: TenantRole; scope: MemberScope | null }
  | { kind: 'galaxie_staff' };

/** Sobre o que a ação recai: o tenant e, quando houver, a Comunidade ou a Sala. */
export interface ActionTarget {
  tenantId: string;
  community?: string;
  room?: string;
  /** Duração pedida, para ações com teto por cargo (silenciar). */
  durationSec?: number;
}

/** Por que não: o servidor devolve o motivo em 403 e a tela usa para esconder o botão. */
export type Denial = 'other_tenant' | 'role' | 'scope' | 'duration';

export type CanResult = { ok: true } | { ok: false; reason: Denial };

function inScope(scope: MemberScope | null, target: ActionTarget): boolean {
  if (scope === null) return true;
  // escopo restrito sem alvo específico (ex.: configurar o tenant) não vale
  if (target.community) return scope.communities?.includes(target.community) ?? false;
  if (target.room) return scope.rooms?.includes(target.room) ?? false;
  return false;
}

/**
 * Decide se `actor` pode fazer `action` em `target`. Sempre no servidor: o cargo e o escopo vêm do banco, nunca do
 * navegador. Ordem das recusas: outro tenant, cargo, escopo, duração.
 */
export function check(actor: Actor, action: TenantAction, target: ActionTarget): CanResult {
  if (actor.kind === 'galaxie_staff') return { ok: true };
  if (actor.tenantId !== target.tenantId) return { ok: false, reason: 'other_tenant' };
  if (!atLeast(actor.role, ACTIONS[action])) return { ok: false, reason: 'role' };
  if (!inScope(actor.scope, target)) return { ok: false, reason: 'scope' };
  const limit = action === 'moderation.mute' ? MUTE_LIMIT_SEC[actor.role] : undefined;
  if (limit !== undefined && (target.durationSec === undefined || target.durationSec > limit))
    return { ok: false, reason: 'duration' };
  return { ok: true };
}

/** `check` em booleano. */
export const can = (actor: Actor, action: TenantAction, target: ActionTarget): boolean =>
  check(actor, action, target).ok;

/**
 * Pode dar (ou tirar) o cargo `role` a alguém? Só quem tem `members.manage`, e nunca acima do próprio cargo; Dono só
 * pelo Dono ou pela Galaxie. `currentRole` é o cargo atual da pessoa (trocar ou tirar também exige estar acima dele).
 */
export function canAssign(
  actor: Actor,
  tenantId: string,
  role: TenantRole | null,
  currentRole: TenantRole | null = null,
): boolean {
  if (actor.kind === 'galaxie_staff') return true;
  if (!can(actor, 'members.manage', { tenantId })) return false;
  const reaches = (r: TenantRole) => (actor.role === 'owner' ? true : roleRank(r) > roleRank(actor.role));
  if (role !== null && !reaches(role)) return false;
  if (currentRole !== null && !reaches(currentRole)) return false;
  return true;
}

/** Ações que o cargo abre, na ordem da matriz (tela de cargos e documentação). */
export const actionsOf = (role: TenantRole): TenantAction[] =>
  TENANT_ACTIONS.filter((a) => atLeast(role, ACTIONS[a]));
