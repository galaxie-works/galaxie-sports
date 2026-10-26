/**
 * Mapeamento do acervo de fotos da F1: para cada alvo, busca as candidatas na Commons, aplica as regras e grava
 * o manifesto e o relatório de cobertura. Não grava no banco nem no storage.
 *
 * Dois passos, com o mesmo código:
 * - `assets:commons --mapear` (dev): só as regras;
 * - `assets-commons-ordenar` (VPS, onde a chave do Gemini funciona): as regras e o ranqueamento do Gemini
 *   (`ranker`). A entrada ordenada guarda o modelo e a data (`ranking`) e não é refeita por nenhum dos dois passos
 *   sem `redo`: rodar de novo não muda nada (idempotente) e o mapeamento por regras não desfaz a ordem do Gemini.
 */
import { writeFileSync } from 'node:fs';
import { BudgetExceededError } from '@galaxie/ai-ledger';
import type { WikimediaClient } from './client.js';
import { discover as discoverTarget, type Discovery } from './discover.js';
import type { RankImage } from './gemini.js';
import { emptyManifest, mergeEntry, type CommonsManifest, type ManifestEntry } from './manifest.js';
import { targetKey, type CommonsTarget } from './scope.js';
import { choose, eligible, type AiJudgement, type Rejection } from './select.js';

/** Quantas candidatas (as melhores pelas regras) vão para o Gemini por alvo. */
export const AI_POOL = 12;
/** Miniatura enviada ao Gemini (só para o ranqueamento). */
const AI_THUMB_WIDTH = 512;

/** Ranqueamento por IA (Gemini em produção; falso nos testes). */
export interface Ranker {
  model: string;
  rank(images: RankImage[], subject: string, kind: 'driver' | 'car'): Promise<AiJudgement[]>;
}

export interface MapStats {
  key: string;
  candidates: number;
  eligible: number;
  chosen: number;
  ranking: 'gemini' | 'rules' | 'gemini falhou' | 'sem orçamento de IA' | 'já ordenado';
  rejected: Rejection[];
  note: string | null;
}

export interface MapOptions {
  revision: string;
  /** Com ranqueador: o alvo só entra no manifesto se o Gemini responder (senão fica como estava). */
  ranker?: Ranker | null;
  /** Refaz também os alvos já ordenados pelo Gemini. */
  redo?: boolean;
  log?: (m: string) => void;
  /** Busca das candidatas (a da Commons; injetável nos testes). */
  discover?: (client: WikimediaClient, target: CommonsTarget, thumbWidth: number) => Promise<Discovery>;
}

/** Alvo já ordenado pelo Gemini (só sai do manifesto com `redo`). */
export const isRanked = (e: ManifestEntry | undefined) => !!e?.ranking;

/**
 * Manifesto novo (entrada) com os alvos já ordenados de uma execução anterior: o alvo ordenado fica como estava,
 * com o carro de destaque da entrada (curadoria nova); alvos novos e não ordenados vêm da entrada. O destaque que
 * saiu da entrada sai também do alvo ordenado (senão voltaria a ser importado); só a curadoria manual da execução
 * anterior fica, salvo se a entrada traz `highlight_car: null` (o destaque foi tirado de propósito no git).
 */
export function mergeRanked(entries: ManifestEntry[], previous: ManifestEntry[]): ManifestEntry[] {
  const before = new Map(previous.map((e) => [e.target, e]));
  return entries.map((e) => {
    const p = before.get(e.target);
    if (!p || !isRanked(p)) return e;
    if (e.highlight_car != null) return { ...p, highlight_car: e.highlight_car };
    if (e.highlight_car === undefined && p.highlight_car?.match === 'manual') return p;
    const { highlight_car: _dropped, ...rest } = p;
    return rest;
  });
}

const subjectOf = (t: CommonsTarget) =>
  t.kind === 'driver' ? t.name : `${t.chassis.join(' / ')} (${t.year})`;

export async function mapCommons(
  client: WikimediaClient,
  targets: CommonsTarget[],
  previous: CommonsManifest | null,
  opts: MapOptions,
): Promise<{ manifest: CommonsManifest; stats: MapStats[] }> {
  const manifest = emptyManifest(opts.revision);
  const before = new Map((previous?.entries ?? []).map((e) => [e.target, e]));
  const done = new Set<string>();
  const stats: MapStats[] = [];
  const empty = (key: string, ranking: MapStats['ranking'], note: string | null): MapStats => ({
    key,
    candidates: 0,
    eligible: 0,
    chosen: 0,
    ranking,
    rejected: [],
    note,
  });
  // orçamento de IA do dia esgotado (ou IA desligada): os alvos seguintes nem buscam as candidatas
  let noBudget: string | null = null;
  for (const target of targets) {
    const key = targetKey(target);
    const prev = before.get(key);
    if (isRanked(prev) && !opts.redo) {
      // a ordem do Gemini fica; o alvo continua no manifesto como estava (laço final)
      stats.push(empty(key, 'já ordenado', null));
      continue;
    }
    if (opts.ranker && noBudget) {
      stats.push(empty(key, 'sem orçamento de IA', `pendente: ${noBudget}`));
      continue;
    }
    let d: Discovery;
    try {
      d = await (opts.discover ?? discoverTarget)(client, target, AI_THUMB_WIDTH);
    } catch (err) {
      // Wikimedia fora (atraso, erro): o alvo fica como estava no manifesto e volta na próxima varredura
      opts.log?.(`${key}: ${(err as Error).message}; fica para a próxima varredura`);
      stats.push(empty(key, 'rules', `pendente: ${(err as Error).message}`));
      continue;
    }
    // descoberta sem nenhuma candidata (identidade não conferida, categoria sumida) com galeria já mapeada: é
    // tratada como falha, e o alvo fica como estava — nunca apaga as fotos (Johansson, 25/10/2026). Arquivo apagado
    // na Commons sai do mesmo jeito: a importação o desvincula pela resposta `missing` (`imageInfoReport`)
    if (!d.candidates.length && prev?.photos.some((p) => p.match !== 'rejected')) {
      opts.log?.(`${key}: descoberta vazia (${d.note ?? 'sem candidatas'}); fica como estava`);
      stats.push(empty(key, 'rules', `pendente: descoberta vazia (${d.note ?? 'sem candidatas'})`));
      continue;
    }
    const { ok, rejected } = eligible(d);
    const pool = [...ok].sort((a, b) => b.ruleScore - a.ruleScore).slice(0, AI_POOL);
    let judgements: AiJudgement[] | null = null;
    if (opts.ranker && pool.length) {
      try {
        const images: RankImage[] = [];
        for (const e of pool) {
          const f = e.candidate.file;
          const { body, contentType } = await client.download(f.thumbUrl);
          images.push({ body, mime: contentType?.split(';')[0] ?? f.mime, title: f.title });
        }
        judgements = await opts.ranker.rank(images, subjectOf(target), target.kind);
      } catch (err) {
        // sem a resposta do Gemini o alvo não muda: a próxima execução tenta de novo
        const budget = err instanceof BudgetExceededError;
        if (budget) noBudget = err.message;
        opts.log?.(
          budget
            ? `${key}: ${err.message} O alvo e os seguintes ficam como estavam (voltam na próxima execução).`
            : `${key}: Gemini falhou (${(err as Error).message}); o alvo fica como estava`,
        );
        stats.push({
          ...empty(key, budget ? 'sem orçamento de IA' : 'gemini falhou', null),
          candidates: d.candidates.length,
          eligible: ok.length,
        });
        continue;
      }
    }
    const chosen = choose(d, pool, judgements);
    const entry: ManifestEntry = mergeEntry(target, d, chosen, prev);
    if (opts.ranker)
      entry.ranking = { by: 'gemini', model: opts.ranker.model, at: opts.revision, pool: pool.length };
    manifest.entries.push(entry);
    done.add(entry.target);
    const ranking = opts.ranker ? 'gemini' : 'rules';
    stats.push({
      key: entry.target,
      candidates: d.candidates.length,
      eligible: ok.length,
      chosen: entry.photos.filter((p) => p.match !== 'rejected').length,
      ranking,
      rejected,
      note: d.note,
    });
    opts.log?.(
      `${entry.target}: ${d.candidates.length} candidatas, ${ok.length} aceitas, ${entry.photos.length} no manifesto (${ranking})`,
    );
  }
  // alvos não refeitos (outros escopos, já ordenados, Wikimedia ou Gemini fora) continuam como estavam
  for (const e of previous?.entries ?? []) if (!done.has(e.target)) manifest.entries.push(e);
  manifest.entries.sort((a, b) => a.target.localeCompare(b.target));
  return { manifest, stats };
}

/** Relatório de cobertura (config/assets/commons/f1.cobertura.md). */
export function coverageReport(manifest: CommonsManifest, stats: MapStats[]): string {
  const lines = [
    '# Acervo de fotos da F1 — cobertura',
    '',
    `Revisão ${manifest.acervo.revision}. Gerado por \`assets:commons --mapear\` (regras) e \`assets-commons-ordenar\` (Gemini). Licenças aceitas: domínio público, CC0, CC BY, CC BY-SA.`,
    '',
    '| Alvo | Wikidata | Categoria da Commons | Fotos | Licenças | Ordem |',
    '|---|---|---|---|---|---|',
  ];
  for (const e of manifest.entries) {
    const kept = e.photos.filter((p) => p.match !== 'rejected');
    const licenses = [...new Set(kept.map((p) => p.license))].join(', ') || '—';
    lines.push(
      `| ${e.name} (\`${e.target}\`) | ${e.wikidata ?? '—'} | ${e.category ?? '—'} | ${kept.length}${e.note ? ` (${e.note})` : ''} | ${licenses} | ${e.ranking ? `Gemini (${e.ranking.model}, ${e.ranking.at})` : 'regras'} |`,
    );
  }
  if (stats.length) {
    lines.push(
      '',
      '## Última varredura',
      '',
      '| Alvo | Candidatas | Aceitas pelas regras | Escolhidas | Ordem | Recusas mais comuns |',
      '|---|---|---|---|---|---|',
    );
    for (const s of stats) {
      const reasons = new Map<string, number>();
      for (const r of s.rejected) {
        const k = r.reason.replace(/\(.*\)/, '').trim();
        reasons.set(k, (reasons.get(k) ?? 0) + 1);
      }
      const top = [...reasons]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([k, n]) => `${k} (${n})`)
        .join('; ');
      lines.push(
        `| \`${s.key}\` | ${s.candidates} | ${s.eligible} | ${s.chosen} | ${s.ranking} | ${top || '—'} |`,
      );
    }
  }
  return `${lines.join('\n')}\n`;
}

export function writeReport(path: string, text: string): void {
  writeFileSync(path, text);
}
