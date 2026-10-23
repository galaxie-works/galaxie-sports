import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { join } from 'node:path';
import {
  buildKnowledgeBase,
  DEFAULT_KNOWLEDGE_DIR,
  loadKnowledge,
  parseKnowledgeFile,
} from '@galaxie/knowledge';
import { FakeLlmClient } from '../llm/fake.js';
import { applyBios, DRIVERS_FILE } from './apply.js';
import { mergeProposals, proposeBio, type DriverFacts } from './propose.js';

const senna: DriverFacts = {
  f1dbId: 'ayrton-senna',
  name: 'Ayrton Senna',
  country: 'BR',
  abbreviation: 'SEN',
  seasons: { first: 1984, last: 1994 },
  teams: ['Toleman', 'Lotus', 'McLaren', 'Williams'],
  titles: [1988, 1990, 1991],
  wins: 41,
  races: 161,
};

const WIKI = 'https://pt.wikipedia.org/wiki/Ayrton_Senna';
const F1 = 'https://www.formula1.com/en/information/ayrton-senna';

const reply = {
  data: {
    official_name: 'Ayrton Senna da Silva',
    city: 'São Paulo',
    region: 'São Paulo',
    nicknames: ['Magic', 'Magic'],
    identity: [
      { text: 'Nasceu em São Paulo em 21 de março de 1960.', source: WIKI },
      { text: 'Campeão mundial em 1988, 1990 e 1991 pela McLaren.', source: F1 },
      { text: 'Frase sem fonte.', source: '' },
      { text: 'Fonte inventada pelo modelo.', source: 'https://exemplo.invalido/senna' },
    ],
  },
  groundedUrls: [WIKI, F1],
};

describe('proposeBio', () => {
  it('só ficam frases com fonte vinda da busca; o resto é descartado com o motivo', async () => {
    const llm = new FakeLlmClient([reply]);
    const p = await proposeBio(llm, senna);
    expect(p.status).toBe('accepted');
    expect(p.identity.map((s) => s.source)).toEqual([WIKI, F1]);
    expect(p.dropped.map((d) => d.reason)).toEqual(['sem fonte', 'fonte não veio da busca']);
    expect(p.nicknames).toEqual(['Magic']);
    expect(llm.calls[0]).toMatchObject({ tier: 'research', webSearch: true });
  });

  it('sem nenhuma frase com fonte, não há proposta (nada inventado)', async () => {
    const llm = new FakeLlmClient([{ ...reply, groundedUrls: ['https://outra.fonte/x'] }]);
    const p = await proposeBio(llm, senna);
    expect(p.status).toBe('rejected');
    expect(p.city).toBeNull();
    expect(p.reasons).toContain('nenhuma frase com fonte verificável');
  });
});

describe('applyBios', () => {
  it('acrescenta o perfil draft com o vínculo do F1DB e passa no validador', async () => {
    const kb = await loadKnowledge(DEFAULT_KNOWLEDGE_DIR);
    const p = await proposeBio(new FakeLlmClient([reply]), senna);
    const changes = await applyBios(kb, [p]);
    expect(changes.applied).toEqual(['ayrton-senna']);
    const doc = parse(changes.text!) as { participants: Record<string, unknown>[] };
    expect(doc.participants.find((e) => e.slug === 'f1-ayrton-senna')).toMatchObject({
      f1db: { id: 'ayrton-senna' },
      country: 'BR',
      city: 'São Paulo',
      review_status: 'draft',
      sources: [WIKI, F1],
      names: { official: 'Ayrton Senna da Silva', short: 'Ayrton Senna', abbreviation: 'SEN' },
    });
  });

  it('nunca sobrescreve um perfil aprovado', async () => {
    const kb = await loadKnowledge(DEFAULT_KNOWLEDGE_DIR);
    const alonso = await proposeBio(new FakeLlmClient([reply]), { ...senna, f1dbId: 'fernando-alonso' });
    const changes = await applyBios(kb, [alonso]);
    expect(changes.applied).toEqual([]);
    expect(changes.skipped).toEqual([
      { f1dbId: 'fernando-alonso', reason: 'perfil já aprovado: não é sobrescrito' },
    ]);
  });

  it('aplicar de novo as mesmas propostas não muda nada', async () => {
    const kb = await loadKnowledge(DEFAULT_KNOWLEDGE_DIR);
    const p = await proposeBio(new FakeLlmClient([reply]), senna);
    const first = await applyBios(kb, [p]);
    const after = buildKnowledgeBase(
      kb.dir,
      kb.files.map((f) =>
        f.rel === DRIVERS_FILE ? parseKnowledgeFile(join(kb.dir, f.rel), f.rel, first.text!) : f,
      ),
    );
    const second = await applyBios(after, [p]);
    expect(second.applied).toEqual([]);
    expect(second.text).toBeNull();
    expect(second.skipped).toEqual([{ f1dbId: 'ayrton-senna', reason: 'já está igual no YAML' }]);
  });
});

describe('propostas de várias execuções (passo da VPS)', () => {
  it('a nova substitui a do mesmo piloto; as outras ficam', async () => {
    const old = await proposeBio(new FakeLlmClient([reply]), senna);
    const prost = await proposeBio(new FakeLlmClient([reply]), { ...senna, f1dbId: 'alain-prost' });
    const fresh = { ...old, nicknames: ['Beco'] };
    const merged = mergeProposals([old, prost], [fresh]);
    expect(merged.map((m) => [m.facts.f1dbId, m.nicknames])).toEqual([
      ['ayrton-senna', ['Beco']],
      ['alain-prost', ['Magic']],
    ]);
  });
});
