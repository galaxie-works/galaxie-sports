import { describe, expect, it } from 'vitest';
import { loadWtwConfig } from './config/loader.js';
import {
  CHANNEL_SCORING,
  matchChannelHeadline,
  matchChannelState,
  matchPhaseOf,
  mentionsDate,
  mentionsBroadcaster,
  mentionsTeam,
  mentionsTogether,
  teamNames,
  validateMatchChannels,
  type ChannelProposal,
  type ChannelValidationContext,
} from './match-channel.js';

const config = loadWtwConfig({ env: { WTW_BLOCKLIST: 'bloqueada.example' } });
const BR = config.directory('BR');
const KICKOFF = new Date('2026-10-24T19:30:00Z');
const NOW = new Date('2026-10-22T12:00:00Z');
const rights = BR.rightsFor('brasileirao-serie-a', KICKOFF)!;

const ctx = (over: Partial<ChannelValidationContext> = {}): ChannelValidationContext => ({
  directory: BR,
  rights,
  teams: [teamNames('Sao Paulo'), teamNames('Mirassol')],
  eventStartsAt: KICKOFF,
  now: NOW,
  ...over,
});

const OFFICIAL =
  'https://ge.globo.com/futebol/brasileirao-serie-a/noticia/2026/10/20/onde-assistir-rodada-32.ghtml';
const PRESS = 'https://www.lance.com.br/brasileirao/onde-assistir-rodada-32.html';
const PRESS2 = 'https://www.terra.com.br/esportes/futebol/brasileirao/rodada-32-onde-assistir.html';

const prop = (
  broadcasterId: string,
  evidence: ChannelProposal['evidence'],
  channel: string | null = null,
) => ({
  broadcasterId,
  channel,
  evidence,
});
const ev = (
  url: string,
  excerpt = 'São Paulo x Mirassol, sábado às 16h30, com Premiere',
  publishedAt = null,
) => ({
  url,
  excerpt,
  publishedAt,
});

describe('canal do jogo: validador determinístico', () => {
  it('fonte oficial com os dois times e o canal: grava com 0,9', () => {
    const r = validateMatchChannels([prop('premiere', [ev(OFFICIAL)])], ctx());
    expect(r.rejected).toEqual([]);
    expect(r.accepted).toMatchObject([
      { broadcasterId: 'premiere', providerName: 'Premiere', confidence: 0.9, sourceKind: 'official' },
    ]);
    expect(r.accepted[0]!.evidence[0]).toMatchObject({
      publisher: 'ge.globo.com',
      sourceKind: 'broadcaster',
    });
  });

  it('imprensa sozinha fica a confirmar; com a página conferida ou duas fontes, grava', () => {
    const alone = validateMatchChannels([prop('premiere', [ev(PRESS)])], ctx());
    expect(alone.accepted).toEqual([]);
    expect(alone.rejected).toEqual([
      { broadcasterId: 'premiere', reason: 'low_confidence', confidence: 0.7 },
    ]);

    const page = new Map([
      [PRESS, { ok: true, text: 'Rodada 32: São Paulo x Mirassol tem transmissão do Premiere.' }],
    ]);
    expect(
      validateMatchChannels([prop('premiere', [ev(PRESS)])], ctx({ pages: page })).accepted[0],
    ).toMatchObject({
      confidence: 0.8,
      sourceKind: 'press',
    });
    expect(
      validateMatchChannels([prop('premiere', [ev(PRESS), ev(PRESS2)])], ctx()).accepted[0]!.confidence,
    ).toBe(0.8);
  });

  it('só detentor conhecido da competição no país; emissora fora da biblioteca não entra', () => {
    const r = validateMatchChannels(
      [prop('espn', [ev(OFFICIAL, 'São Paulo x Mirassol na ESPN')]), prop('xpto', [])],
      ctx(),
    );
    expect(r.accepted).toEqual([]);
    expect(r.rejected.map((x) => x.reason).sort()).toEqual(['not_a_rights_holder', 'unknown_broadcaster']);
  });

  it('trecho sem os dois times ou sem o canal, URL fora do grounding, agregador ou fonte velha: cai', () => {
    const cases: [ChannelProposal['evidence'][number], Partial<ChannelValidationContext>, string][] = [
      [ev(OFFICIAL, 'Mirassol joga no sábado, com Premiere'), {}, 'excerpt_missing_teams'],
      [ev(OFFICIAL, 'São Paulo x Mirassol, sábado às 16h30'), {}, 'excerpt_missing_channel'],
      [ev(OFFICIAL), { groundedUrls: ['https://ge.globo.com/outra'] }, 'not_grounded'],
      [ev('https://guia-de-tv.example/rodada-32'), {}, 'not_official_or_press'],
      [{ ...ev(OFFICIAL), publishedAt: '2025-10-20T10:00:00Z' } as never, {}, 'stale_source'],
      [ev('https://bloqueada.example/x'), {}, 'blocked'],
    ];
    for (const [e, over, reason] of cases) {
      const r = validateMatchChannels([prop('premiere', [e])], ctx(over));
      expect(r.accepted, reason).toEqual([]);
      expect(r.rejected[0]).toMatchObject({ reason: 'no_valid_source', evidence: [reason] });
    }
  });

  it('página antiga vale quando o trecho cita a data do jogo (tabela da temporada)', () => {
    const old = {
      ...ev(OFFICIAL, '24/10 - São Paulo x Mirassol - 16h30 - Globo e Premiere'),
      publishedAt: '2026-03-01T10:00:00Z',
    };
    expect(validateMatchChannels([prop('premiere', [old as never])], ctx()).accepted).toHaveLength(1);
    expect(mentionsDate('jogo em 4/11', new Date('2026-11-04T23:00:00Z'))).toBe(true);
    expect(mentionsDate('jogo em 14/11', new Date('2026-11-04T23:00:00Z'))).toBe(false);
  });

  it('página acessível que não cita a emissora derruba a evidência; exigir página conferida', () => {
    const pages = new Map([
      [OFFICIAL, { ok: true, text: 'São Paulo x Mirassol: veja onde assistir na Globo.' }],
    ]);
    expect(
      validateMatchChannels([prop('premiere', [ev(OFFICIAL)])], ctx({ pages })).rejected[0],
    ).toMatchObject({
      evidence: ['page_missing_channel'],
    });
    expect(
      validateMatchChannels([prop('premiere', [ev(OFFICIAL)])], ctx({ requirePageVerified: true }))
        .rejected[0],
    ).toMatchObject({ evidence: ['page_not_verified'] });
  });

  it('canal da emissora só quando é um canal dela', () => {
    const ok = validateMatchChannels(
      [prop('sportv', [ev(OFFICIAL, 'São Paulo x Mirassol no SporTV 2')], 'SporTV 2')],
      ctx(),
    );
    expect(ok.accepted[0]).toMatchObject({ broadcasterId: 'sportv', channel: 'SporTV 2' });
    const other = validateMatchChannels(
      [prop('sportv', [ev(OFFICIAL, 'São Paulo x Mirassol no SporTV')], 'ESPN 2')],
      ctx(),
    );
    expect(other.accepted[0]).toMatchObject({ broadcasterId: 'sportv', channel: null });
  });

  it('limiar de gravação', () => {
    expect(CHANNEL_SCORING.confirmThreshold).toBe(0.8);
  });
});

describe('nomes dos times e da emissora', () => {
  it('casa nome, núcleo sem palavras genéricas e nome curto', () => {
    expect(mentionsTeam('Bragantino x Palmeiras', teamNames('RB Bragantino'))).toBe(true);
    expect(mentionsTeam('Chapecoense recebe', teamNames('Chapecoense-sc'))).toBe(true);
    expect(mentionsTeam('Atlético-MG x Flamengo', teamNames('Atletico-MG'))).toBe(true);
    expect(mentionsTeam('Galo x Flamengo', teamNames('Atletico-MG'))).toBe(false);
    expect(mentionsTeam('Paulo Henrique marcou', teamNames('Sao Paulo'))).toBe(false);
    expect(mentionsTeam('Vasco x Santos', teamNames('Vasco da Gama', 'Vasco'))).toBe(true);
  });

  it('primeira palavra que identifica o time e o começo do nome longo; ambíguas não bastam', () => {
    expect(mentionsTeam('Vasco x Corinthians | 18h30', teamNames('Vasco da Gama'))).toBe(true);
    expect(mentionsTeam('24/10 - Inter x Botafogo - 16h30', teamNames('Internacional'))).toBe(true);
    expect(mentionsTeam('Universidad de Chile x Colo-Colo', teamNames('Universidad Catolica'))).toBe(false);
  });

  it('página da escala: os dois times e a emissora juntos, não em jogos diferentes', () => {
    const teams = [teamNames('Sao Paulo'), teamNames('Mirassol')] as const;
    const filler = Array.from({ length: 60 }, (_, i) => `palavra${i}`).join(' ');
    const together = `Rodada 32. Mirassol x São Paulo, sábado, 16h30, no Premiere. ${filler} Flamengo x Bahia na Globo.`;
    expect(mentionsTogether(together, teams, ['Premiere'])).toBe(true);
    expect(mentionsTogether(together, teams, ['Globo'])).toBe(false);
  });

  it('emissora por palavra inteira: "Globo" não casa com "Globoplay"; nomes longos sem espaço', () => {
    expect(mentionsBroadcaster('Transmissão do Globoplay', ['Globo'])).toBe(false);
    expect(mentionsBroadcaster('Transmissão da TV Globo', ['Globo'])).toBe(true);
    expect(mentionsBroadcaster('na Cazé TV', ['CazéTV'])).toBe(true);
  });
});

describe('momento do jogo e texto', () => {
  it('status → momento e estado', () => {
    expect(matchPhaseOf('scheduled')).toBe('pre');
    expect(matchPhaseOf('postponed')).toBe('pre');
    expect(matchPhaseOf('live')).toBe('live');
    expect(matchPhaseOf('break')).toBe('live');
    expect(matchPhaseOf('finished')).toBe('post');
    expect(matchChannelState('post', 0)).toBe('not_confirmed');
    expect(matchChannelState('live', 0)).toBe('to_confirm');
    expect(matchChannelState('post', 2)).toBe('confirmed');
  });

  it('título por momento; "sai mais perto da partida" só antes do jogo', () => {
    expect(matchChannelHeadline('confirmed', 'pre', ['Globo', 'Premiere'], 'pt-BR')).toEqual({
      headline: 'Passa em Globo e Premiere',
      hint: null,
    });
    expect(matchChannelHeadline('confirmed', 'live', ['Premiere'], 'pt-BR').headline).toBe(
      'Ao vivo em Premiere',
    );
    expect(matchChannelHeadline('confirmed', 'post', ['Globo', 'SporTV', 'Premiere'], 'pt-BR').headline).toBe(
      'Transmitido por Globo, SporTV e Premiere',
    );
    expect(matchChannelHeadline('not_confirmed', 'post', [], 'pt-BR')).toEqual({
      headline: 'Não confirmamos o canal deste jogo',
      hint: null,
    });
    expect(matchChannelHeadline('to_confirm', 'pre', [], 'pt-BR').hint).toBe(
      'O canal do jogo sai mais perto da partida.',
    );
    expect(matchChannelHeadline('to_confirm', 'live', [], 'pt-BR').hint).toBeNull();
    expect(matchChannelHeadline('confirmed', 'post', ['ESPN', 'Disney+'], 'es-AR').headline).toBe(
      'Transmitido por ESPN y Disney+',
    );
  });
});
