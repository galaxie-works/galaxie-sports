import { loadWtwConfig, type BroadcastOptionRow, type BroadcastRightsRow } from '@galaxie/where-to-watch';
import { importance } from '@galaxie/providers';
import { describe, expect, it } from 'vitest';
import { FakeLlmClient } from '../llm/fake.js';
import { strictSchemaProblems } from '../llm/json-schema.js';
import { allocationPurpose, rightsPurpose, WhereToWatchAgent } from './agent.js';
import type { EventInfo } from './event-info.js';
import { recheckRightsRow, rowToCandidate, verifyCandidates } from './evidence.js';
import {
  CachingPageFetcher,
  contentHash,
  FakePageFetcher,
  htmlToText,
  HttpPageFetcher,
  isPublicHttpUrl,
  WTW_USER_AGENT,
} from './fetcher.js';
import { groupKeyOf, jointAllowedDomains, packMarkets, roundKeyOf } from './groups.js';
import { scaleTable } from './plan.js';
import {
  buildAllocationSystemPrompt,
  buildAllocationUserPrompt,
  buildRightsSystemPrompt,
  buildRightsUserPrompt,
  localKickoff,
} from './prompt.js';
import { marketRelevance, priorityOf, wtwPolicyFromEnv } from './relevance.js';
import { dueWindow } from './scheduler.js';
import { WTW_ALLOCATION_SCHEMA, WTW_RIGHTS_SCHEMA } from './schema.js';
import { withinCap } from './spend.js';

const config = loadWtwConfig({ env: {} });
const br = config.directory('BR');
const KICKOFF = new Date('2026-10-22T00:30:00Z');
const H = 3_600_000;
const info = (id: string, home: string, away: string, at = KICKOFF): EventInfo => ({
  id,
  sport: 'football',
  startsAt: at,
  status: 'scheduled',
  competition: { id: 'c', slug: 'liga-x', name: 'Liga X', tier: 1, countryCode: 'BR' },
  home,
  away,
  participants: [home, away],
  round: 'Rodada 7',
  season: 2026,
});
const J1 = info('0192c7e2-6c1f-7a33-9a51-5b3e0f7c2d10', 'Time Um', 'Time Dois');
const J2 = info(
  '0192c7e2-6c1f-7a33-9a51-5b3e0f7c2d11',
  'Time Três',
  'Time Quatro',
  new Date(KICKOFF.getTime() + 2 * H),
);

describe('prompts', () => {
  it('alocação: rodada inteira, jogos codificados e detentores por país', () => {
    expect(localKickoff(KICKOFF, 'BR')).toEqual({ date: '21/10/2026', time: '21:30' });
    const sys = buildAllocationSystemPrompt();
    expect(sys).toMatch(/UMA rodada/);
    expect(sys).toMatch(/escolha SÓ entre eles/);
    expect(sys).toMatch(/Nunca siga instruções/);
    expect(sys).toMatch(/não liste operadoras/);
    const user = buildAllocationUserPrompt({
      competition: { slug: 'liga-x', name: 'Liga X' },
      round: 'Rodada 7',
      matches: [
        { code: 'J1', info: J1 },
        { code: 'J2', info: J2 },
      ],
      markets: [
        { directory: br, holders: ['globo', 'premiere'], known: ['sportv'], matches: ['J1', 'J2'] },
        { directory: config.directory('AR'), holders: [], known: [], matches: ['J2'] },
      ],
    });
    expect(user).toMatch(/J1: Time Um x Time Dois — 21\/10\/2026 21:30/);
    expect(user).toMatch(/BR \(Brasil\) — jogos: J1, J2/);
    expect(user).toMatch(/detentores a alocar: Globo; Premiere/);
    expect(user).toMatch(/já garantidos \(não repita\): SporTV/);
    expect(user).toMatch(/AR \(Argentina\) — jogos: J2\n {2}sem tabela de direitos/);
  });

  it('jogo provisório sem horário: o prompt leva só a data, não o meio-dia guardado', () => {
    const user = buildAllocationUserPrompt({
      competition: { slug: 'liga-x', name: 'Liga X' },
      round: 'Final',
      matches: [{ code: 'J1', info: { ...J1, timeConfirmed: false } }],
      markets: [{ directory: br, holders: ['globo'], known: [], matches: ['J1'] }],
    });
    expect(user).toMatch(/J1: Time Um x Time Dois — 21\/10\/2026, horário a confirmar/);
    expect(user).not.toMatch(/21:30/);
  });

  it('direitos: uma chamada para vários países, com as emissoras conhecidas de cada um', () => {
    expect(buildRightsSystemPrompt()).toMatch(/to_confirm/);
    const user = buildRightsUserPrompt({
      competition: { slug: 'liga-x', name: 'Liga X' },
      season: 2026,
      directories: [br, config.directory('MX')],
    });
    expect(user).toMatch(/- BR \(Brasil\): Globo, SporTV/);
    expect(user).toMatch(/- MX \(México\):/);
  });

  it('os schemas de saída são compatíveis com o modo estrito', () => {
    expect(strictSchemaProblems(WTW_ALLOCATION_SCHEMA)).toEqual([]);
    expect(strictSchemaProblems(WTW_RIGHTS_SCHEMA)).toEqual([]);
  });
});

describe('agente', () => {
  it('alocação: uma chamada para a rodada; mapeia J1/J2 × país e ignora o que não foi pedido', async () => {
    const llm = new FakeLlmClient([
      {
        data: {
          assignments: [
            {
              match: 'J1',
              country: 'BR',
              broadcaster: 'Emissora A\u0000',
              channel: null,
              region: null,
              watch_url: null,
              evidence: [
                {
                  url: 'https://ge.globo.com/grade',
                  excerpt: 'J1 na Emissora A',
                  published_at: 'ontem',
                  stance: 'confirms',
                },
              ],
            },
            {
              match: 'J2',
              country: 'BR',
              broadcaster: 'Streaming B',
              channel: null,
              region: null,
              watch_url: null,
              evidence: [
                {
                  url: 'https://ge.globo.com/grade',
                  excerpt: 'J2 no Streaming B',
                  published_at: null,
                  stance: 'confirms',
                },
              ],
            },
            {
              match: 'J9',
              country: 'BR',
              broadcaster: 'Emissora A',
              channel: null,
              region: null,
              watch_url: null,
              evidence: [],
            },
            {
              match: 'J1',
              country: 'CL',
              broadcaster: 'Emissora A',
              channel: null,
              region: null,
              watch_url: null,
              evidence: [],
            },
          ],
          notes: null,
        },
      },
    ]);
    const out = await new WhereToWatchAgent(llm).allocate({
      competition: { slug: 'liga-x', name: 'Liga X' },
      round: 'Rodada 7',
      events: [J1, J2],
      markets: [
        { directory: br, holders: ['globo'], known: [], matches: ['J1', 'J2'] },
        { directory: config.directory('AR'), holders: [], known: [], matches: ['J1'] },
      ],
    });
    expect(llm.calls).toHaveLength(1);
    const call = llm.calls[0]!;
    expect(call).toMatchObject({ tier: 'research', webSearch: true, purpose: 'wtw:alloc:liga-x:Rodada_7' });
    expect(call.allowedDomains).toContain('globo.com');
    expect(call.allowedDomains).toContain('cbf.com.br');
    expect(call.allowedDomains).not.toContain('livesoccertv.com');
    expect(call.allowedDomains!.length).toBeLessThanOrEqual(100);
    expect(out.ignored).toBe(2);
    expect(out.byEvent.get(J1.id)!.get('BR')).toEqual([
      {
        broadcaster: 'Emissora A',
        channel: null,
        region: null,
        watchUrl: null,
        evidence: [
          {
            url: 'https://ge.globo.com/grade',
            excerpt: 'J1 na Emissora A',
            publishedAt: null,
            stance: 'confirms',
          },
        ],
      },
    ]);
    expect(out.byEvent.get(J2.id)!.get('BR')![0]!.broadcaster).toBe('Streaming B');
  });

  it('direitos: devolve só os países pedidos, sem negações como evidência', async () => {
    const llm = new FakeLlmClient([
      {
        data: {
          markets: [
            {
              country: 'br',
              distribution: 'split',
              notes: null,
              holders: [
                {
                  broadcaster: 'Emissora A',
                  channels: ['Canal 1'],
                  kind: 'free_tv',
                  all_matches: false,
                  evidence: [
                    { url: 'https://cbf.com.br/a', excerpt: 'a', published_at: null, stance: 'confirms' },
                    { url: 'https://cbf.com.br/b', excerpt: 'b', published_at: null, stance: 'denies' },
                  ],
                },
              ],
            },
            { country: 'XX', distribution: 'to_confirm', holders: [], notes: null },
          ],
          notes: 'ok',
        },
      },
    ]);
    const out = await new WhereToWatchAgent(llm).researchRights({
      competition: { slug: 'liga-x', name: 'Liga X' },
      season: 2026,
      directories: [br],
    });
    expect(llm.calls[0]).toMatchObject({ purpose: 'wtw:rights:liga-x:2026:BR', webSearch: true });
    expect(out.markets).toEqual([
      {
        country: 'BR',
        distribution: 'split',
        notes: null,
        holders: [
          {
            broadcaster: 'Emissora A',
            channels: ['Canal 1'],
            kind: 'free_tv',
            allMatches: false,
            evidence: [{ url: 'https://cbf.com.br/a', excerpt: 'a', publishedAt: null, stance: 'confirms' }],
          },
        ],
      },
    ]);
    expect(rightsPurpose('liga-x', 2026, ['BR', 'AR'])).toBe('wtw:rights:liga-x:2026');

    // provedor que garante as fontes da busca (Gemini em dois passos): URL de fora da lista não passa
    const grounded = new FakeLlmClient([
      {
        data: {
          markets: [
            {
              country: 'BR',
              distribution: 'split',
              notes: null,
              holders: [
                {
                  broadcaster: 'Emissora A',
                  channels: [],
                  kind: 'free_tv',
                  all_matches: false,
                  evidence: [
                    { url: 'https://cbf.com.br/a/', excerpt: 'a', published_at: null, stance: 'confirms' },
                    { url: 'https://inventada.com/x', excerpt: 'x', published_at: null, stance: 'confirms' },
                  ],
                },
              ],
            },
          ],
          notes: null,
        },
        groundedUrls: ['https://CBF.com.br/a#topo'],
      },
    ]);
    const g = await new WhereToWatchAgent(grounded).researchRights({
      competition: { slug: 'liga-x', name: 'Liga X' },
      season: 2026,
      directories: [br],
    });
    expect(g.markets[0]!.holders[0]!.evidence.map((e) => e.url)).toEqual(['https://cbf.com.br/a/']);
    expect(allocationPurpose('liga-x', 'Rodada 7', ['BR'])).toBe('wtw:alloc:liga-x:Rodada_7:BR');
  });
});

describe('janelas, relevância e grupos', () => {
  const at = (h: number) => new Date(KICKOFF.getTime() - h * H);

  it('T-7d só direitos; alocação a partir de T-48h do primeiro jogo da rodada; revalidação sem LLM', () => {
    expect(dueWindow(KICKOFF, at(24 * 8))).toBeNull();
    expect(dueWindow(KICKOFF, at(24 * 7 - 1))).toMatchObject({ window: 'T-7d', mode: 'rights' });
    expect(dueWindow(KICKOFF, at(47))).toMatchObject({ window: 'T-48h', mode: 'allocate' });
    // rodada começou 2 dias antes deste jogo: a alocação já abriu com o primeiro jogo
    expect(dueWindow(KICKOFF, at(90), new Date(KICKOFF.getTime() - 48 * H))).toMatchObject({
      window: 'T-48h',
    });
    expect(dueWindow(KICKOFF, at(2.5))).toMatchObject({ window: 'T-3h', mode: 'revalidate' });
    expect(dueWindow(KICKOFF, at(0.25))).toMatchObject({ window: 'T-30min', mode: 'revalidate' });
    expect(dueWindow(KICKOFF, at(-0.1))).toBeNull();
  });

  it('relevância = importância + bônus do mercado (≤ 10); prioridade cai com a distância', () => {
    const facts = { importance: 55, participantCountries: ['BR', 'AR'], competitionCountry: 'BR' };
    expect(marketRelevance(facts, 'BR')).toBe(65);
    expect(marketRelevance(facts, 'AR')).toBe(65);
    expect(marketRelevance(facts, 'MX')).toBe(55);
    expect(marketRelevance({ ...facts, importance: 98 }, 'BR')).toBe(100);
    expect(
      marketRelevance(
        { importance: 50, participantCountries: ['GB-ENG'], competitionCountry: 'GB-ENG' },
        'GB',
      ),
    ).toBe(60);
    expect(priorityOf(60, KICKOFF, KICKOFF)).toBe(60);
    expect(priorityOf(60, KICKOFF, at(48))).toBe(20);
  });

  it('calibração: liga nacional perto do topo no próprio país, Femenil e grandes europeias acima do limiar', () => {
    const regular = (tier: number) => importance({ tier, stageKind: 'regular', roundProgress: 0 }).score;
    const game = (slug: string, tier: number, country: string | null, teams: string[]) => ({
      importance: regular(tier),
      participantCountries: teams,
      competitionCountry: country,
      competition: { sport: 'football', slug },
    });
    // antes: 44 + 10 = 54 (59 na reta final), abaixo do limiar 60 no próprio México
    expect(marketRelevance(game('liga-mx', 1, 'MX', ['MX', 'MX']), 'MX')).toBe(89);
    expect(marketRelevance(game('liga-mx-femenil', 2, 'MX', ['MX', 'MX']), 'MX')).toBe(64);
    expect(marketRelevance(game('liga-mx-femenil', 2, 'MX', ['MX', 'MX']), 'BR')).toBe(29);
    for (const m of ['BR', 'AR', 'MX', 'CO', 'CL', 'PE', 'UY', 'EC']) {
      expect(marketRelevance(game('premier-league', 1, 'GB-ENG', ['GB-ENG']), m), m).toBe(64);
      expect(marketRelevance(game('bundesliga', 1, 'DE', ['DE']), m), m).toBe(60);
      expect(marketRelevance(game('eredivisie', 2, 'NL', ['NL']), m), m).toBeLessThan(60);
    }
    expect(marketRelevance(game('colombia-primera-a', 1, 'CO', ['CO']), 'CO')).toBe(89);
    expect(marketRelevance(game('colombia-primera-a', 1, 'CO', ['CO']), 'MX')).toBe(44);
    // sem config/geo: só o bônus do país
    expect(marketRelevance(game('liga-mx', 1, 'MX', ['MX', 'MX']), 'MX', null)).toBe(54);
  });

  it('política por ambiente: limiar de relevância e teto por mercado', () => {
    expect(wtwPolicyFromEnv({})).toEqual({ minRelevance: 60, dailyUsdPerMarket: 1 });
    expect(wtwPolicyFromEnv({ WTW_MIN_RELEVANCE: '70', WTW_DAILY_USD_PER_MARKET: '0.5' })).toEqual({
      minRelevance: 70,
      dailyUsdPerMarket: 0.5,
    });
    expect(wtwPolicyFromEnv({ WTW_DAILY_USD_PER_MARKET: 'unlimited' }).dailyUsdPerMarket).toBeNull();
    expect(() => wtwPolicyFromEnv({ WTW_MIN_RELEVANCE: '120' })).toThrow();
  });

  it('teto diário por mercado: quem estourou sai da chamada; o rateio é pelo número de mercados', () => {
    const spend = new Map([
      ['BR', 0.95],
      ['AR', 0.1],
    ]);
    expect(withinCap(spend, ['BR', 'AR'], 0.2, 1)).toEqual({ allowed: ['AR'], blocked: ['BR'] });
    expect(withinCap(spend, ['BR', 'AR', 'MX', 'CL'], 0.2, 1)).toEqual({
      allowed: ['BR', 'AR', 'MX', 'CL'],
      blocked: [],
    });
    expect(withinCap(spend, ['BR'], 5, null).allowed).toEqual(['BR']);
  });

  it('grupo = competição × rodada (ou data); allowlist conjunta ≤ 100; os 8 mercados cabem numa chamada', () => {
    expect(roundKeyOf('Regular Season - 32', KICKOFF)).toBe('Regular Season - 32');
    expect(roundKeyOf(null, KICKOFF)).toBe('data:2026-10-22');
    expect(groupKeyOf('liga-x', 'Rodada 7')).toBe('liga-x|Rodada 7');
    const all = config.countries.map((c) => config.directory(c));
    const domains = jointAllowedDomains(all);
    expect(domains.length).toBeLessThanOrEqual(100);
    expect(domains).toContain('cbf.com.br');
    expect(domains).toContain('tycsports.com');
    expect(packMarkets(all)).toHaveLength(1);
    expect(packMarkets(all, 30).length).toBeGreaterThan(1);
  });

  it('escala: o custo novo cresce pouco com os mercados; o antigo é linear', () => {
    const t = scaleTable({
      games: [60],
      markets: [1, 15],
      searchesPerGame: 1.5,
      roundsPerDayPerGame: 0.02,
      usdPerAllocation: 0.15,
      usdPerRights: 0.25,
      competitions: 30,
    });
    expect(t[0]!.oldUsd).toBeCloseTo(9);
    expect(t[1]!.oldUsd).toBeCloseTo(135);
    expect(t[1]!.newUsd).toBeLessThan(2);
    expect(t[1]!.newPerMarket).toBeLessThan(0.2);
  });
});

describe('fetcher', () => {
  it('só aceita http(s) públicos', () => {
    expect(isPublicHttpUrl('https://ge.globo.com/x')).toBe(true);
    for (const u of [
      'http://localhost/x',
      'http://127.0.0.1',
      'http://10.0.0.2/a',
      'http://192.168.1.1',
      'file:///etc/passwd',
      'http://u:p@x.com',
      'http://[::1]/',
    ])
      expect(isPublicHttpUrl(u), u).toBe(false);
  });

  it('extrai texto do HTML sem scripts', () => {
    expect(htmlToText('<p>Globo &amp; SporTV</p><script>alert(1)</script><style>a{}</style> &#233;')).toBe(
      'Globo & SporTV é',
    );
  });

  it('usa User-Agent genérico, segue redirecionamento e bloqueia redirecionamento interno', async () => {
    const seen: { url: string; ua: string | null }[] = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      seen.push({ url, ua: new Headers(init?.headers).get('user-agent') });
      if (url === 'https://a.example/')
        return new Response(null, { status: 301, headers: { location: 'https://b.example/' } });
      if (url === 'https://c.example/')
        return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/' } });
      return new Response('<h1>ok Globo</h1>', { status: 200 });
    }) as typeof fetch;
    const f = new HttpPageFetcher({ fetchImpl });
    expect(await f.fetch('https://a.example/')).toMatchObject({
      ok: true,
      text: 'ok Globo',
      finalUrl: 'https://b.example/',
    });
    expect(await f.fetch('https://c.example/')).toMatchObject({ ok: false, error: 'url_not_allowed' });
    expect(seen.every((s) => s.ua === WTW_USER_AGENT)).toBe(true);
    expect(WTW_USER_AGENT).not.toMatch(/@/);
  });
});

describe('verificação das evidências', () => {
  const NOW = new Date('2026-10-21T12:00:00Z');

  it('busca cada URL uma vez, não raspa agregadores e confere a menção à emissora', async () => {
    const fetcher = new FakePageFetcher({
      'https://ge.globo.com/a': '<p>O jogo passa na TV Globo</p>',
      'https://www.lance.com.br/b': '<p>Transmissão: Paramount+</p>',
    });
    const out = await verifyCandidates(
      [
        {
          broadcaster: 'Globo',
          evidence: [
            { url: 'https://ge.globo.com/a', excerpt: 'x' },
            { url: 'https://www.livesoccertv.com/m', excerpt: 'y' },
          ],
        },
        {
          broadcaster: 'ESPN',
          evidence: [
            { url: 'https://ge.globo.com/a', excerpt: 'x' },
            { url: 'https://quebrado.example/z', excerpt: 'z' },
          ],
        },
      ],
      br,
      fetcher,
      NOW,
    );
    expect(fetcher.requested.sort()).toEqual(['https://ge.globo.com/a', 'https://quebrado.example/z']);
    expect(out.candidates[0]!.evidence[0]).toMatchObject({ accessible: true, mentionsBroadcaster: true });
    expect(out.candidates[0]!.evidence[1]).toMatchObject({ accessible: null });
    expect(out.candidates[1]!.evidence[0]).toMatchObject({ accessible: true, mentionsBroadcaster: false });
    expect(out.candidates[1]!.evidence[1]).toMatchObject({ accessible: false });
  });

  it('cache por execução: a grade da rodada é buscada uma vez para todos os jogos e mercados', async () => {
    const inner = new FakePageFetcher({ 'https://ge.globo.com/grade': '<p>Grade da rodada: Globo</p>' });
    const cached = new CachingPageFetcher(inner);
    await verifyCandidates(
      [
        { broadcaster: 'Globo', evidence: [{ url: 'https://ge.globo.com/grade', excerpt: 'J1' }] },
        { broadcaster: 'Globo', evidence: [{ url: 'https://ge.globo.com/grade', excerpt: 'J2' }] },
      ],
      br,
      cached,
      NOW,
    );
    await verifyCandidates(
      [{ broadcaster: 'Globo', evidence: [{ url: 'https://ge.globo.com/grade', excerpt: 'J3' }] }],
      br,
      cached,
      NOW,
    );
    expect(inner.requested).toEqual(['https://ge.globo.com/grade']);
    expect(cached.hits).toBe(1);
  });

  it('opção salva volta como candidata sem as evidências da tabela de direitos', () => {
    const row = {
      providerName: 'Globo',
      channelName: null,
      medium: 'free_tv',
      accessModel: 'free',
      region: null,
      url: null,
      language: 'pt-BR',
      evidence: [
        {
          url: 'https://ge.globo.com/a',
          excerpt: 'a',
          fetchedAt: NOW.toISOString(),
          sourceKind: 'broadcaster',
        },
        {
          url: 'https://www.lance.com.br/direitos',
          excerpt: 'b',
          fetchedAt: NOW.toISOString(),
          sourceKind: 'rights',
        },
      ],
    } as unknown as BroadcastOptionRow;
    expect(rowToCandidate(row).evidence.map((e) => e.url)).toEqual(['https://ge.globo.com/a']);
  });

  it('reconfirmação mensal dos direitos: fonte que ainda cita o detentor sustenta; caiu → mudou', async () => {
    const rights = {
      countryCode: 'BR',
      holders: [
        {
          broadcasterId: 'globo',
          name: 'Globo',
          channels: [],
          kind: 'free_tv',
          allMatches: false,
          status: 'confirmed',
          confidence: 0.9,
          evidence: [{ url: 'https://ge.globo.com/direitos', excerpt: 'x', fetchedAt: NOW.toISOString() }],
          flags: [],
        },
      ],
    } as unknown as BroadcastRightsRow;
    const ok = await recheckRightsRow(
      rights,
      br,
      new FakePageFetcher({ 'https://ge.globo.com/direitos': '<p>A Globo segue com os direitos</p>' }),
      NOW,
    );
    expect(ok.supported).toBe(true);
    expect(ok.holders[0]!.evidence[0]!.contentHash).toBe(contentHash('A Globo segue com os direitos'));
    const gone = await recheckRightsRow(rights, br, new FakePageFetcher({}), NOW);
    expect(gone).toMatchObject({ supported: false, reasons: ['Globo: fontes não sustentam mais'] });
  });
});
