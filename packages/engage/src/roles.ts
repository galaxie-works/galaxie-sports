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
  /** Mudar o que cada cargo pode (permissões por cargo do tenant). Sempre e só do Dono. */
  'permissions.manage': 'owner',

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

  // Cosmos AI (#996)
  /** Ver a área da Cosmos AI: menu, tela, saldo, extrato e CSV. */
  'cosmos.view': 'admin',
  /**
   * Mexer no dinheiro e no interruptor da Cosmos AI: comprar créditos, recarga automática no cartão salvo, ligar e
   * desligar. Separada de `billing.buy_credits` (que fica para a área de Cobrança, com plano e faturas) porque ligar e
   * desligar a Cosmos não é compra, e o Dono pode querer delegar uma coisa sem a outra.
   */
  'cosmos.manage': 'owner',
  /** Perguntar ao assistente (gasta créditos do tenant). Voluntário fica de fora: é torcedor promovido. */
  'cosmos.assistant.ask': 'moderator',
} as const satisfies Record<string, TenantRole>;
export type TenantAction = keyof typeof ACTIONS;
export const TENANT_ACTIONS = Object.keys(ACTIONS) as TenantAction[];

export const isTenantAction = (value: unknown): value is TenantAction =>
  typeof value === 'string' && Object.hasOwn(ACTIONS, value);

/*
 * Permissões por cargo configuráveis pelo Dono. A matriz `ACTIONS` é o padrão; o tenant guarda só o que mudou
 * (`RoleOverrides`). Sem configuração, nada muda. Regras que nenhuma configuração dobra:
 *  - o Dono pode tudo e não se tranca fora;
 *  - ações fixas (`FIXED_ACTIONS`) seguem a matriz: Exportação judicial, cuidar dos cargos (a Escada) e mudar as
 *    próprias permissões;
 *  - nenhum cargo pode mais que o de cima (a Escada também vale para as ações): tirar de um cargo tira dos de baixo;
 *  - quem gerencia também vê (`VIEW_OF`): dar `x.manage` dá `x.view` ao mesmo cargo; tirar `x.view` tira `x.manage`;
 *  - ações do painel não descem ao Voluntário, que é Perfil de torcedor e não entra no console (`DELEGATION_FLOOR`);
 *  - a equipe Galaxie continua passando por cima.
 */

/** Ações que o Dono não muda: seguem sempre a matriz. */
export const FIXED_ACTIONS: readonly TenantAction[] = [
  'legal.export',
  'members.manage',
  'permissions.manage',
];

/** Ações do painel (conta, cobrança, Cosmos): o cargo mais baixo que pode recebê-las é o Moderador. */
const PANEL_FLOOR: TenantRole = 'moderator';

/** Cargo mais baixo que pode receber cada ação configurável. Sem entrada = qualquer cargo. */
export const DELEGATION_FLOOR: Partial<Record<TenantAction, TenantRole>> = Object.fromEntries(
  TENANT_ACTIONS.filter((a) => !a.startsWith('moderation.')).map((a) => [a, PANEL_FLOOR]),
);

export const isConfigurable = (action: TenantAction) => !FIXED_ACTIONS.includes(action);

/**
 * Ver que acompanha cada ação de gerenciar: quem gerencia também vê. Vale na leitura (`roleAllows`) e na gravação
 * (`setRolePermission`).
 */
export const VIEW_OF: Partial<Record<TenantAction, TenantAction>> = {
  'billing.buy_credits': 'billing.view',
  'members.manage': 'members.view',
  'cosmos.manage': 'cosmos.view',
};

/** Ações de gerenciar que dependem de `view`. */
const managersOf = (view: TenantAction) =>
  (Object.keys(VIEW_OF) as TenantAction[]).filter((m) => VIEW_OF[m] === view);

/** Cargos que o Dono configura (ele mesmo sempre pode tudo). */
export const CONFIGURABLE_ROLES = TENANT_ROLES.filter((r) => r !== 'owner');

/** O cargo pode receber a ação (configurável e acima do piso)? */
export function canReceive(role: TenantRole, action: TenantAction): boolean {
  if (role === 'owner' || !isConfigurable(action)) return false;
  const floor = DELEGATION_FLOOR[action];
  if (floor !== undefined && !atLeast(role, floor)) return false;
  // o ver de uma ação de gerenciar fixa não muda para quem gerencia: hoje, `members.view` do Admin
  return !managersOf(action).some((m) => !isConfigurable(m) && atLeast(role, ACTIONS[m]));
}

/** O que mudou da matriz no tenant: cargo → ação → pode. Só cargos e ações configuráveis contam. */
export type RoleOverrides = Partial<Record<TenantRole, Partial<Record<TenantAction, boolean>>>>;

/** O que o cargo pode fazer pela configuração, sem a Escada (`roleAllows` aplica a Escada). */
function rawAllows(role: TenantRole, action: TenantAction, overrides: RoleOverrides | null | undefined) {
  if (role === 'owner') return true;
  const fallback = atLeast(role, ACTIONS[action]);
  if (!overrides || !canReceive(role, action)) return fallback;
  return overrides[role]?.[action] ?? fallback;
}

/**
 * O cargo pode fazer a ação no tenant com esta configuração? Vale a Escada: o cargo só pode o que todos os cargos
 * acima dele também podem; e quem gerencia também vê: sem o `view`, o `manage` não vale. As duas regras valem mesmo
 * que a configuração gravada diga outra coisa (banco editado à mão, por exemplo).
 */
export function roleAllows(
  role: TenantRole,
  action: TenantAction,
  overrides?: RoleOverrides | null,
): boolean {
  for (let i = 0; i <= roleRank(role); i++) if (!rawAllows(TENANT_ROLES[i]!, action, overrides)) return false;
  const view = VIEW_OF[action];
  return view === undefined || roleAllows(role, view, overrides);
}

/**
 * Configuração limpa: só cargos e ações configuráveis, acima do piso, com a Escada aplicada e sem repetir o padrão.
 * Serve para gravar e para ler do banco (o que vier a mais é descartado).
 */
export function normalizeOverrides(overrides: RoleOverrides | null | undefined): RoleOverrides {
  const out: RoleOverrides = {};
  for (const role of CONFIGURABLE_ROLES)
    for (const action of TENANT_ACTIONS) {
      if (!canReceive(role, action)) continue;
      const value = roleAllows(role, action, overrides);
      if (value !== atLeast(role, ACTIONS[action])) (out[role] ??= {})[action] = value;
    }
  return out;
}

/**
 * Liga ou desliga uma ação num cargo e devolve a configuração nova (limpa). Dar a um cargo dá também aos de cima;
 * tirar de um cargo tira dos de baixo. Dar um `manage` dá o `view` dele; tirar um `view` tira os `manage` que
 * dependem dele. Ação fixa, Dono ou cargo abaixo do piso: devolve a configuração sem mudança.
 */
export function setRolePermission(
  overrides: RoleOverrides | null | undefined,
  role: TenantRole,
  action: TenantAction,
  allowed: boolean,
): RoleOverrides {
  if (!canReceive(role, action)) return normalizeOverrides(overrides);
  const next: RoleOverrides = {};
  // parte do efetivo de cada cargo, para a Escada aplicada antes não se perder
  for (const r of CONFIGURABLE_ROLES)
    for (const a of TENANT_ACTIONS) if (canReceive(r, a)) (next[r] ??= {})[a] = roleAllows(r, a, overrides);
  for (const r of CONFIGURABLE_ROLES) {
    if (!canReceive(r, action)) continue;
    if (allowed && atLeast(r, role)) {
      next[r]![action] = true;
      const view = VIEW_OF[action];
      if (view && canReceive(r, view)) next[r]![view] = true;
    }
    if (!allowed && atLeast(role, r)) {
      next[r]![action] = false;
      for (const m of managersOf(action)) if (canReceive(r, m)) next[r]![m] = false;
    }
  }
  return normalizeOverrides(next);
}

/** Uma célula que mudou entre duas configurações (para a auditoria). */
export interface PermissionChange {
  role: TenantRole;
  action: TenantAction;
  allowed: boolean;
}

/** O que muda no efetivo de `before` para `after`, cargo a cargo. */
export function diffOverrides(
  before: RoleOverrides | null | undefined,
  after: RoleOverrides | null | undefined,
): PermissionChange[] {
  const out: PermissionChange[] = [];
  for (const role of CONFIGURABLE_ROLES)
    for (const action of TENANT_ACTIONS) {
      const was = roleAllows(role, action, before);
      const now = roleAllows(role, action, after);
      if (was !== now) out.push({ role, action, allowed: now });
    }
  return out;
}

/** Teto de tempo para silenciar, por cargo (segundos). Sem entrada = sem teto além da Escada. */
export const MUTE_LIMIT_SEC: Partial<Record<TenantRole, number>> = { volunteer: 3_600 };

/** Onde o cargo vale: o tenant inteiro (`null`) ou só algumas Comunidades e Salas do Jogo. */
export interface MemberScope {
  communities?: readonly string[];
  rooms?: readonly string[];
}

/**
 * Quem age: um membro do tenant (com cargo, escopo e, quando o Dono mudou alguma permissão, a configuração do tenant)
 * ou a equipe da Galaxie.
 */
export type Actor =
  | {
      kind: 'member';
      tenantId: string;
      role: TenantRole;
      scope: MemberScope | null;
      /** Permissões por cargo do tenant; ausente = a matriz padrão. Vem do banco, nunca do navegador. */
      overrides?: RoleOverrides;
    }
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
  if (!roleAllows(actor.role, action, actor.overrides)) return { ok: false, reason: 'role' };
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

/** Ações que o cargo abre, na ordem da matriz (tela de cargos e documentação); com a configuração do tenant, se houver. */
export const actionsOf = (role: TenantRole, overrides?: RoleOverrides | null): TenantAction[] =>
  TENANT_ACTIONS.filter((a) => roleAllows(role, a, overrides));
