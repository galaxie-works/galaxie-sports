import { beforeAll, describe, expect, it } from 'vitest';
import { loadKnowledge, type KnowledgeBase } from './load.js';
import {
  applyGlossaryDecisions,
  buildReviewItems,
  decidedStatuses,
  effectiveReviewStatus,
  glossaryKey,
  reviewContent,
  reviewHash,
  reviewItemId,
  type ReviewItem,
} from './review.js';
import { buildSeedRows } from './seed.js';

let kb: KnowledgeBase;
let items: ReviewItem[];
const byId = (id: string) => items.find((i) => i.id === id)!;

beforeAll(async () => {
  kb = await loadKnowledge();
  items = buildReviewItems(kb);
});

describe('buildReviewItems', () => {
  it('cobre perfis, clássicos, competições, copy, glossário e traduções, com ids únicos', () => {
    const kinds = new Set(items.map((i) => i.kind));
    expect([...kinds].sort()).toEqual([
      'all-time',
      'competition',
      'copy',
      'derby',
      'glossary',
      'team',
      'translation',
    ]);
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
    expect(items.filter((i) => i.kind === 'team')).toHaveLength(kb.teams.length);
    expect(items.filter((i) => i.kind === 'translation')).toHaveLength(kb.texts.length);
  });

  it('perfil: conteúdo legível, mercado e arquivo de origem', () => {
    const p = byId('team:palmeiras');
    expect(p).toMatchObject({
      kind: 'team',
      key: 'palmeiras',
      sport: 'football',
      market: 'BR',
      title: 'Palmeiras',
    });
    expect(p.sourceFile).toBe('data/knowledge/football/teams/br.yaml');
    expect(p.content).toHaveProperty('nicknames');
    expect(p.content).not.toHaveProperty('review_status');
  });

  it('tradução: traz os campos do original no idioma-base', () => {
    const tr = byId(reviewItemId('translation', 'team:palmeiras', 'es'));
    expect(tr).toMatchObject({
      kind: 'translation',
      locale: 'es',
      parentKind: 'team',
      originalLocale: 'pt-BR',
    });
    expect(Object.keys(tr.original!)).toEqual(expect.arrayContaining(['identity']));
    expect(tr.original!['identity']).toEqual(
      kb.teams.find((t) => t.entry.slug === 'palmeiras')!.entry.identity,
    );
  });

  it('clássico entre países é INT; copy e glossário ficam no mercado do locale', () => {
    const intl = items.find((i) => i.kind === 'derby' && i.market === 'INT');
    expect(intl).toBeDefined();
    expect(items.find((i) => i.kind === 'copy' && i.locale === 'es-AR')?.market).toBe('AR');
  });

  it('o hash ignora o review_status: aprovar no YAML não invalida a decisão do painel', () => {
    const entry = kb.teams.find((t) => t.entry.slug === 'palmeiras')!.entry;
    expect(reviewHash(reviewContent({ ...entry, review_status: 'approved' }))).toBe(
      byId('team:palmeiras').reviewHash,
    );
    expect(reviewHash(reviewContent({ ...entry, nicknames: ['Outro'] }))).not.toBe(
      byId('team:palmeiras').reviewHash,
    );
  });
});

describe('decisões', () => {
  it('valem enquanto o conteúdo for o revisado; desatualizadas voltam ao YAML', () => {
    const item = { yamlStatus: 'draft' as const, reviewHash: 'abc' };
    expect(effectiveReviewStatus(item, undefined)).toEqual({ status: 'draft', decided: false, stale: false });
    expect(effectiveReviewStatus(item, { status: 'approved', reviewHash: 'abc' })).toEqual({
      status: 'approved',
      decided: true,
      stale: false,
    });
    expect(effectiveReviewStatus(item, { status: 'approved', reviewHash: 'xyz' })).toEqual({
      status: 'draft',
      decided: false,
      stale: true,
    });
  });

  it('buildSeedRows aplica o status decidido em perfis, copy e traduções', () => {
    const palmeiras = byId('team:palmeiras');
    const copy = items.find((i) => i.kind === 'copy')!;
    const tr = byId(reviewItemId('translation', 'team:palmeiras', 'es'));
    const decided = decidedStatuses(items, [
      { itemId: palmeiras.id, status: 'approved', reviewHash: palmeiras.reviewHash },
      { itemId: copy.id, status: 'approved', reviewHash: copy.reviewHash },
      { itemId: tr.id, status: 'approved', reviewHash: tr.reviewHash },
      // decisão sobre um conteúdo antigo não vale
      { itemId: 'team:corinthians', status: 'approved', reviewHash: 'antigo' },
    ]);
    expect(decided.size).toBe(3);
    const rows = buildSeedRows(kb, decided);
    expect(rows.teams.find((t) => t.slug === 'palmeiras')!.reviewStatus).toBe('approved');
    const yamlOf = (slug: string) => kb.teams.find((t) => t.entry.slug === slug)!.entry.review_status;
    expect(rows.teams.find((t) => t.slug === 'corinthians')!.reviewStatus).toBe(yamlOf('corinthians'));
    expect(rows.teams.find((t) => t.slug === 'palmeiras')!.texts['es']!.review_status).toBe('approved');
    expect(rows.copy.find((c) => c.key === copy.key)!.reviewStatus).toBe('approved');
    // sem decisões, o YAML manda
    expect(buildSeedRows(kb).teams.find((t) => t.slug === 'palmeiras')!.reviewStatus).toBe(
      yamlOf('palmeiras'),
    );
  });

  it('histórico geral: item próprio por clássico e por par; o clássico não muda de hash por ele', () => {
    const pair = byId('all-time:pair:palmeiras-fluminense');
    expect(pair).toMatchObject({ kind: 'all-time', market: 'BR', locale: null, yamlStatus: 'draft' });
    expect(pair.content).toMatchObject({ teams: ['palmeiras', 'fluminense'] });
    expect((pair.content.all_time as Record<string, unknown>).review_status).toBeUndefined();
    const all = byId('all-time:derby:choque-rei');
    expect(all).toMatchObject({ title: 'Choque-Rei', yamlStatus: 'draft' });
    expect(byId('derby:choque-rei').content.all_time).toBeUndefined();
    const decided = decidedStatuses(items, [
      { itemId: all.id, status: 'approved', reviewHash: all.reviewHash },
      { itemId: pair.id, status: 'approved', reviewHash: pair.reviewHash },
    ]);
    const rows = buildSeedRows(kb, decided);
    const derby = rows.derbies.find((d) => d.slug === 'choque-rei')!;
    expect(derby.allTime!.review_status).toBe('approved');
    expect(derby.reviewStatus).toBe('approved');
    const row = rows.pairs.find((p) => p.slug === 'palmeiras-fluminense')!;
    expect(row).toMatchObject({ reviewStatus: 'approved', allTime: { review_status: 'approved' } });
    const yaml = buildSeedRows(kb);
    expect(yaml.pairs.find((p) => p.slug === 'palmeiras-fluminense')!.reviewStatus).toBe('draft');
    expect(yaml.derbies.find((d) => d.slug === 'choque-rei')!.allTime!.review_status).toBe('draft');
  });

  it('applyGlossaryDecisions troca o status só do termo decidido sobre o mesmo conteúdo', () => {
    const [first, second] = kb.glossary;
    const item = byId(reviewItemId('glossary', glossaryKey(first!)));
    const out = applyGlossaryDecisions(kb.glossary, [
      { itemId: item.id, status: 'approved', reviewHash: item.reviewHash },
      { itemId: reviewItemId('glossary', glossaryKey(second!)), status: 'approved', reviewHash: 'antigo' },
    ]);
    expect(out[0]!.entry.review_status).toBe('approved');
    expect(out[1]!.entry.review_status).toBe(second!.entry.review_status);
    expect(applyGlossaryDecisions(kb.glossary, [])).toBe(kb.glossary);
  });
});
