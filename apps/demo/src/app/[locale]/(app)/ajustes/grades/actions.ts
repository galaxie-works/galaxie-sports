'use server';

/**
 * Ações de Ajustes → Grades e ofertas (só admin): decidir itens da grade (e a mudança que a pesquisa
 * encontrou num item já aprovado), editar e criar itens à mão (pelo mesmo fluxo de revisão), enviar logos,
 * resolver os pedidos das operadoras e ligar cada tenant a uma operadora.
 * Cada uma confere a sessão de admin no servidor (o proxy é só a primeira barreira) e grava quem fez, pelo
 * e-mail do admin.
 */
import { parseLineupTarget } from '@galaxie/db/lineups';
import { revalidatePath } from 'next/cache';

import { requireAdmin } from '@/lib/auth/admin';
import { tenantExists } from '@/lib/client/tenants';
import { getDictionary } from '@/lib/i18n/dictionary';
import { getRequestLocale } from '@/lib/i18n/server';
import { fill } from '@/lib/i18n/text';
import {
  LineupError,
  LogoUploadError,
  createManualLineupItem,
  dismissLineupChange,
  lineupDb,
  logoObjectStore,
  proposeManualLineupEdit,
  resolveLineupReviewRequest,
  revertCustomLogo,
  setLineupReviewStatus,
  setTenantOperator,
  uploadLogo,
} from '@/lib/lineup/store';
import {
  CREATABLE_TYPES,
  DOMAINS_MAX,
  LOGO_MAX_KB,
  MANUAL_ACCESS,
  MANUAL_FIELDS,
  NOTE_MAX,
  PLATFORM_KINDS,
  REVIEW_STATUSES,
  TARGET_TYPES,
  isId,
  isTargetId,
  parseDomains,
  type CreatableType,
  type LogoVariant,
  type LineupStatus,
  type TargetType,
} from '@/lib/lineup/types';

export interface AdminLineupResult {
  ok: boolean;
  error?: string;
}

async function texts() {
  return getDictionary(await getRequestLocale()).lineup.errors;
}

const revalidate = () => {
  revalidatePath('/ajustes/grades');
  revalidatePath('/cliente/grade');
};

const validTarget = (target: { type: TargetType; id: string } | undefined) =>
  Boolean(target && TARGET_TYPES.includes(target.type) && isTargetId(target.type, target.id));

/**
 * Aprovar, marcar como conferido, voltar para rascunho ou rejeitar um item da grade. Aprovar um item com
 * mudança encontrada pela pesquisa aplica a mudança.
 */
export async function decideLineupItem(
  target: { type: TargetType; id: string },
  status: LineupStatus,
): Promise<AdminLineupResult> {
  const me = await requireAdmin();
  const t = await texts();
  if (!validTarget(target) || !REVIEW_STATUSES.includes(status)) return { ok: false, error: t.itemNotFound };
  if (!(await setLineupReviewStatus(lineupDb(), parseLineupTarget(target.type, target.id), status, me.email)))
    return { ok: false, error: t.itemNotFound };
  revalidate();
  return { ok: true };
}

/** Descartar a mudança que a pesquisa encontrou num item já aprovado (o dado aprovado fica). */
export async function dismissLineupItemChange(target: {
  type: TargetType;
  id: string;
}): Promise<AdminLineupResult> {
  const me = await requireAdmin();
  const t = await texts();
  if (!validTarget(target)) return { ok: false, error: t.itemNotFound };
  if (!(await dismissLineupChange(lineupDb(), parseLineupTarget(target.type, target.id), me.email)))
    return { ok: false, error: t.itemNotFound };
  revalidate();
  return { ok: true };
}

/**
 * Aceitar (aplicando ou não a correção proposta) ou recusar um pedido de revisão de uma operadora.
 * Recusar exige nota: é a resposta que a operadora lê no portal.
 */
export async function resolveLineupRequest(
  requestId: string,
  input: { status: 'accepted' | 'rejected'; note?: string | null; apply?: boolean },
): Promise<AdminLineupResult> {
  const me = await requireAdmin();
  const t = await texts();
  if (!isId(requestId) || (input?.status !== 'accepted' && input?.status !== 'rejected'))
    return { ok: false, error: t.requestNotFound };
  const note = typeof input.note === 'string' ? input.note.trim() : '';
  if (note.length > NOTE_MAX) return { ok: false, error: fill(t.noteTooLong, { max: NOTE_MAX }) };
  if (input.status === 'rejected' && !note) return { ok: false, error: t.noteRequired };
  try {
    await resolveLineupReviewRequest(lineupDb(), requestId, {
      status: input.status,
      note: note || null,
      by: me.email,
      apply: input.status === 'accepted' && input.apply === true,
    });
  } catch (err) {
    if (err instanceof LineupError) {
      if (err.code === 'target_not_found') return { ok: false, error: t.itemNotFound };
      if (err.code === 'invalid_input') return { ok: false, error: t.invalidProposal };
      return { ok: false, error: t.requestNotFound };
    }
    throw err;
  }
  revalidate();
  return { ok: true };
}

/** Cadastro do tenant: operadora ligada, domínios de e-mail e a preferência de outras operadoras. */
export async function saveTenantOperator(
  tenantId: string,
  input: { platformId: string | null; domains: string; showOtherOperators: boolean },
): Promise<AdminLineupResult> {
  await requireAdmin();
  const t = await texts();
  if (!isId(tenantId) || !(await tenantExists(tenantId))) return { ok: false, error: t.tenantNotFound };
  const platformId = input?.platformId ?? null;
  if (platformId !== null && !isId(platformId)) return { ok: false, error: t.platformNotFound };
  const { domains, invalid } = parseDomains(typeof input.domains === 'string' ? input.domains : '');
  if (invalid.length) return { ok: false, error: fill(t.domains, { list: invalid.join(', ') }) };
  if (domains.length > DOMAINS_MAX) return { ok: false, error: fill(t.tooManyDomains, { max: DOMAINS_MAX }) };
  try {
    const saved = await setTenantOperator(lineupDb(), tenantId, {
      platformId,
      emailDomains: domains,
      showOtherOperators: input.showOtherOperators === true,
    });
    if (!saved) return { ok: false, error: t.tenantNotFound };
  } catch (err) {
    if (err instanceof LineupError) return { ok: false, error: t.platformNotFound };
    console.error('[ajustes] falha ao ligar o tenant à operadora', err);
    return { ok: false, error: t.generic };
  }
  revalidate();
  revalidatePath('/ajustes/usuarios');
  return { ok: true };
}

// ─── edição manual e logos ───────────────────────────────────────────────────────────────────────

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
/** Texto do formulário → valor do banco: vazio = null; preço como número (vírgula ou ponto). */
function fieldValue(field: string, v: unknown): unknown {
  const t = text(v);
  if (field === 'priceAmount') {
    if (!t) return null;
    const n = Number(t.replace(/\s/g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : t;
  }
  if (field === 'name' || field === 'kind' || field === 'access') return t || undefined;
  return t || null;
}

function lineupFailure(err: unknown, t: Awaited<ReturnType<typeof texts>>): AdminLineupResult {
  if (err instanceof LineupError)
    return { ok: false, error: err.code === 'target_not_found' ? t.itemNotFound : t.invalidEdit };
  console.error('[ajustes] falha na edição manual da grade', err);
  return { ok: false, error: t.generic };
}

/**
 * Editar um item da grade à mão: a edição fica pendente (com quem e quando) e só sai na API depois de
 * aprovada; `approve` já aprova junto. `removed` tira um canal ou streaming do plano.
 */
export async function editLineupItem(
  target: { type: TargetType; id: string },
  input: {
    fields?: Record<string, unknown>;
    removed?: boolean;
    sourceUrl?: string | null;
    approve?: boolean;
  },
): Promise<AdminLineupResult> {
  const me = await requireAdmin();
  const t = await texts();
  if (!validTarget(target)) return { ok: false, error: t.itemNotFound };
  const fields: Record<string, unknown> = {};
  for (const f of MANUAL_FIELDS[target.type]) {
    if (!input?.fields || !(f in input.fields)) continue;
    const v = fieldValue(f, input.fields[f]);
    if (v !== undefined) fields[f] = v;
  }
  if (fields.access !== undefined && !(MANUAL_ACCESS as readonly string[]).includes(String(fields.access)))
    return { ok: false, error: t.invalidEdit };
  const db = lineupDb();
  const parsed = parseLineupTarget(target.type, target.id);
  try {
    const saved = await proposeManualLineupEdit(db, parsed, {
      fields,
      removed: input?.removed === true,
      sourceUrl: text(input?.sourceUrl) || null,
      by: me.email,
    });
    if (!saved) return { ok: false, error: t.nothingChanged };
    if (input?.approve === true) await setLineupReviewStatus(db, parsed, 'approved', me.email);
  } catch (err) {
    return lineupFailure(err, t);
  }
  revalidate();
  return { ok: true };
}

/** Criar um item da grade à mão (entra como rascunho; `approve` já aprova). */
export async function createLineupItem(
  input: Record<string, unknown> & { type: CreatableType },
  opts: { sourceUrl?: string | null; approve?: boolean } = {},
): Promise<AdminLineupResult> {
  const me = await requireAdmin();
  const t = await texts();
  if (!input || !(CREATABLE_TYPES as readonly string[]).includes(input.type))
    return { ok: false, error: t.invalidEdit };
  const amount = fieldValue('priceAmount', input.priceAmount);
  const months = Number(text(input.commitmentMonths));
  const price = {
    priceText: text(input.priceText) || null,
    priceAmount: typeof amount === 'number' ? amount : amount === null ? null : Number.NaN,
    priceCurrency: text(input.priceCurrency) || null,
    url: text(input.url) || null,
  };
  const item =
    input.type === 'platform'
      ? {
          type: 'platform' as const,
          name: text(input.name),
          kind: text(input.kind) as (typeof PLATFORM_KINDS)[number],
          country: text(input.country),
          website: text(input.website) || null,
        }
      : input.type === 'plan'
        ? { type: 'plan' as const, platformId: text(input.platformId), name: text(input.name), ...price }
        : input.type === 'addon'
          ? {
              type: 'addon' as const,
              platformId: text(input.platformId),
              kind: (text(input.addonKind) === 'channel' ? 'channel' : 'service') as 'channel' | 'service',
              refId: text(input.refId),
              name: text(input.name),
              channel: text(input.channel) || null,
              commitmentMonths: Number.isFinite(months) && months > 0 ? months : null,
              ...price,
            }
          : {
              type: input.type,
              planId: text(input.planId),
              refId: text(input.refId),
              access: (text(input.access) || 'included') as (typeof MANUAL_ACCESS)[number],
            };
  if (item.type === 'platform' && !(PLATFORM_KINDS as readonly string[]).includes(item.kind))
    return { ok: false, error: t.invalidEdit };
  const db = lineupDb();
  try {
    const created = await createManualLineupItem(db, item, {
      by: me.email,
      sourceUrl: text(opts.sourceUrl) || null,
    });
    if (opts.approve === true) await setLineupReviewStatus(db, created, 'approved', me.email);
  } catch (err) {
    return lineupFailure(err, t);
  }
  revalidate();
  return { ok: true };
}

const validLogoVariant = (v: unknown): v is LogoVariant => v === 'light' || v === 'dark';

const validLogoTarget = (type: unknown, id: unknown): type is 'platform' | 'broadcaster' =>
  (type === 'platform' && isId(id)) ||
  (type === 'broadcaster' && typeof id === 'string' && /^[a-z0-9][a-z0-9._-]{0,119}$/i.test(id));

/**
 * Enviar o logo de uma operadora, plataforma ou canal (PNG ou SVG): validado pelo conteúdo, SVG
 * sanitizado, gravado no storage de assets com o nome no padrão da API e ligado à entidade. O anterior
 * fica guardado (`revertLineupLogo`).
 */
export async function uploadLineupLogo(form: FormData): Promise<AdminLineupResult> {
  const me = await requireAdmin();
  const t = await texts();
  const type = form.get('targetType');
  const id = form.get('targetId');
  const file = form.get('file');
  const variant = form.get('variant') ?? 'light';
  if (!validLogoTarget(type, id) || !validLogoVariant(variant)) return { ok: false, error: t.itemNotFound };
  if (!(file instanceof Blob) || !file.size) return { ok: false, error: t.logo.empty };
  // antes de ler o arquivo inteiro (a validação confere de novo, pelo conteúdo)
  if (file.size > LOGO_MAX_KB * 1024)
    return { ok: false, error: fill(t.logo.too_large, { kb: LOGO_MAX_KB }) };
  const objects = logoObjectStore();
  if (!objects) return { ok: false, error: t.logo.storage };
  try {
    await uploadLogo(lineupDb(), objects, {
      target: { type, id: id as string },
      body: new Uint8Array(await file.arrayBuffer()),
      by: me.email,
      variant,
    });
  } catch (err) {
    if (err instanceof LogoUploadError)
      return { ok: false, error: fill(t.logo[err.code], { kb: LOGO_MAX_KB }) };
    if (err instanceof LineupError)
      return { ok: false, error: err.code === 'invalid_input' ? t.logo.lightFirst : t.itemNotFound };
    console.error('[ajustes] falha no upload do logo', err);
    return { ok: false, error: t.generic };
  }
  revalidate();
  return { ok: true };
}

/** Voltar ao logo anterior ao último envio, no logo claro ou na versão para o tema escuro. */
export async function revertLineupLogo(target: {
  type: 'platform' | 'broadcaster';
  id: string;
  variant?: LogoVariant;
}): Promise<AdminLineupResult> {
  const me = await requireAdmin();
  const t = await texts();
  const variant = target?.variant ?? 'light';
  if (!validLogoTarget(target?.type, target?.id) || !validLogoVariant(variant))
    return { ok: false, error: t.itemNotFound };
  const ref = { type: target.type, id: target.id };
  if (!(await revertCustomLogo(lineupDb(), ref, me.email, variant)))
    return { ok: false, error: t.logo.noRevert };
  revalidate();
  return { ok: true };
}
