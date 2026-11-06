/**
 * Escudo de time ou de competição enviado no painel (Ajustes → Escudos), um de cada vez, sem passar pela
 * importação do acervo inteiro:
 *
 * - o asset fica com `origin = acervo` e `acervo = painel` (`PANEL_ACERVO`): a API trata como qualquer escudo
 *   do acervo (flag `ASSETS_CUSTOM_LOGOS`, `logo_formats`, `logo_sizes`, cores do time);
 * - liga em `custom_logo_asset_id` do time ou da competição; o logo do fornecedor nunca é tocado;
 * - o anterior fica em `enrich.logo_upload` (alvo `team`/`competition`) para voltar com `revertPanelCrest`;
 * - a importação do acervo (`assets:acervo`) não troca nem desliga um escudo do painel: o envio é a decisão
 *   mais recente. Para voltar ao escudo do pacote, use Voltar no painel.
 */
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Database } from './client.js';
import { publishChange } from './change-feed.js';
import {
  asset,
  competition,
  logoUpload,
  participant,
  type AssetPalette,
  type AssetVariants,
} from './schema/index.js';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
type Reader = Pick<Database, 'select'>;

/** Id de acervo dos escudos enviados no painel (`core.asset.acervo`). */
export const PANEL_ACERVO = 'painel';

export const CREST_UPLOAD_TARGETS = ['team', 'competition'] as const;
export type CrestUploadTarget = (typeof CREST_UPLOAD_TARGETS)[number];

export interface CrestTargetRef {
  type: CrestUploadTarget;
  /** Id do time (`core.participant`) ou da competição (`core.competition`). */
  id: string;
}

/** Rastro interno do asset (nunca publicado), único por alvo e arquivo. */
export const panelCrestSourceUrl = (target: CrestTargetRef, sha256: string) =>
  `painel://${target.type}/${target.id}/${sha256}`;

/** O que já está no storage (`prepareCrest` de `@galaxie/crests`). */
export interface PanelCrestFile {
  storageKey: string;
  sha256: string;
  width: number | null;
  height: number | null;
  bytes: number;
  palette: AssetPalette | null;
  variants: AssetVariants;
}

export class CrestTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CrestTargetError';
  }
}

const checkTarget = (target: CrestTargetRef) => {
  if (!CREST_UPLOAD_TARGETS.includes(target?.type) || !target.id?.trim())
    throw new CrestTargetError(`Alvo de escudo inválido: ${String(target?.type)}`);
};

async function currentCrest(tx: Tx, target: CrestTargetRef): Promise<{ id: string | null } | undefined> {
  const table = target.type === 'team' ? participant : competition;
  const [row] = await tx
    .select({ id: table.customLogoAssetId })
    .from(table)
    .where(eq(table.id, target.id))
    .for('update');
  return row;
}

async function setCrestId(tx: Tx, target: CrestTargetRef, assetId: string | null): Promise<void> {
  const table = target.type === 'team' ? participant : competition;
  await tx
    .update(table)
    .set({ customLogoAssetId: assetId, updatedAt: sql`now()` })
    .where(eq(table.id, target.id));
}

/** A API purga as respostas que mostram o escudo (e as cores do time, que saem dele). */
async function publishCrestChange(tx: Tx, target: CrestTargetRef): Promise<void> {
  await publishChange(tx, {
    topic: 'catalog',
    entityType: target.type === 'team' ? 'participant' : 'competition',
    entityId: target.id,
    payload: { reason: 'logo' },
  });
}

/**
 * Registra o escudo enviado (os arquivos já estão no storage) e liga no time ou na competição. Mesmo
 * arquivo de novo = o mesmo asset. `CrestTargetError` se o alvo não existe.
 */
export async function setPanelCrest(
  db: Database,
  target: CrestTargetRef,
  file: PanelCrestFile,
  by: string,
): Promise<{ assetId: string; previousAssetId: string | null; uploadId: string }> {
  checkTarget(target);
  const who = by?.trim();
  if (!who) throw new CrestTargetError('by vazio.');
  return db.transaction(async (tx) => {
    const current = await currentCrest(tx, target);
    if (!current) throw new CrestTargetError('Time ou competição inexistente.');
    const values = {
      kind: target.type === 'team' ? ('team_logo' as const) : ('league_logo' as const),
      storageKey: file.storageKey,
      sha256: file.sha256,
      width: file.width,
      height: file.height,
      bytes: file.bytes,
      fetchedAt: new Date(),
      palette: file.palette,
      origin: 'acervo' as const,
      acervo: PANEL_ACERVO,
      variants: file.variants,
    };
    const [row] = await tx
      .insert(asset)
      .values({ sourceUrl: panelCrestSourceUrl(target, file.sha256), ...values })
      .onConflictDoUpdate({ target: asset.sourceUrl, set: values })
      .returning({ id: asset.id });
    await setCrestId(tx, target, row!.id);
    const [upload] = await tx
      .insert(logoUpload)
      .values({
        targetType: target.type,
        targetId: target.id,
        variant: 'light',
        assetId: row!.id,
        previousAssetId: current.id,
        uploadedBy: who,
      })
      .returning({ id: logoUpload.id });
    await publishCrestChange(tx, target);
    return { assetId: row!.id, previousAssetId: current.id, uploadId: upload!.id };
  });
}

/**
 * Volta ao escudo de antes do último envio ainda valendo (o do acervo, ou null = o do fornecedor). false se
 * não há envio a desfazer ou se o escudo já mudou depois dele (por exemplo, numa importação).
 */
export async function revertPanelCrest(db: Database, target: CrestTargetRef, by: string): Promise<boolean> {
  checkTarget(target);
  const who = by?.trim();
  if (!who) throw new CrestTargetError('by vazio.');
  return db.transaction(async (tx) => {
    const current = await currentCrest(tx, target);
    if (!current) return false;
    const [last] = await tx
      .select()
      .from(logoUpload)
      .where(
        and(
          eq(logoUpload.targetType, target.type),
          eq(logoUpload.targetId, target.id),
          sql`${logoUpload.revertedAt} is null`,
        ),
      )
      .orderBy(desc(logoUpload.createdAt), desc(logoUpload.id))
      .limit(1);
    if (!last || last.assetId !== current.id) return false;
    await setCrestId(tx, target, last.previousAssetId);
    await tx
      .update(logoUpload)
      .set({ revertedAt: new Date(), revertedBy: who })
      .where(eq(logoUpload.id, last.id));
    await publishCrestChange(tx, target);
    return true;
  });
}

/**
 * Quais destes alvos estão hoje com um escudo enviado no painel (a importação do acervo deixa esses como
 * estão). Chaves `team:<id>` e `competition:<id>`.
 */
export async function panelCrestTargets(
  db: Reader,
  targets: { team?: string[]; competition?: string[] },
): Promise<Set<string>> {
  const out = new Set<string>();
  for (const kind of CREST_UPLOAD_TARGETS) {
    const ids = targets[kind] ?? [];
    const table = kind === 'team' ? participant : competition;
    for (let i = 0; i < ids.length; i += 1000) {
      const rows = await db
        .select({ id: table.id })
        .from(table)
        .innerJoin(asset, eq(asset.id, table.customLogoAssetId))
        .where(and(inArray(table.id, ids.slice(i, i + 1000)), eq(asset.acervo, PANEL_ACERVO)));
      for (const r of rows) out.add(`${kind}:${r.id}`);
    }
  }
  return out;
}
