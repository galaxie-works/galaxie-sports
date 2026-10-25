import { beforeAll, describe, expect, it } from 'vitest';
import { buildKnowledgeBase, loadKnowledge, parseKnowledgeFile, type KnowledgeBase } from './load.js';
import {
  applyGlossaryOverrides,
  applyReviewOverrides,
  editableReviewFields,
  exportOverridesToYaml,
  mergeOverride,
  patchEntry,
  resolveOverride,
  type ReviewOverrideRef,
} from './overrides.js';
import { buildReviewItems, reviewContent } from './review.js';
import { buildSeedRows } from './seed.js';
import { validateKnowledge } from './validate.js';

/*
 * Edições aprovadas fora do YAML (semantic.review_override, docs/06 §2.1): aplicadas por cima do YAML
 * no seed e na leitura do glossário, sem sobrescrever uma mudança posterior do YAML no mesmo campo.
 */

let kb: KnowledgeBase;
const COPY = 'copy:pt-BR.cheer-3';
const item = (base: KnowledgeBase, id: string) => buildReviewItems(base).find((i) => i.id === id)!;

beforeAll(async () => {
  kb = await loadKnowledge();
});

describe('resolveOverride', () => {
  const o = { fields: { template: 'Vai, {team}! Rumo à vitória!' }, base: { template: 'Vai, {team}!' } };
  it('aplica quando o YAML ainda tem o valor de quando a edição foi feita', () => {
    expect(resolveOverride({ template: 'Vai, {team}!' }, o)).toBe('apply');
  });
  it('fica absorvida quando o YAML já tem o valor novo (exportado)', () => {
    expect(resolveOverride({ template: 'Vai, {team}! Rumo à vitória!' }, o)).toBe('absorbed');
  });
  it('conflito quando o YAML mudou o mesmo campo para outro valor: vale o YAML', () => {
    expect(resolveOverride({ template: 'Força, {team}!' }, o)).toBe('conflict');
  });
  it('item que saiu do YAML', () => {
    expect(resolveOverride(undefined, o)).toBe('missing');
  });
  it('remover um campo (null) e campo ausente no YAML', () => {
    expect(resolveOverride({ example: 'x' }, { fields: { example: null }, base: { example: 'x' } })).toBe(
      'apply',
    );
    expect(resolveOverride({}, { fields: { example: null }, base: { example: 'x' } })).toBe('absorbed');
  });
});

describe('applyReviewOverrides', () => {
  it('edita o item nas listas e no file.data, e o catálogo passa a ter o conteúdo e o hash novos', async () => {
    const before = item(kb, COPY);
    const overrides: ReviewOverrideRef[] = [
      {
        itemId: COPY,
        fields: { template: 'Vai, {team}! Hoje é dia!' },
        base: { template: before.content.template },
      },
    ];
    const result = applyReviewOverrides(kb, overrides);
    expect(result.applied).toEqual([COPY]);
    const after = item(result.kb, COPY);
    expect(after.content.template).toBe('Vai, {team}! Hoje é dia!');
    expect(after.reviewHash).not.toBe(before.reviewHash);
    // o status do YAML fica (a aprovação mora na decisão)
    expect(after.yamlStatus).toBe(before.yamlStatus);
    // a base original não muda
    expect(item(kb, COPY).content.template).toBe(before.content.template);
    // o file.data também (a validação lê dele)
    const file = result.kb.files.find((f) => f.rel === 'copy/pt-BR.yaml')!;
    expect(JSON.stringify(file.data)).toContain('Hoje é dia!');
    expect(JSON.stringify(kb.files.find((f) => f.rel === 'copy/pt-BR.yaml')!.data)).not.toContain(
      'Hoje é dia!',
    );
    // o seed grava o texto editado
    const rows = buildSeedRows(result.kb);
    expect(rows.copy.find((c) => c.key === 'pt-BR.cheer-3')!.template).toBe('Vai, {team}! Hoje é dia!');
    // e a base editada continua válida
    expect((await validateKnowledge(result.kb)).errors).toEqual([]);
  });

  it('variável desconhecida no template quebra a validação da base', async () => {
    const before = item(kb, COPY);
    const result = applyReviewOverrides(kb, [
      { itemId: COPY, fields: { template: 'Vai, {time}!' }, base: { template: before.content.template } },
    ]);
    const report = await validateKnowledge(result.kb);
    expect(report.errors.map((e) => e.code)).toContain('copy-placeholder');
  });

  it('conflito com o YAML: vale o YAML', () => {
    const result = applyReviewOverrides(kb, [
      { itemId: COPY, fields: { template: 'Vai, {team}! Hoje é dia!' }, base: { template: 'outro texto' } },
    ]);
    expect(result.conflicts).toEqual([COPY]);
    expect(result.kb).toBe(kb);
  });

  it('campo em conflito derruba a edição inteira do item, não só o campo (campos acoplados)', () => {
    // a edição trocou o texto para "hoje" e o momento para today; depois o YAML reescreveu o texto
    // ("Amanhã…", ainda D-1). Aplicar só o momento serviria "Amanhã…" no dia do jogo
    const id = 'copy:pt-BR.anticipate-3-d1';
    const before = item(kb, id);
    expect(before.content).toMatchObject({ momentum: 'D-1', template: expect.stringMatching(/^Amanhã/) });
    const result = applyReviewOverrides(kb, [
      {
        itemId: id,
        fields: { template: 'Hoje tem {nickname}! Contagem regressiva ligada', momentum: 'today' },
        base: { template: 'Amanhã tem {nickname}!', momentum: 'D-1' },
      },
    ]);
    expect(result.conflicts).toEqual([id]);
    expect(result.applied).toEqual([]);
    expect(item(result.kb, id).content).toEqual(before.content);
    expect(item(result.kb, id).reviewHash).toBe(before.reviewHash);
  });

  it('clássico e o histórico geral dele editam o mesmo item do YAML sem se perder', () => {
    const d = kb.derbies.find((x) => x.entry.all_time)!;
    const derbyId = `derby:${d.entry.slug}`;
    const allTimeId = `all-time:derby:${d.entry.slug}`;
    const allTime = item(kb, allTimeId).content.all_time as Record<string, unknown>;
    const result = applyReviewOverrides(kb, [
      { itemId: derbyId, fields: { origin: 'Origem revisada.' }, base: { origin: d.entry.origin ?? null } },
      {
        itemId: allTimeId,
        fields: { all_time: { ...allTime, as_of: '2026-10-01' } },
        base: { all_time: allTime },
      },
    ]);
    expect(result.applied).toEqual([derbyId, allTimeId]);
    const entry = result.kb.derbies.find((x) => x.entry.slug === d.entry.slug)!.entry;
    expect(entry.origin).toBe('Origem revisada.');
    expect(entry.all_time!.as_of).toBe('2026-10-01');
    // o status do bloco all_time fica o do YAML
    expect(entry.all_time!.review_status).toBe(d.entry.all_time!.review_status);
  });
});

describe('glossário na leitura da API', () => {
  it('aplica a edição sobre o termo lido do YAML', () => {
    const g = kb.glossary.find((t) => t.locale === 'pt-BR' && t.entry.key === 'torcedor')!;
    const id = 'glossary:pt-BR.torcedor';
    const terms = applyGlossaryOverrides(kb.glossary, [
      {
        itemId: id,
        fields: { example: 'A torcida lotou a arquibancada.' },
        base: { example: g.entry.example },
      },
    ]);
    const edited = terms.find((t) => t.locale === 'pt-BR' && t.entry.key === 'torcedor')!;
    expect(edited.entry.example).toBe('A torcida lotou a arquibancada.');
    expect(edited.entry.review_status).toBe(g.entry.review_status);
    // o hash da decisão aprovada junto é o do conteúdo editado (o mesmo do catálogo)
    const result = applyReviewOverrides(kb, [
      {
        itemId: id,
        fields: { example: 'A torcida lotou a arquibancada.' },
        base: { example: g.entry.example },
      },
    ]);
    expect(item(result.kb, id).content).toEqual(reviewContent(edited.entry));
  });
});

describe('mergeOverride e campos editáveis', () => {
  it('a segunda edição mantém o base do YAML dos campos já editados', () => {
    const first = mergeOverride(null, { template: 'B' }, { template: 'A', tone: 3 });
    expect(first).toEqual({ fields: { template: 'B' }, base: { template: 'A' } });
    const second = mergeOverride(first, { template: 'C', tone: 2 }, { template: 'B', tone: 3 });
    expect(second).toEqual({ fields: { template: 'C', tone: 2 }, base: { template: 'A', tone: 3 } });
  });

  it('slug, chave, ids e times nunca são editáveis', () => {
    expect(editableReviewFields('copy', { key: 'x', template: 't', tone: 1 })).toEqual(['template', 'tone']);
    expect(editableReviewFields('team', { slug: 's', country: 'BR', api_sports: {}, nicknames: [] })).toEqual(
      ['nicknames'],
    );
    expect(editableReviewFields('all-time', { teams: [], all_time: {} })).toEqual(['all_time']);
  });

  it('patchEntry remove campo com null e mantém o review_status', () => {
    expect(
      patchEntry('glossary', { key: 'k', example: 'x', review_status: 'draft' }, { example: null }),
    ).toEqual({
      key: 'k',
      review_status: 'draft',
    });
  });
});

describe('exportOverridesToYaml', () => {
  it('troca só o campo editado no texto do YAML e, depois, a edição fica absorvida', () => {
    const before = item(kb, COPY);
    const overrides: ReviewOverrideRef[] = [
      {
        itemId: COPY,
        fields: { template: 'Vai, {team}! Hoje é dia!' },
        base: { template: before.content.template },
      },
    ];
    const out = exportOverridesToYaml(kb, overrides);
    expect(out.exported).toEqual([COPY]);
    const file = kb.files.find((f) => f.rel === 'copy/pt-BR.yaml')!;
    const text = out.files.get('copy/pt-BR.yaml')!;
    const changed = text.split('\n').filter((l, i) => l !== file.source.split('\n')[i]);
    expect(changed).toHaveLength(1);
    expect(changed[0]).toContain('Hoje é dia!');
    // comentários continuam no arquivo
    expect(text).toContain('# ------------------------------------------------------------------ rivalry');

    const exported = buildKnowledgeBase(
      kb.dir,
      kb.files.map((f) => (f.rel === file.rel ? parseKnowledgeFile(f.path, f.rel, text) : f)),
    );
    expect(item(exported, COPY).reviewHash).toBe(
      item(applyReviewOverrides(kb, overrides).kb, COPY).reviewHash,
    );
    expect(applyReviewOverrides(exported, overrides).absorbed).toEqual([COPY]);
  });
});
