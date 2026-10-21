import { describe, expect, it } from 'vitest';
import { loadWtwConfig } from './config/loader.js';
import {
  validateCandidates,
  type Candidate,
  type CandidateEvidence,
  type ValidationContext,
} from './validator.js';

const config = loadWtwConfig({ env: { WTW_BLOCKLIST: 'Operadora Bloqueada, bloqueada.example' } });
const NOW = new Date('2026-10-21T12:00:00Z');
const KICKOFF = new Date('2026-10-22T00:30:00Z');

const ctx = (over: Partial<ValidationContext> = {}): ValidationContext => ({
  directory: config.directory('BR'),
  competitionSlug: 'conmebol-libertadores',
  eventStartsAt: KICKOFF,
  now: NOW,
  ...over,
});

const ev = (url: string, over: Partial<CandidateEvidence> = {}): CandidateEvidence => ({
  url,
  excerpt: 'Transmissão ao vivo do jogo',
  accessible: true,
  mentionsBroadcaster: true,
  publishedAt: '2026-10-20T10:00:00Z',
  ...over,
});

const cand = (
  broadcaster: string,
  evidence: CandidateEvidence[],
  over: Partial<Candidate> = {},
): Candidate => ({
  broadcaster,
  channel: null,
  medium: null,
  accessModel: null,
  region: null,
  watchUrl: null,
  evidence,
  ...over,
});

describe('validador determinístico — confiança', () => {
  it('fonte única primária + tabela de direitos → 0,9 + 0,1 = 1,0 publicada', () => {
    const r = validateCandidates([cand('TV Globo', [ev('https://ge.globo.com/agenda/jogo')])], ctx());
    expect(r.options).toHaveLength(1);
    expect(r.options[0]).toMatchObject({
      broadcasterId: 'globo',
      providerName: 'Globo',
      medium: 'free_tv',
      accessModel: 'free',
      status: 'confirmed',
      confidence: 1,
      sourceKind: 'broadcaster',
      score: { base: 0.9, rights: 0.1, independent: 0, stale: 0 },
    });
  });

  it('fonte única de imprensa sem bônus de direitos → 0,7 publicada', () => {
    const r = validateCandidates(
      [cand('Globo', [ev('https://www.lance.com.br/x')])],
      ctx({ competitionSlug: null }),
    );
    expect(r.options[0]).toMatchObject({ status: 'confirmed', confidence: 0.7, sourceKind: 'press' });
  });

  it('fonte única desconhecida → 0,4 + 0,1 (direitos) = 0,5 → pending (não aparece)', () => {
    const r = validateCandidates([cand('ESPN', [ev('https://blog.qualquer.net/post')])], ctx());
    expect(r.options[0]).toMatchObject({ broadcasterId: 'espn', status: 'pending', confidence: 0.5 });
  });

  it('duas fontes independentes somam +0,1', () => {
    const r = validateCandidates(
      [
        cand('Paramount+', [ev('https://www.lance.com.br/a')]),
        cand('Paramount Plus', [ev('https://www.uol.com.br/esporte/b')]),
      ],
      ctx(),
    );
    expect(r.options).toHaveLength(1); // deduplicada
    expect(r.options[0]).toMatchObject({
      broadcasterId: 'paramount_plus',
      confidence: 0.9,
      score: { base: 0.7, rights: 0.1, independent: 0.1 },
    });
    expect(r.options[0]!.evidence).toHaveLength(2);
  });

  it('mesma fonte em dois subdomínios não conta como independente', () => {
    const r = validateCandidates(
      [cand('SporTV', [ev('https://ge.globo.com/a'), ev('https://sportv.globo.com/b')])],
      ctx({ competitionSlug: null }),
    );
    expect(r.options[0]!.score.independent).toBe(0);
  });

  it('emissora fora da tabela de direitos perde 0,2', () => {
    const r = validateCandidates([cand('Band', [ev('https://www.lance.com.br/x')])], ctx());
    expect(r.options[0]).toMatchObject({ status: 'pending', confidence: 0.5, flags: ['rights_mismatch'] });
  });

  it('detentor incerto não ganha bônus nem penalidade', () => {
    const r = validateCandidates(
      [cand('SBT', [ev('https://www.lance.com.br/x')])],
      ctx({ competitionSlug: 'conmebol-sudamericana' }),
    );
    expect(r.options[0]).toMatchObject({ confidence: 0.7, flags: [] });
  });

  it('fonte com mais de 72 h em competição com escolha por rodada perde 0,3', () => {
    const old = ev('https://www.lance.com.br/x', { publishedAt: '2026-10-15T10:00:00Z' });
    const r = validateCandidates([cand('Globo', [old])], ctx());
    expect(r.options[0]).toMatchObject({ confidence: 0.5, status: 'pending', flags: ['stale_source'] });
    // competição sem escolha por rodada: sem penalidade
    const r2 = validateCandidates([cand('ESPN', [old])], ctx({ competitionSlug: 'conmebol-sudamericana' }));
    expect(r2.options[0]!.score.stale).toBe(0);
  });

  it('abaixo de 0,5 descarta', () => {
    const r = validateCandidates([cand('Band', [ev('https://blog.qualquer.net/x')])], ctx());
    expect(r.options).toHaveLength(0);
    expect(r.discarded).toEqual([{ broadcaster: 'Band', reason: 'low_confidence', confidence: 0.2 }]);
  });

  it('página que não menciona a emissora é rebaixada ao nível de agregador', () => {
    const r = validateCandidates(
      [cand('Globo', [ev('https://ge.globo.com/x', { mentionsBroadcaster: false })])],
      ctx(),
    );
    expect(r.options[0]).toMatchObject({ confidence: 0.5, status: 'pending' });
    expect(r.options[0]!.flags).toContain('excerpt_not_found');
  });
});

describe('validador determinístico — evidência, conflito e política', () => {
  it('descarta opção sem URL de evidência acessível', () => {
    const r = validateCandidates(
      [
        cand('Globo', [ev('https://ge.globo.com/x', { accessible: false })]),
        cand('ESPN', [ev('https://www.livesoccertv.com/m/1', { accessible: null })]), // agregador não raspado
        cand('SBT', [{ url: 'ftp://x', excerpt: 'y' }]),
      ],
      ctx(),
    );
    expect(r.options).toHaveLength(0);
    expect(r.discarded.map((d) => d.reason)).toEqual([
      'no_accessible_evidence',
      'no_accessible_evidence',
      'no_accessible_evidence',
    ]);
  });

  it('conflito entre fontes primárias (confirma × nega) → omitida', () => {
    const r = validateCandidates(
      [
        cand('Globo', [
          ev('https://ge.globo.com/agenda'),
          ev('https://www.conmebol.com/grade', { stance: 'denies' }),
        ]),
      ],
      ctx(),
    );
    expect(r.options[0]).toMatchObject({ status: 'omitted', conflict: true });
    expect(r.options[0]!.flags).toContain('conflict');
  });

  it('conflito de canal entre fontes primárias → omitida', () => {
    const r = validateCandidates(
      [
        cand('ESPN', [ev('https://www.espn.com.br/a')], { channel: 'ESPN 2' }),
        cand('ESPN', [ev('https://www.conmebol.com/b')], { channel: 'ESPN 4' }),
      ],
      ctx(),
    );
    expect(r.options).toHaveLength(1);
    expect(r.options[0]).toMatchObject({ status: 'omitted', conflict: true });
  });

  it('negação primária sem confirmação primária → descartada', () => {
    const r = validateCandidates(
      [cand('Globo', [ev('https://www.lance.com.br/a'), ev('https://ge.globo.com/b', { stance: 'denies' })])],
      ctx(),
    );
    expect(r.options).toHaveLength(0);
    expect(r.discarded[0]!.reason).toBe('denied_by_primary');
  });

  it('nome desconhecido vai para revisão (pending + unknown_broadcaster), nunca publicado', () => {
    const r = validateCandidates(
      [
        cand('Canal Novo HD', [ev('https://www.conmebol.com/x')], {
          medium: 'pay_tv',
          accessModel: 'subscription',
        }),
      ],
      ctx(),
    );
    expect(r.options[0]).toMatchObject({
      broadcasterId: null,
      providerName: 'Canal Novo HD',
      status: 'pending',
      flags: ['unknown_broadcaster'],
    });
  });

  it('blocklist editorial descarta a opção e evidências hospedadas em domínio bloqueado', () => {
    const r = validateCandidates(
      [
        cand('Operadora Bloqueada', [ev('https://www.conmebol.com/x')]),
        cand('Globo', [ev('https://bloqueada.example/grade')]),
      ],
      ctx(),
    );
    expect(r.options).toHaveLength(0);
    expect(r.discarded).toContainEqual({ broadcaster: '[bloqueado]', reason: 'blocked' });
    expect(JSON.stringify(r)).not.toContain('Operadora Bloqueada');
  });

  it('afiliada regional fixa a região; região inválida no Brasil é descartada', () => {
    const r = validateCandidates(
      [
        cand('RBS TV', [ev('https://ge.globo.com/rs/x')]),
        cand('Globo', [ev('https://ge.globo.com/y')], { region: 'Zona Norte' }),
        cand('Globo', [ev('https://ge.globo.com/z')], { region: 'nacional' }),
      ],
      ctx(),
    );
    expect(r.options.map((o) => [o.region, o.channel])).toEqual([
      [null, null],
      ['RS', 'RBS TV'],
    ]);
    expect(r.discarded).toContainEqual({ broadcaster: 'Globo', reason: 'invalid_region' });
  });

  it('corta o trecho de evidência em 200 caracteres e usa o meio/acesso do dicionário', () => {
    const r = validateCandidates(
      [
        cand('Prime Video', [ev('https://www.primevideo.com/x', { excerpt: 'a'.repeat(500) })], {
          medium: 'free_tv',
        }),
      ],
      ctx({ competitionSlug: null }),
    );
    expect(r.options[0]!.evidence[0]!.excerpt.length).toBeLessThanOrEqual(200);
    expect(r.options[0]).toMatchObject({ medium: 'streaming_svod', accessModel: 'subscription' });
  });

  it('é determinístico (mesma entrada → mesma saída)', () => {
    const input = [
      cand('Globo', [ev('https://ge.globo.com/a')]),
      cand('ESPN', [ev('https://www.lance.com.br/b')]),
    ];
    expect(validateCandidates(input, ctx())).toEqual(validateCandidates([...input].reverse(), ctx()));
  });
});
