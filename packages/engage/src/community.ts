/**
 * Regras das Comunidades (épico #936, #939), puras: quem entra, como cada Modo de entrada responde e o que o console
 * pode gravar. O banco (`@galaxie/db`, `community.ts`) lê e grava; as rotas chamam estas funções antes.
 *
 * - Uma Comunidade por Âncora e por cliente; o torcedor nunca cria (só o escopo do cliente cria);
 * - Modo de entrada: `open` entra direto, `approval` abre um pedido na fila do cliente, `closed` só com convite;
 * - Termos com versão: com termos publicados, entrar exige o Aceite da versão em vigor. Versão nova pede novo Aceite
 *   antes da próxima escrita (a leitura continua);
 * - Idade: quem lê entra (13 a 17 lê e reage, sem escrever); o portão de idade das rotas decide, pela ficha do país.
 */

export const COMMUNITY_JOIN_MODES = ['open', 'approval', 'closed'] as const;
export type CommunityJoinMode = (typeof COMMUNITY_JOIN_MODES)[number];

export const COMMUNITY_STATES = ['active', 'archived', 'suspended'] as const;
export type CommunityState = (typeof COMMUNITY_STATES)[number];

export const COMMUNITY_MEMBERSHIP_STATES = ['active', 'left', 'removed'] as const;
export type CommunityMembershipState = (typeof COMMUNITY_MEMBERSHIP_STATES)[number];

/** Teto da janela de exibição do Feed e do Chat da Comunidade, em dias (2 anos). A Guarda legal não muda com ela. */
export const COMMUNITY_HISTORY_MAX_DAYS = 730;

/** Tamanho de cada idioma dos termos da Comunidade. */
export const COMMUNITY_TERMS_MAX_CHARS = 20_000;

/** Por que a entrada foi recusada. */
export type CommunityJoinRefusal =
  /** Arquivada ou suspensa: não aparece e não aceita membro. */
  | 'not_active'
  /** Fechada: só com convite válido. */
  | 'invite_required'
  /** Convite vencido, revogado, esgotado ou de outra Comunidade. */
  | 'invite_invalid'
  /** Há termos em vigor e o pedido não trouxe o Aceite da versão atual. */
  | 'terms_required'
  /** A equipe tirou o torcedor; só volta com convite. */
  | 'removed';

export type CommunityJoinOutcome =
  | { ok: true; result: 'joined' | 'already_member' | 'requested' | 'already_requested' }
  | { ok: false; refusal: CommunityJoinRefusal };

export interface CommunityJoinInput {
  community: { state: CommunityState; joinMode: CommunityJoinMode; termsVersion: number | null };
  /** Estado do vínculo do torcedor, se já houve um. */
  membership: CommunityMembershipState | null;
  /** Já há pedido aberto (modo com aprovação). */
  pendingRequest: boolean;
  /** Versão dos termos que o pedido aceita (o widget mostra e manda a que o torcedor leu). */
  acceptedTermsVersion: number | null;
  /** O pedido trouxe convite? `valid` diz se ele vale para esta Comunidade agora. */
  invite: { valid: boolean } | null;
}

/**
 * Decide a entrada. Pura: quem chama lê a Comunidade, o vínculo, o pedido e o convite, e grava o que sair daqui.
 * Convite válido entra direto em qualquer modo (o convite é a aprovação), inclusive para quem foi tirado.
 */
export function decideJoin(input: CommunityJoinInput): CommunityJoinOutcome {
  const { community, membership, pendingRequest, acceptedTermsVersion, invite } = input;
  if (community.state !== 'active') return { ok: false, refusal: 'not_active' };
  if (membership === 'active') return { ok: true, result: 'already_member' };
  if (invite && !invite.valid) return { ok: false, refusal: 'invite_invalid' };
  const invited = invite?.valid === true;
  if (membership === 'removed' && !invited) return { ok: false, refusal: 'removed' };
  if (community.termsVersion !== null && acceptedTermsVersion !== community.termsVersion)
    return { ok: false, refusal: 'terms_required' };
  if (invited || community.joinMode === 'open') return { ok: true, result: 'joined' };
  if (community.joinMode === 'closed') return { ok: false, refusal: 'invite_required' };
  return { ok: true, result: pendingRequest ? 'already_requested' : 'requested' };
}

/** Convite vale agora? (não revogado, no prazo e com uso sobrando). */
export function inviteUsable(
  invite: { revokedAt: Date | null; expiresAt: Date | null; maxUses: number | null; uses: number },
  now: Date,
): boolean {
  if (invite.revokedAt) return false;
  if (invite.expiresAt && invite.expiresAt.getTime() <= now.getTime()) return false;
  return invite.maxUses === null || invite.uses < invite.maxUses;
}

/**
 * O membro com termos de versão antiga lê, mas precisa aceitar a versão atual antes de escrever (Feed, comentário,
 * Chat da Comunidade).
 */
export const needsNewAcceptance = (termsVersion: number | null, lastAccepted: number | null): boolean =>
  termsVersion !== null && (lastAccepted === null || lastAccepted < termsVersion);

/** O que o console pode mudar numa Comunidade. */
export interface CommunityConfigInput {
  joinMode?: unknown;
  memberPosts?: unknown;
  chatEnabled?: unknown;
  historyDays?: unknown;
}

export type CommunityConfigIssue = { field: keyof CommunityConfigInput; code: 'invalid' };

export interface CommunityConfigPatch {
  joinMode?: CommunityJoinMode;
  memberPosts?: boolean;
  chatEnabled?: boolean;
  /** null = volta ao padrão da Galaxie. */
  historyDays?: number | null;
}

/** Valida o que o console mandou. Campo ausente fica como está. */
export function validateCommunityConfig(
  input: CommunityConfigInput,
): { ok: true; patch: CommunityConfigPatch } | { ok: false; issues: CommunityConfigIssue[] } {
  const issues: CommunityConfigIssue[] = [];
  const patch: CommunityConfigPatch = {};
  if (input.joinMode !== undefined) {
    if ((COMMUNITY_JOIN_MODES as readonly unknown[]).includes(input.joinMode))
      patch.joinMode = input.joinMode as CommunityJoinMode;
    else issues.push({ field: 'joinMode', code: 'invalid' });
  }
  for (const field of ['memberPosts', 'chatEnabled'] as const) {
    const v = input[field];
    if (v === undefined) continue;
    if (typeof v === 'boolean') patch[field] = v;
    else issues.push({ field, code: 'invalid' });
  }
  if (input.historyDays !== undefined) {
    const v = input.historyDays;
    if (v === null) patch.historyDays = null;
    else if (Number.isInteger(v) && (v as number) >= 1 && (v as number) <= COMMUNITY_HISTORY_MAX_DAYS)
      patch.historyDays = v as number;
    else issues.push({ field: 'historyDays', code: 'invalid' });
  }
  return issues.length ? { ok: false, issues } : { ok: true, patch };
}

/** Termos nos três idiomas, cada um preenchido e dentro do tamanho. */
export function validateCommunityTerms(
  body: unknown,
): { ok: true; body: { pt: string; es: string; en: string } } | { ok: false; missing: string[] } {
  const b = (body ?? {}) as Record<string, unknown>;
  const out: Record<string, string> = {};
  const missing: string[] = [];
  for (const lang of ['pt', 'es', 'en']) {
    const v = typeof b[lang] === 'string' ? (b[lang] as string).trim() : '';
    if (!v || v.length > COMMUNITY_TERMS_MAX_CHARS) missing.push(lang);
    else out[lang] = v;
  }
  return missing.length
    ? { ok: false, missing }
    : { ok: true, body: out as { pt: string; es: string; en: string } };
}
