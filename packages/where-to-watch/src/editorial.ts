/**
 * Correção editorial (issue #51): inclusão, correção e remoção de opções com trilha de auditoria
 * (enrich.broadcast_correction) e propagação imediata pelo change feed (purge de cache em segundos;
 * SLA ≤ 5 min). Versões editoriais travam a chave: o agente não as sobrescreve.
 */
import { and, eq, isNull } from 'drizzle-orm';
import {
  broadcastCorrection,
  broadcastOption,
  wtwRun,
  type AccessModel,
  type BroadcastMedium,
  type Database,
  type Evidence,
} from '@galaxie/db';
import type { Blocklist } from './config/directory.js';
import { clipExcerpt, hostOf, isHttpUrl } from './normalize.js';
import {
  currentOptions,
  insertVersion,
  notifyChange,
  rowKey,
  stripVersionFields,
  type BroadcastOptionRow,
} from './store.js';
import { normalizeRegion, optionKey } from './validator.js';

export class WtwError extends Error {
  constructor(
    readonly code: 'not_found' | 'conflict' | 'blocked' | 'invalid',
    message: string,
  ) {
    super(message);
    this.name = 'WtwError';
  }
}

/** Handle interno de quem corrige (nunca e-mail ou dado pessoal). */
export const ACTOR_RE = /^[a-z0-9][a-z0-9._-]{1,63}$/i;

export function assertActor(actor: string): void {
  if (!ACTOR_RE.test(actor))
    throw new WtwError('invalid', 'Identificador do editor inválido: use um handle interno (sem e-mail).');
}

export interface EditorialEvidenceInput {
  url: string;
  excerpt?: string;
}

export interface EditorialBase {
  actor: string;
  reason: string;
  /** Quando o erro foi reportado — mede o tempo de correção (docs/07 §4). */
  reportedAt?: Date | null;
  now?: Date;
  blocklist?: Blocklist;
}

export interface AddOptionInput extends EditorialBase {
  eventId: string;
  country: string;
  region?: string | null;
  providerName: string;
  broadcasterId?: string | null;
  channel?: string | null;
  medium: BroadcastMedium;
  accessModel: AccessModel;
  url?: string | null;
  language?: string | null;
  evidence?: EditorialEvidenceInput[];
}

export interface CorrectionResult {
  option: BroadcastOptionRow | null;
  previous: BroadcastOptionRow | null;
  correctionId: string;
  changeId: number | null;
}

function toEvidence(list: EditorialEvidenceInput[] | undefined, now: Date): Evidence[] {
  return (list ?? [])
    .filter((e) => isHttpUrl(e.url))
    .map((e) => ({
      url: e.url,
      excerpt: clipExcerpt(e.excerpt ?? ''),
      publisher: hostOf(e.url)!,
      fetchedAt: now.toISOString(),
      sourceKind: 'editorial' as const,
      stance: 'confirms' as const,
    }));
}

function checkBlocked(
  blocklist: Blocklist | undefined,
  names: (string | null | undefined)[],
  urls: (string | null | undefined)[],
) {
  if (!blocklist) return;
  if (names.some((n) => n && blocklist.isBlockedName(n)) || urls.some((u) => u && blocklist.isBlockedUrl(u)))
    throw new WtwError('blocked', 'Emissora/plataforma bloqueada pela política editorial.');
}

function snapshot(row: BroadcastOptionRow | null) {
  if (!row) return null;
  return {
    id: row.id,
    provider: row.providerName,
    broadcaster_id: row.broadcasterId,
    channel: row.channelName,
    medium: row.medium,
    access_model: row.accessModel,
    region: row.region,
    url: row.url,
    status: row.status,
    confidence: Number(row.confidence),
    produced_by: row.producedBy,
  };
}

async function record(db: Database, values: typeof broadcastCorrection.$inferInsert): Promise<string> {
  const [row] = await db.insert(broadcastCorrection).values(values).returning({ id: broadcastCorrection.id });
  return row!.id;
}

async function finish(
  db: Database,
  action: 'add' | 'correct' | 'remove',
  input: EditorialBase & { eventId: string; country: string },
  previous: BroadcastOptionRow | null,
  option: BroadcastOptionRow,
): Promise<CorrectionResult> {
  const changeId = await notifyChange(db, input.eventId, input.country, {
    reason: 'editorial',
    action,
    optionId: option.id,
  });
  const correctionId = await record(db, {
    eventId: input.eventId,
    countryCode: input.country,
    action,
    optionId: option.id,
    previousOptionId: previous?.id ?? null,
    actor: input.actor,
    reason: input.reason,
    before: snapshot(previous),
    after: snapshot(option),
    reportedAt: input.reportedAt ?? null,
    changeId,
  });
  return { option, previous, correctionId, changeId };
}

/** Inclui (ou substitui) uma opção confirmada editorialmente. */
export async function addOption(db: Database, input: AddOptionInput): Promise<CorrectionResult> {
  assertActor(input.actor);
  const now = input.now ?? new Date();
  const country = input.country.toUpperCase();
  const region = normalizeRegion(input.region, country);
  if (region === undefined) throw new WtwError('invalid', `Região inválida para ${country}: ${input.region}`);
  checkBlocked(
    input.blocklist,
    [input.providerName, input.channel],
    [input.url, ...(input.evidence ?? []).map((e) => e.url)],
  );

  const key = optionKey({
    region,
    broadcasterId: input.broadcasterId ?? null,
    providerName: input.providerName,
    medium: input.medium,
  });
  const found: { previous: BroadcastOptionRow | null } = { previous: null };
  const option = await db.transaction(async (tx) => {
    const previous =
      (await currentOptions(tx, input.eventId, country)).find((r) => rowKey(r) === key) ?? null;
    found.previous = previous;
    return insertVersion(
      tx,
      {
        eventId: input.eventId,
        countryCode: country,
        region,
        providerName: input.providerName.trim(),
        broadcasterId: input.broadcasterId ?? null,
        channelName: input.channel?.trim() || null,
        medium: input.medium,
        accessModel: input.accessModel,
        url: input.url ?? null,
        language: input.language ?? null,
        status: 'confirmed',
        confidence: '1.00',
        evidence: toEvidence(input.evidence, now),
        sourceKind: 'editorial',
        conflict: false,
        flags: [],
        lastVerifiedAt: now,
        producedBy: `editorial:${input.actor}`,
      },
      previous,
      now,
    );
  });
  return finish(db, 'add', { ...input, country }, found.previous, option);
}

async function currentById(db: Database, optionId: string): Promise<BroadcastOptionRow> {
  const [row] = await db.select().from(broadcastOption).where(eq(broadcastOption.id, optionId));
  if (!row) throw new WtwError('not_found', 'Opção não encontrada.');
  if (row.supersededBy)
    throw new WtwError('conflict', `Versão desatualizada: a vigente é ${row.supersededBy}.`);
  return row;
}

export interface CorrectOptionPatch {
  providerName?: string;
  broadcasterId?: string | null;
  channel?: string | null;
  medium?: BroadcastMedium;
  accessModel?: AccessModel;
  url?: string | null;
  region?: string | null;
  language?: string | null;
  status?: 'confirmed' | 'pending' | 'omitted';
  evidence?: EditorialEvidenceInput[];
}

/** Corrige campos de uma opção vigente (nova versão editorial). */
export async function correctOption(
  db: Database,
  optionId: string,
  patch: CorrectOptionPatch,
  base: EditorialBase,
): Promise<CorrectionResult> {
  assertActor(base.actor);
  const now = base.now ?? new Date();
  const prev = await currentById(db, optionId);
  if (prev.status === 'retracted')
    throw new WtwError('conflict', 'Opção removida: use a inclusão para recriá-la.');
  let region = prev.region;
  if (patch.region !== undefined) {
    const r = normalizeRegion(patch.region, prev.countryCode);
    if (r === undefined) throw new WtwError('invalid', `Região inválida: ${patch.region}`);
    region = r;
  }
  checkBlocked(
    base.blocklist,
    [patch.providerName, patch.channel],
    [patch.url, ...(patch.evidence ?? []).map((e) => e.url)],
  );

  const option = await db.transaction(async (tx) => {
    const [locked] = await tx
      .select({ id: broadcastOption.id })
      .from(broadcastOption)
      .where(and(eq(broadcastOption.id, optionId), isNull(broadcastOption.supersededBy)))
      .for('update');
    if (!locked) throw new WtwError('conflict', 'A opção mudou durante a correção; recarregue.');
    return insertVersion(
      tx,
      {
        ...stripVersionFields(prev),
        providerName: patch.providerName?.trim() ?? prev.providerName,
        broadcasterId: patch.broadcasterId !== undefined ? patch.broadcasterId : prev.broadcasterId,
        channelName: patch.channel !== undefined ? patch.channel?.trim() || null : prev.channelName,
        medium: patch.medium ?? prev.medium,
        accessModel: patch.accessModel ?? prev.accessModel,
        url: patch.url !== undefined ? patch.url : prev.url,
        region,
        language: patch.language !== undefined ? patch.language : prev.language,
        status: patch.status ?? 'confirmed',
        confidence: '1.00',
        conflict: false,
        flags: [],
        evidence: patch.evidence ? toEvidence(patch.evidence, now) : prev.evidence,
        sourceKind: 'editorial',
        lastVerifiedAt: now,
        producedBy: `editorial:${base.actor}`,
        runId: null,
      },
      prev,
      now,
    );
  });
  return finish(db, 'correct', { ...base, eventId: prev.eventId, country: prev.countryCode }, prev, option);
}

/** Remove uma opção (nova versão `retracted` editorial: o agente não a recria). */
export async function removeOption(
  db: Database,
  optionId: string,
  base: EditorialBase,
): Promise<CorrectionResult> {
  assertActor(base.actor);
  const now = base.now ?? new Date();
  const prev = await currentById(db, optionId);
  if (prev.status === 'retracted' && prev.producedBy.startsWith('editorial:'))
    throw new WtwError('conflict', 'Opção já removida.');
  const option = await db.transaction(async (tx) =>
    insertVersion(
      tx,
      {
        ...stripVersionFields(prev),
        status: 'retracted',
        lastVerifiedAt: now,
        producedBy: `editorial:${base.actor}`,
        runId: null,
      },
      prev,
      now,
    ),
  );
  return finish(db, 'remove', { ...base, eventId: prev.eventId, country: prev.countryCode }, prev, option);
}

/** Enfileira uma reexecução manual do agente (consumida pelo worker/CLI `wtw:run`). */
export async function queueRerun(
  db: Database,
  input: EditorialBase & { eventId: string; country: string; mode?: 'full' | 'revalidate' },
): Promise<{ runId: string; correctionId: string }> {
  assertActor(input.actor);
  const now = input.now ?? new Date();
  const country = input.country.toUpperCase();
  const [run] = await db
    .insert(wtwRun)
    .values({
      runKey: `${input.eventId}:${country}:manual:${now.toISOString()}`,
      eventId: input.eventId,
      countryCode: country,
      window: 'manual',
      mode: input.mode ?? 'full',
      status: 'queued',
      requestedBy: `editorial:${input.actor}`,
      scheduledFor: now,
    })
    .returning({ id: wtwRun.id });
  const correctionId = await record(db, {
    eventId: input.eventId,
    countryCode: country,
    action: 'rerun',
    actor: input.actor,
    reason: input.reason,
    after: { run_id: run!.id, mode: input.mode ?? 'full' },
    reportedAt: input.reportedAt ?? null,
  });
  return { runId: run!.id, correctionId };
}
