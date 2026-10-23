import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { reviewDecision, reviewItem, teamProfile, type Database } from '@galaxie/db';
import { loadKnowledge, type KnowledgeBase } from '../src/load.js';
import { reviewItemId } from '../src/review.js';
import { seedSemantic } from '../src/seed.js';
import { createTestDb } from './helpers.js';

/*
 * Decisões do painel de revisão × seed (docs/06 §2.1): a aprovação feita no painel sobrevive ao próximo
 * deploy (o YAML ainda diz draft), mas não aprova um conteúdo que mudou depois dela.
 */

let db: Database;
let drop: () => Promise<void>;
let kb: KnowledgeBase;

beforeAll(async () => {
  ({ db, drop } = await createTestDb());
  kb = await loadKnowledge();
  await seedSemantic(db, kb);
}, 60_000);

afterAll(async () => {
  if (drop) await drop();
});

const statusOf = async (slug: string) =>
  (
    await db
      .select({ s: teamProfile.reviewStatus, texts: teamProfile.texts })
      .from(teamProfile)
      .where(eq(teamProfile.slug, slug))
  )[0]!;

async function decide(itemId: string, status: 'approved' | 'draft') {
  const [item] = await db.select().from(reviewItem).where(eq(reviewItem.id, itemId));
  await db
    .insert(reviewDecision)
    .values({ itemId, status, reviewHash: item!.reviewHash, decidedBy: 'teste.admin@galaxie.test' })
    .onConflictDoUpdate({ target: reviewDecision.itemId, set: { status, reviewHash: item!.reviewHash } });
}

/** A mesma base com outro apelido para o Palmeiras (simula uma edição no YAML). */
function withEditedPalmeiras(): KnowledgeBase {
  return {
    ...kb,
    teams: kb.teams.map((t) =>
      t.entry.slug === 'palmeiras'
        ? { ...t, entry: { ...t.entry, nicknames: [...t.entry.nicknames, 'Alviverde'] } }
        : t,
    ),
  };
}

describe('catálogo da revisão', () => {
  it('o seed grava semantic.review_item com tudo o que pode ser revisado', async () => {
    const rows = await db.select({ id: reviewItem.id, kind: reviewItem.kind }).from(reviewItem);
    const kinds = new Set(rows.map((r) => r.kind));
    expect([...kinds].sort()).toEqual(['competition', 'copy', 'derby', 'glossary', 'team', 'translation']);
    const [p] = await db.select().from(reviewItem).where(eq(reviewItem.id, 'team:palmeiras'));
    expect(p).toMatchObject({ kind: 'team', market: 'BR', sport: 'football', title: 'Palmeiras' });
    expect(p!.content).toHaveProperty('nicknames');
  });
});

describe('decisões × próximo deploy', () => {
  it('aprovação do painel vale sobre o YAML no reseed (perfil e tradução)', async () => {
    const translation = reviewItemId('translation', 'team:palmeiras', 'es');
    await decide('team:palmeiras', 'approved');
    await decide(translation, 'approved');
    const result = await seedSemantic(db, kb);
    expect(result.review.decided).toBeGreaterThanOrEqual(2);
    expect(result.review.stale).toBe(0);
    const p = await statusOf('palmeiras');
    expect(p.s).toBe('approved');
    expect(p.texts['es']!.review_status).toBe('approved');
    // o resto segue o YAML
    const yaml = kb.teams.find((t) => t.entry.slug === 'corinthians')!.entry.review_status;
    expect((await statusOf('corinthians')).s).toBe(yaml);
  });

  it('voltar para rascunho no painel também vence o YAML', async () => {
    await decide('team:palmeiras', 'draft');
    await seedSemantic(db, kb);
    expect((await statusOf('palmeiras')).s).toBe('draft');
    await decide('team:palmeiras', 'approved');
    await seedSemantic(db, kb);
    expect((await statusOf('palmeiras')).s).toBe('approved');
  });

  it('se o conteúdo mudar no YAML, a decisão fica desatualizada e volta a valer o status do YAML', async () => {
    const edited = withEditedPalmeiras();
    const result = await seedSemantic(db, edited);
    expect(result.review.stale).toBe(1);
    const yaml = kb.teams.find((t) => t.entry.slug === 'palmeiras')!.entry.review_status;
    expect((await statusOf('palmeiras')).s).toBe(yaml);
    // o catálogo passa a ter o hash novo: o painel mostra a decisão como desatualizada
    const [item] = await db.select().from(reviewItem).where(eq(reviewItem.id, 'team:palmeiras'));
    const [decision] = await db
      .select()
      .from(reviewDecision)
      .where(eq(reviewDecision.itemId, 'team:palmeiras'));
    expect(item!.reviewHash).not.toBe(decision!.reviewHash);
    // o seed nunca escreve nas decisões
    expect(decision!.status).toBe('approved');

    // de volta ao conteúdo revisado, a decisão volta a valer
    await seedSemantic(db, kb);
    expect((await statusOf('palmeiras')).s).toBe('approved');
  });

  it('item que sai do YAML sai do catálogo (a decisão fica, inofensiva)', async () => {
    const without: KnowledgeBase = { ...kb, glossary: kb.glossary.slice(1) };
    const gone = reviewItemId('glossary', `${kb.glossary[0]!.locale}.${kb.glossary[0]!.entry.key}`);
    await seedSemantic(db, without);
    expect(await db.select().from(reviewItem).where(eq(reviewItem.id, gone))).toHaveLength(0);
    await seedSemantic(db, kb);
    expect(await db.select().from(reviewItem).where(eq(reviewItem.id, gone))).toHaveLength(1);
  });
});
