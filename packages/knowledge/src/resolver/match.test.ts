import { describe, expect, it } from 'vitest';
import { resolveTeams, scoreCandidate, type Candidate, type CandidatePool, type TeamRef } from './match.js';
import { coreTokens, isSecondaryTeam, nameSimilarity, normalizeName, stateSuffix } from './normalize.js';

const cand = (apiId: number, name: string, extra: Partial<Candidate> = {}): Candidate => ({
  apiId,
  participantId: null,
  name,
  code: null,
  countryName: 'Brazil',
  countryCode: 'BR',
  founded: null,
  national: false,
  venueCity: null,
  source: 'teams',
  ...extra,
});

const ref = (slug: string, name: string, extra: Partial<TeamRef> = {}): TeamRef => ({
  slug,
  file: 'football/teams/br.yaml',
  kind: 'club',
  countryCode: 'BR',
  countryName: 'Brazil',
  currentId: null,
  names: [{ value: name, weight: 1 }],
  city: null,
  region: null,
  foundedYear: null,
  abbreviation: null,
  ...extra,
});

const pool = (candidates: Candidate[], covered = true): CandidatePool => ({
  candidates,
  coveredCountries: new Set(covered ? ['brazil'] : []),
});

describe('normalização', () => {
  it('remove acentos, pontuação e prefixos societários', () => {
    expect(normalizeName('Grêmio Foot-Ball Porto Alegrense')).toBe('gremio foot ball porto alegrense');
    expect(coreTokens('Fortaleza EC')).toEqual(['fortaleza']);
    expect(coreTokens('SC Corinthians Paulista')).toEqual(['corinthians', 'paulista']);
    expect(nameSimilarity('Fortaleza EC', 'Fortaleza')).toBe(0.97);
    expect(nameSimilarity('São Paulo', 'Sao Paulo')).toBe(1);
    expect(nameSimilarity('Nautico', 'Nautico Recife')).toBeGreaterThanOrEqual(0.85);
    expect(nameSimilarity('Palmeiras', 'Corinthians')).toBeLessThan(0.5);
  });
  it('reconhece base, feminino e time B', () => {
    for (const n of ['Palmeiras U20', 'Botafogo W', 'Fortaleza B', 'Brazil U17 W', 'Santos Sub20'])
      expect(isSecondaryTeam(n)).toBe(true);
    for (const n of ['Palmeiras', 'Botafogo SP', 'RB Bragantino', 'Bahia'])
      expect(isSecondaryTeam(n)).toBe(false);
  });
  it('lê o sufixo de estado', () => {
    expect(stateSuffix('America-RN')).toBe('rn');
    expect(stateSuffix('Chapecoense-sc')).toBe('sc');
    expect(stateSuffix('Bahia')).toBeNull();
  });
});

describe('resolveTeams', () => {
  it('confere o team_id do YAML (verified) e acusa conflito de nome', () => {
    const p = pool([cand(121, 'Palmeiras'), cand(131, 'Corinthians')]);
    const [ok, bad, missing] = resolveTeams(
      [
        ref('palmeiras', 'Palmeiras', { currentId: 121 }),
        ref('corinthians', 'Corinthians', { currentId: 121 }),
        ref('santos', 'Santos', { currentId: 999 }),
      ],
      p,
    );
    expect(ok).toMatchObject({ status: 'verified', apiId: 121 });
    expect(bad).toMatchObject({ status: 'conflict', apiId: null });
    expect(bad!.note).toContain('Palmeiras');
    expect(missing).toMatchObject({
      status: 'conflict',
      note: 'team_id 999 não aparece em /teams?country=Brazil',
    });
  });

  it('team_id sem dados locais fica unverified', () => {
    const [r] = resolveTeams(
      [ref('boca', 'Boca Juniors', { countryCode: 'AR', countryName: 'Argentina', currentId: 451 })],
      pool([]),
    );
    expect(r).toMatchObject({ status: 'unverified', apiId: 451 });
  });

  it('resolve sem team_id quando há um único candidato forte (ignorando base e feminino)', () => {
    const [r] = resolveTeams(
      [ref('fortaleza', 'Fortaleza EC')],
      pool([cand(154, 'Fortaleza EC'), cand(13009, 'Fortaleza U20'), cand(25383, 'Fortaleza B')]),
    );
    expect(r).toMatchObject({ status: 'resolved', apiId: 154 });
  });

  it('homônimos sem dados que desempatem ficam ambíguos — nunca aplicados', () => {
    const [r] = resolveTeams(
      [ref('santa-cruz', 'Santa Cruz')],
      pool([cand(753, 'Santa Cruz'), cand(13974, 'Santa Cruz')]),
    );
    expect(r).toMatchObject({ status: 'ambiguous', apiId: null });
    expect(r!.candidates.map((c) => c.apiId)).toEqual([753, 13974]);
  });

  it('fundação e cidade desempatam homônimos', () => {
    const [r] = resolveTeams(
      [ref('santa-cruz', 'Santa Cruz', { foundedYear: 1914, city: 'Recife' })],
      pool([
        cand(753, 'Santa Cruz', { founded: 1914, venueCity: 'Recife, Pernambuco' }),
        cand(13974, 'Santa Cruz'),
      ]),
    );
    expect(r).toMatchObject({ status: 'resolved', apiId: 753 });
  });

  it('o estado no nome separa clubes homônimos', () => {
    const team = ref('america-mineiro', 'America', { region: 'MG' });
    expect(scoreCandidate(team, cand(2233, 'America-RN'))).toBeLessThan(
      scoreCandidate(team, cand(1, 'America MG')),
    );
  });

  it('seleção só casa com seleção; clube nunca casa com seleção', () => {
    const p = pool([cand(6, 'Brazil', { national: true }), cand(22011, 'Brasil FC')]);
    const [nt, club] = resolveTeams(
      [ref('brazil-nt', 'Brazil', { kind: 'national_team' }), ref('brasil-fc', 'Brazil')],
      p,
    );
    expect(nt).toMatchObject({ status: 'resolved', apiId: 6 });
    expect(club!.candidates.map((c) => c.apiId)).not.toContain(6);
  });

  it('país sem lista completa exige nome idêntico', () => {
    const p = pool(
      [
        cand(531, 'Athletic Club', {
          countryName: 'Spain',
          countryCode: 'ES',
          source: 'fixtures',
          national: null,
        }),
      ],
      false,
    );
    const [exact, fuzzy] = resolveTeams(
      [
        ref('athletic-club', 'Athletic Club', { countryCode: 'ES', countryName: 'Spain' }),
        ref('athletic-b', 'Athletic Bilbao', { countryCode: 'ES', countryName: 'Spain' }),
      ],
      p,
    );
    expect(exact).toMatchObject({ status: 'resolved', apiId: 531 });
    expect(fuzzy!.status).not.toBe('resolved');
  });

  it('sem candidatos: unmatched no país coberto, no-data fora dele', () => {
    const [a] = resolveTeams([ref('x', 'Xyzzy')], pool([cand(1, 'Palmeiras')]));
    expect(a!.status).toBe('unmatched');
    const [b] = resolveTeams(
      [ref('y', 'Real Madrid', { countryCode: 'ES', countryName: 'Spain' })],
      pool([], false),
    );
    expect(b!.status).toBe('no-data');
  });

  it('liga participante do core sem ID da api-sports quando o casamento é inequívoco', () => {
    const p = pool([
      cand(121, 'Palmeiras', { founded: 1914 }),
      cand(0, 'Palmeiras', { apiId: null, participantId: 'p-1', source: 'participant', national: false }),
      cand(0, 'Botafogo', { apiId: null, participantId: 'p-2', source: 'participant', national: false }),
    ]);
    const [verified, resolved] = resolveTeams(
      [ref('palmeiras', 'Palmeiras', { currentId: 121 }), ref('palmeiras-2', 'Palmeiras')],
      p,
    );
    expect(verified).toMatchObject({ status: 'verified', apiId: 121, participantId: 'p-1' });
    // o participante sem ID não cria ambiguidade com o próprio clube do raw
    expect(resolved).toMatchObject({ status: 'resolved', apiId: 121, participantId: 'p-1' });
  });
});
