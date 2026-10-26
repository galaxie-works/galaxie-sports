import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  changeFeed,
  copyTemplate,
  reviewDecision,
  reviewItem,
  reviewLog,
  reviewOverride,
  type Database,
} from '@galaxie/db';
import {
  applyGlossaryDecisions,
  applyGlossaryOverrides,
  loadKnowledge,
  readReviewOverrides,
  seedSemantic,
  type KnowledgeBase,
} from '@galaxie/knowledge';
import { FakeLlmClient } from '../src/llm/fake.js';
import { pendingSuggestions, reviewPurpose, SuggestionReviewer } from '../src/review/run.js';
import type { ReviewModelOutput } from '../src/review/schema.js';
import { disposableDb } from './helpers.js';

/*
 * Agente de revisão de sugestões (docs/06 §2.1) com o provedor falso: a sugestão aceita entra no ar
 * como edição no banco (tabelas da API, change feed, auditoria) e sobrevive ao próximo seed; a recusada
 * fica com o veredito e o item segue "precisa de revisão".
 */

const { setup, teardown } = disposableDb();
let db: Database;
let kb: KnowledgeBase;

const EDITED = 'copy:pt-BR.cheer-4';
const TERM = 'glossary:pt-BR.torcedor';
const BROKEN = 'copy:pt-BR.cheer-3';
const REJECTED = 'copy:pt-BR.rivalry-1';
const COUPLED = 'copy:pt-BR.anticipate-3-d1';
const ADMIN = 'teste.admin@galaxie.test';

const REPLIES: Record<string, ReviewModelOutput> = {
  // o admin esqueceu a vírgula: o modelo corrige e aprova
  [EDITED]: {
    decision: 'accept_with_changes',
    fields: [{ field: 'template', value_json: JSON.stringify('Pra cima deles, {nickname}! Hoje é dia!') }],
    reason: 'Texto bom; acrescentei a vírgula do vocativo.',
    adjustments: ['vírgula antes de {nickname}'],
  },
  // a edição proposta vale como veio
  [TERM]: { decision: 'accept', fields: [], reason: 'Exemplo mais natural, mesmo sentido.', adjustments: [] },
  // o modelo aceita, mas troca a variável: a validação recusa
  [BROKEN]: {
    decision: 'accept_with_changes',
    fields: [{ field: 'template', value_json: JSON.stringify('Vai, {time}!') }],
    reason: 'Ajustei o texto.',
    adjustments: [],
  },
  // a edição proposta (só o momento) vale como veio
  [COUPLED]: { decision: 'accept', fields: [], reason: 'Momento coerente.', adjustments: [] },
  [REJECTED]: {
    decision: 'reject',
    fields: [],
    reason: 'A sugestão deixa o texto agressivo com o rival; o tom precisa seguir lúdico.',
    adjustments: [],
  },
};

const llm = new FakeLlmClient((req) => {
  const id = Object.keys(REPLIES).find((k) => req.purpose === reviewPurpose(k));
  if (!id) return new Error(`sem resposta para ${req.purpose}`);
  return { data: REPLIES[id], model: 'fake-gemini' };
});

async function suggest(itemId: string, comment: string, fields: Record<string, unknown> | null) {
  const [item] = await db.select().from(reviewItem).where(eq(reviewItem.id, itemId));
  const values = {
    itemId,
    status: 'draft' as const,
    reviewHash: item!.reviewHash,
    suggestion: { comment, fields },
    decidedBy: ADMIN,
    aiVerdict: null,
  };
  await db
    .insert(reviewDecision)
    .values(values)
    .onConflictDoUpdate({ target: reviewDecision.itemId, set: values });
}

const decision = async (itemId: string) =>
  (await db.select().from(reviewDecision).where(eq(reviewDecision.itemId, itemId)))[0]!;
const catalog = async (itemId: string) =>
  (await db.select().from(reviewItem).where(eq(reviewItem.id, itemId)))[0]!;
const copyRow = async (key: string) =>
  (await db.select().from(copyTemplate).where(eq(copyTemplate.key, key)))[0]!;

beforeAll(async () => {
  db = await setup();
  kb = await loadKnowledge();
  await seedSemantic(db, kb);
  await suggest(EDITED, 'Mais energia no fim.', { template: 'Pra cima deles {nickname}! Hoje é dia!' });
  await suggest(TERM, 'Exemplo mais natural.', { example: 'A torcida lotou a arquibancada.' });
  await suggest(BROKEN, 'Deixar mais animado.', { template: 'Vai, {team}! É hoje!' });
  await suggest(REJECTED, 'Pode provocar mais o rival.', null);
}, 120_000);

afterAll(teardown);

describe('review-suggestions', () => {
  it('lista as sugestões em aberto e decide cada uma', async () => {
    expect((await pendingSuggestions(db)).map((p) => p.id).sort()).toEqual(
      [EDITED, TERM, BROKEN, REJECTED].sort(),
    );
    const reviewer = new SuggestionReviewer({ db, llm, knowledge: kb });
    const outcomes = await reviewer.run();
    const by = Object.fromEntries(outcomes.map((o) => [o.itemId, o]));
    expect(by[EDITED]!.outcome).toBe('adjusted');
    expect(by[TERM]!.outcome).toBe('accepted');
    expect(by[BROKEN]!.outcome).toBe('rejected');
    expect(by[BROKEN]!.validation.join()).toMatch(/variáveis alteradas/);
    expect(by[REJECTED]!.outcome).toBe('rejected');
    // nada mais em aberto para avaliar (a recusa não volta para a fila sozinha)
    expect(await pendingSuggestions(db)).toEqual([]);
  });

  it('aceita: a edição vai para as tabelas da API, aprovada, com auditoria e change feed', async () => {
    const row = await copyRow('pt-BR.cheer-4');
    expect(row.template).toBe('Pra cima deles, {nickname}! Hoje é dia!');
    expect(row.reviewStatus).toBe('approved');

    const d = await decision(EDITED);
    const item = await catalog(EDITED);
    expect(d).toMatchObject({ status: 'approved', suggestion: null, decidedBy: 'fake' });
    expect(d.reviewHash).toBe(item.reviewHash);
    expect(item.content.template).toBe(row.template);
    expect(d.aiVerdict).toMatchObject({ outcome: 'adjusted', by: 'fake', model: 'fake-gemini' });

    const [o] = await db.select().from(reviewOverride).where(eq(reviewOverride.itemId, EDITED));
    expect(o).toMatchObject({
      fields: { template: row.template },
      base: { template: 'Pra cima deles, {nickname}!' },
      source: 'fake',
      reviewHash: item.reviewHash,
    });

    const logs = await db.select().from(reviewLog).where(eq(reviewLog.itemId, EDITED));
    expect(logs.map((l) => [l.action, l.toStatus, l.actor])).toContainEqual([
      'ai_approve',
      'approved',
      'fake',
    ]);
    const feed = await db
      .select()
      .from(changeFeed)
      .where(and(eq(changeFeed.entityType, 'copy_template'), eq(changeFeed.entityId, 'pt-BR.cheer-4')));
    expect(feed.length).toBeGreaterThanOrEqual(1);
  });

  it('glossário: a API lê o YAML com a edição e a aprovação por cima', async () => {
    const overrides = await readReviewOverrides(db);
    const decisions = await db
      .select({
        itemId: reviewDecision.itemId,
        status: reviewDecision.status,
        reviewHash: reviewDecision.reviewHash,
      })
      .from(reviewDecision);
    const terms = applyGlossaryDecisions(applyGlossaryOverrides(kb.glossary, overrides), decisions);
    const t = terms.find((x) => x.locale === 'pt-BR' && x.entry.key === 'torcedor')!;
    expect(t.entry.example).toBe('A torcida lotou a arquibancada.');
    expect(t.entry.review_status).toBe('approved');
  });

  it('recusa: o item segue "precisa de revisão" com o motivo guardado', async () => {
    const broken = await decision(BROKEN);
    expect(broken.suggestion).not.toBeNull();
    expect(broken.status).toBe('draft');
    expect(broken.aiVerdict).toMatchObject({ outcome: 'rejected' });
    expect(broken.aiVerdict!.reason).toMatch(/^Validação automática/);
    expect((await copyRow('pt-BR.cheer-3')).template).toBe('Vai, {team}!');

    const rejected = await decision(REJECTED);
    expect(rejected.aiVerdict).toMatchObject({
      outcome: 'rejected',
      reason: 'A sugestão deixa o texto agressivo com o rival; o tom precisa seguir lúdico.',
    });
    const logs = await db.select().from(reviewLog).where(eq(reviewLog.itemId, REJECTED));
    expect(logs.map((l) => l.action)).toContain('ai_reject');
    expect(
      await db
        .select()
        .from(reviewOverride)
        .where(sql`${reviewOverride.itemId} in (${BROKEN}, ${REJECTED})`),
    ).toEqual([]);
  });

  it('uma sugestão nova do admin (veredito apagado) volta para a fila', async () => {
    await suggest(REJECTED, 'Só trocar "joga hoje" por "entra em campo hoje".', null);
    expect((await pendingSuggestions(db)).map((p) => p.id)).toEqual([REJECTED]);
  });

  it('o próximo deploy (seed) não desfaz a edição aprovada', async () => {
    const result = await seedSemantic(db, kb);
    expect(result.review.overrides).toMatchObject({ applied: 2, conflicts: 0 });
    const row = await copyRow('pt-BR.cheer-4');
    expect(row.template).toBe('Pra cima deles, {nickname}! Hoje é dia!');
    expect(row.reviewStatus).toBe('approved');
    const d = await decision(EDITED);
    expect((await catalog(EDITED)).reviewHash).toBe(d.reviewHash);
  });

  it('se o YAML mudar o mesmo campo depois, vale o YAML (e a aprovação fica desatualizada)', async () => {
    const edited: KnowledgeBase = {
      ...kb,
      copyTemplates: kb.copyTemplates.map((t) =>
        t.locale === 'pt-BR' && t.entry.key === 'cheer-4'
          ? { ...t, entry: { ...t.entry, template: 'Pra cima, {nickname}!' } }
          : t,
      ),
    };
    const result = await seedSemantic(db, edited);
    expect(result.review.overrides.conflicts).toBe(1);
    const row = await copyRow('pt-BR.cheer-4');
    expect(row.template).toBe('Pra cima, {nickname}!');
    expect(row.reviewStatus).toBe('draft');
    // de volta ao YAML de antes, a edição e a aprovação voltam a valer
    await seedSemantic(db, kb);
    expect((await copyRow('pt-BR.cheer-4')).reviewStatus).toBe('approved');
  });

  it('recusa a sugestão que, junto da edição anterior do item, cairia em conflito com o YAML', async () => {
    // edição anterior do texto feita sobre um YAML que depois mudou (o base não é mais o do YAML)
    const yaml = (await catalog(COUPLED)).content;
    const previous = {
      itemId: COUPLED,
      fields: { template: 'Hoje tem {nickname}! Contagem regressiva ligada' },
      base: { template: 'Amanhã tem {nickname}!' },
      reviewHash: 'hash-anterior',
      source: 'fake',
    };
    await db.insert(reviewOverride).values(previous);
    // a sugestão nova só troca o momento: entraria sem o texto que combina com ele
    await suggest(COUPLED, 'É no dia do jogo.', { momentum: 'today' });
    const reviewer = new SuggestionReviewer({ db, llm, knowledge: kb });
    const [outcome] = await reviewer.run({ itemIds: [COUPLED] });
    expect(outcome).toMatchObject({ itemId: COUPLED, outcome: 'rejected' });
    expect(outcome!.validation.join()).toMatch(/não se encaixa no YAML atual/);
    // nada muda no ar: a edição anterior fica como estava e o catálogo segue o YAML
    const [o] = await db.select().from(reviewOverride).where(eq(reviewOverride.itemId, COUPLED));
    expect(o).toMatchObject({ fields: previous.fields, base: previous.base });
    expect((await catalog(COUPLED)).content).toEqual(yaml);
    expect((await decision(COUPLED)).status).toBe('draft');
  });
});
