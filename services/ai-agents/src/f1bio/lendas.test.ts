/**
 * As 10 lendas da primeira rodada na produção (25/10/2026), como casos fixos: os fatos reais do F1DB e as respostas
 * do Gemini daquele dia (`fixtures/lendas-2026-10-25.json.gz`). Nas 5 que a regra antiga recusou pela bio, só a bio
 * foi guardada; nas outras, os itens que a regra antiga descartou guardaram só o texto e o motivo (chave, corrida e
 * fonte reconstruídas, fora da busca). A regra nova: ninguém mexe na resposta, o validador nunca barra, toda proposta
 * com bio vira rascunho com os achados.
 */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  validateKnowledge,
  buildKnowledgeBase,
  DEFAULT_KNOWLEDGE_DIR,
  loadKnowledge,
  parseKnowledgeFile,
} from '@galaxie/knowledge';
import { FakeLlmClient } from '../llm/fake.js';
import { applyProfiles, editorialFile } from './apply-profile.js';
import type { ProfileFacts } from './profile-facts.js';
import {
  findingCounts,
  proposeProfile,
  type LegendReply,
  type ProfileProposal,
  type TranslationReply,
} from './profile.js';

interface Case {
  f1dbId: string;
  name: string;
  notes: string[];
  facts: ProfileFacts;
  reply: LegendReply;
  groundedUrls: string[];
  translation: TranslationReply | null;
}

const { cases } = JSON.parse(
  gunzipSync(readFileSync(new URL('./fixtures/lendas-2026-10-25.json.gz', import.meta.url))).toString('utf8'),
) as { cases: Case[] };

const EMPTY_TRANSLATION: TranslationReply = {
  bio: '',
  style: null,
  strengths: [],
  moments: [],
  rivalries: [],
};

async function propose(c: Case): Promise<ProfileProposal> {
  const llm = new FakeLlmClient(
    [{ data: c.reply, groundedUrls: c.groundedUrls }, { data: c.translation ?? EMPTY_TRANSLATION }],
    { validate: false },
  );
  return proposeProfile(llm, c.facts);
}

const proposals = new Map<string, ProfileProposal>();
const get = async (id: string) => {
  if (!proposals.has(id)) proposals.set(id, await propose(cases.find((c) => c.f1dbId === id)!));
  return proposals.get(id)!;
};
/** O trecho que o achado aponta no texto do campo. */
const excerpt = (p: ProfileProposal, field: string, start: number, end: number) => {
  const e = p.entries['pt-BR']!;
  const m = /^(bio|style|strengths|moments|rivalries)(?:\[(\d+)\])?$/.exec(field);
  if (!m) return '';
  const node =
    m[1] === 'bio' ? e.bio : m[1] === 'style' ? e.style : (e[m[1] as 'moments'] ?? [])[Number(m[2])];
  return node?.text.slice(start, end) ?? '';
};

describe('as 10 lendas da primeira rodada (casos fixos)', () => {
  it('são as 10 escolhidas, com os fatos do F1DB', () => {
    expect(cases.map((c) => c.f1dbId).sort()).toEqual(
      [
        'alain-prost',
        'ayrton-senna',
        'fernando-alonso',
        'jim-clark',
        'juan-manuel-fangio',
        'lewis-hamilton',
        'max-verstappen',
        'michael-schumacher',
        'nelson-piquet',
        'niki-lauda',
      ].sort(),
    );
    expect(cases.find((c) => c.f1dbId === 'ayrton-senna')!.facts).toMatchObject({
      wins: 41,
      poles: 65,
      races: 161,
    });
  });

  it('toda proposta com bio vira rascunho (nenhuma recusada), com as 5 que eram recusadas', async () => {
    for (const c of cases) {
      const p = await get(c.f1dbId);
      expect(p.status, c.f1dbId).toBe('accepted');
      expect(p.entries['pt-BR']!.review_status).toBe('draft');
      // a bio é a do modelo, sem nenhuma alteração
      expect(p.entries['pt-BR']!.bio.text).toBe(c.reply.bio.text.trim());
    }
  });

  it('Lauda: "39 dias depois" fica no texto, marcado como grave (número fora do F1DB)', async () => {
    const p = await get('niki-lauda');
    const f = p.entries['pt-BR']!.findings!.filter((x) => x.rule === 'unknown_number');
    expect(f.map((x) => [x.field, x.severity, x.reason])).toContainEqual([
      'bio',
      'severe',
      'número fora do F1DB (39)',
    ]);
    const hit = f.find((x) => x.reason.includes('39'))!;
    expect(excerpt(p, hit.field, hit.start, hit.end)).toContain('39 dias depois');
  });

  it('Piquet: o 52 do Brabham BT52 é nome de chassi, não número fora do F1DB', async () => {
    const p = await get('nelson-piquet');
    expect(p.entries['pt-BR']!.bio.text).toContain('BT52');
    expect((p.entries['pt-BR']!.findings ?? []).filter((f) => f.reason.includes('52'))).toEqual([]);
  });

  it('Senna, Hamilton e Schumacher: "agressividade" é vocabulário de pilotagem, sem achado', async () => {
    for (const id of ['ayrton-senna', 'lewis-hamilton', 'michael-schumacher']) {
      const p = await get(id);
      expect(p.entries['pt-BR']!.bio.text.toLowerCase(), id).toContain('agressividade');
      expect(
        (p.entries['pt-BR']!.findings ?? []).filter((f) => f.rule === 'forbidden_term'),
        id,
      ).toEqual([]);
    }
  });

  it('Fangio: marcadores [S1] ficam no texto como alertas; o estilo (mais de 280 caracteres) entra', async () => {
    const p = await get('juan-manuel-fangio');
    const e = p.entries['pt-BR']!;
    expect(JSON.stringify(e)).toMatch(/\[S\d/);
    const markers = e.findings!.filter((f) => f.rule === 'citation_marker');
    expect(markers.length).toBeGreaterThan(10);
    expect(markers.every((f) => f.severity === 'alert')).toBe(true);
    expect(excerpt(p, markers[0]!.field, markers[0]!.start, markers[0]!.end)).toMatch(/^\[S\d+/);
    // a regra antiga descartava o estilo por passar dos 280 dos itens; o limite do estilo é o do schema (400)
    expect(e.style!.text.length).toBeGreaterThan(280);
    expect(e.findings!.filter((f) => f.field === 'style' && f.rule === 'too_long')).toEqual([]);
  });

  it('itens com fonte fora da busca entram, com achado grave na fonte', async () => {
    const p = await get('alain-prost');
    const e = p.entries['pt-BR']!;
    const bad = e.findings!.filter((f) => f.rule === 'source_not_grounded');
    expect(bad.length).toBeGreaterThanOrEqual(4);
    expect(bad.every((f) => f.severity === 'severe' && /\.(source|sources\[\d+\])$/.test(f.field))).toBe(
      true,
    );
    // os 2 momentos aceitos antes + os 3 que a regra antiga descartava
    expect(e.moments).toHaveLength(5);
  });

  it('a versão es leva os achados de fonte e de item do original', async () => {
    const p = await get('alain-prost');
    const es = p.entries.es!;
    expect(es.bio.sources).toEqual(p.entries['pt-BR']!.bio.sources);
    expect((es.findings ?? []).filter((f) => f.rule === 'source_not_grounded').length).toBe(
      p.entries['pt-BR']!.findings!.filter((f) => f.rule === 'source_not_grounded').length,
    );
  });

  it('placar: graves e alertas por lenda (o selo do painel)', async () => {
    const board: Record<string, { alert: number; severe: number }> = {};
    for (const c of cases) board[c.f1dbId] = findingCounts((await get(c.f1dbId)).entries['pt-BR']);
    // as que eram aceitas e sem item descartado não ganham grave do nada
    expect(board['jim-clark']!.severe).toBe(0);
    expect(board['niki-lauda']!.severe).toBeGreaterThan(0);
    expect(board).toMatchSnapshot();
  });

  it('os 10 rascunhos passam no validador da base (pt-BR e es)', async () => {
    const kb = await loadKnowledge(DEFAULT_KNOWLEDGE_DIR);
    const all = await Promise.all(cases.map((c) => get(c.f1dbId)));
    const changes = await applyProfiles(kb, all);
    expect(changes.skipped).toEqual([]);
    expect(changes.applied).toHaveLength(all.filter((p) => p.entries.es).length + 10);
    const after = buildKnowledgeBase(kb.dir, [
      ...kb.files.filter((f) => !changes.files.some((x) => x.rel === f.rel)),
      ...changes.files.map((f) => parseKnowledgeFile(`${kb.dir}/${f.rel}`, f.rel, f.text)),
    ]);
    expect((await validateKnowledge(after)).errors).toEqual([]);
    expect(changes.files.map((f) => f.rel).sort()).toEqual(
      [editorialFile('es'), editorialFile('pt-BR')].sort(),
    );
  });
});
