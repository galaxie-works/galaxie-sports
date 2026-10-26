/**
 * Decisões do painel sobre os perfis editoriais, levadas da VPS para o dev num arquivo (`panel-decisions.json`, ao lado
 * do profiles.json). A aprovação mora no banco de produção (`semantic.review_decision`), e o `--aplicar` roda no dev,
 * cujo banco não tem as decisões: o passo 1 (na VPS) as exporta e o passo 2 as lê do arquivo, sem banco.
 */
import { like } from 'drizzle-orm';
import { reviewDecision, type Database } from '@galaxie/db';
import { readReviewOverrides, type ReviewDecisionRef, type ReviewOverrideRef } from '@galaxie/knowledge';

export const PANEL_DECISIONS_FILE = 'panel-decisions.json';

export interface PanelDecisions {
  exportedAt: string;
  /** Host do banco consultado (sem usuário nem senha). */
  host: string;
  decisions: ReviewDecisionRef[];
  overrides: ReviewOverrideRef[];
}

/** Host (e porta) de uma URL de banco, sem credenciais; `?` se não der para ler. */
export function dbHost(url: string | undefined): string {
  try {
    return url ? new URL(url).host || '?' : '?';
  } catch {
    return '?';
  }
}

/** Decisões e edições do painel sobre os perfis (`editorial:*`), só leitura. */
export async function loadPanelDecisions(
  db: Database,
  host: string,
  now = new Date(),
): Promise<PanelDecisions> {
  const decisions = await db
    .select({
      itemId: reviewDecision.itemId,
      status: reviewDecision.status,
      reviewHash: reviewDecision.reviewHash,
    })
    .from(reviewDecision)
    .where(like(reviewDecision.itemId, 'editorial:%'));
  const overrides = (await readReviewOverrides(db)).filter((o) => o.itemId.startsWith('editorial:'));
  return { exportedAt: now.toISOString(), host, decisions, overrides };
}

/** Lê o arquivo exportado; formato inesperado é erro (melhor parar do que aplicar sem a proteção). */
export function parsePanelDecisions(text: string, source: string): PanelDecisions {
  const raw = JSON.parse(text) as Partial<PanelDecisions>;
  const isRef = (d: unknown): d is ReviewDecisionRef =>
    !!d &&
    typeof (d as ReviewDecisionRef).itemId === 'string' &&
    typeof (d as ReviewDecisionRef).status === 'string' &&
    typeof (d as ReviewDecisionRef).reviewHash === 'string';
  if (
    typeof raw.exportedAt !== 'string' ||
    !Array.isArray(raw.decisions) ||
    !raw.decisions.every(isRef) ||
    !Array.isArray(raw.overrides)
  )
    throw new Error(`${source}: arquivo de decisões do painel em formato inesperado.`);
  return {
    exportedAt: raw.exportedAt,
    host: typeof raw.host === 'string' ? raw.host : '?',
    decisions: raw.decisions,
    overrides: raw.overrides,
  };
}

/** Resumo para o terminal: de onde vieram e quantas; aviso quando não há nenhuma decisão. */
export function describePanelDecisions(p: PanelDecisions): string {
  const approved = p.decisions.filter((d) => d.status === 'approved').length;
  const head =
    `Decisões do painel: ${p.decisions.length} (editorial:*, ${approved} aprovada(s)) e ` +
    `${p.overrides.length} edição(ões), lidas de ${p.host} em ${p.exportedAt}.`;
  return p.decisions.length
    ? head
    : `${head}\nAVISO: nenhuma decisão editorial:* — confira se o banco consultado é o de produção.`;
}
