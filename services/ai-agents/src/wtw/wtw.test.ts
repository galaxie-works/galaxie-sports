import { createServer, type Server } from 'node:http';
import type { AddressInfo, LookupFunction } from 'node:net';
import { gzipSync } from 'node:zlib';
import { loadWtwConfig, type BroadcastOptionRow, type BroadcastRightsRow } from '@galaxie/where-to-watch';
import { importance } from '@galaxie/providers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
  guardedLookup,
  HttpPageFetcher,
  isPublicAddress,
  isPublicHttpUrl,
  WTW_USER_AGENT,
  type HostResolver,
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
import { failureUsage, researchBackoffMs, withinCap } from './spend.js';
import { LlmError } from '../llm/errors.js';

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
              broadcaster: 'TV Globo\u0000',
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
              broadcaster: 'Premiere',
              channel: null,
              region: null,
              watch_url: null,
              evidence: [
                {
                  url: 'https://ge.globo.com/grade',
                  excerpt: 'J2 no Premiere',
                  published_at: null,
                  stance: 'confirms',
                },
              ],
            },
            // fora da lista de detentores (e fora do dicionário): descartadas aqui
            ...['SBT', 'Streaming B'].map((broadcaster) => ({
              match: 'J2',
              country: 'BR',
              broadcaster,
              channel: null,
              region: null,
              watch_url: null,
              evidence: [
                {
                  url: 'https://www.cbf.com.br/grade',
                  excerpt: `J2 no ${broadcaster}`,
                  published_at: null,
                  stance: 'confirms',
                },
              ],
            })),
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
        { directory: br, holders: ['globo'], known: ['premiere'], matches: ['J1', 'J2'] },
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
    expect(out.ignored).toBe(4);
    expect(out.byEvent.get(J1.id)!.get('BR')).toEqual([
      {
        broadcaster: 'TV Globo',
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
    expect(
      out.byEvent
        .get(J2.id)!
        .get('BR')!
        .map((c) => c.broadcaster),
    ).toEqual(['Premiere']);
  });

  it('alocação com grounding: evidência com URL fora da busca do provedor cai antes de ser buscada', async () => {
    const evidence = (url: string) => ({
      url,
      excerpt: 'J1 na Globo',
      published_at: null,
      stance: 'confirms',
    });
    const llm = new FakeLlmClient([
      {
        data: {
          assignments: [
            {
              match: 'J1',
              country: 'BR',
              broadcaster: 'TV Globo',
              channel: null,
              region: null,
              watch_url: null,
              evidence: [evidence('https://ge.globo.com/grade'), evidence('http://127.0.0.1.nip.io/x')],
            },
          ],
          notes: null,
        },
        groundedUrls: ['https://ge.globo.com/grade'],
      },
    ]);
    const out = await new WhereToWatchAgent(llm).allocate({
      competition: { slug: 'liga-x', name: 'Liga X' },
      round: 'Rodada 7',
      events: [J1],
      markets: [{ directory: br, holders: ['globo'], known: [], matches: ['J1'] }],
    });
    expect(
      out.byEvent
        .get(J1.id)!
        .get('BR')![0]!
        .evidence.map((e) => e.url),
    ).toEqual(['https://ge.globo.com/grade']);
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
    // a alocação por rodada do wtw-run fica desligada: o canal do jogo é do job wtw-channel
    expect(wtwPolicyFromEnv({})).toEqual({ minRelevance: 60, dailyUsdPerMarket: 1, roundAllocation: false });
    expect(wtwPolicyFromEnv({ WTW_MIN_RELEVANCE: '70', WTW_DAILY_USD_PER_MARKET: '0.5' })).toEqual({
      minRelevance: 70,
      dailyUsdPerMarket: 0.5,
      roundAllocation: false,
    });
    expect(wtwPolicyFromEnv({ WTW_ROUND_ALLOCATION: 'on' }).roundAllocation).toBe(true);
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
    // sem o BR, o AR pagaria a chamada inteira e passaria do teto: o rateio é refeito
    const near = new Map([
      ['BR', 0.95],
      ['AR', 0.7],
    ]);
    expect(withinCap(near, ['BR', 'AR'], 0.4, 1)).toEqual({ allowed: [], blocked: ['BR', 'AR'] });
    expect(withinCap(near, ['BR', 'AR', 'MX'], 0.4, 1)).toEqual({
      allowed: ['AR', 'MX'],
      blocked: ['BR'],
    });
  });

  it('falha: uso parcial do provedor ou, no timeout sem parcial, a estimativa da chamada; espera crescente', () => {
    const timeout = new LlmError('tempo esgotado', 'timeout', true);
    expect(failureUsage(timeout, 0.15)).toEqual({
      usage: { inputTokens: 0, outputTokens: 0, costUsd: 0.15 },
      stats: { costEstimated: true },
    });
    const partial = Object.assign(new LlmError('cortado', 'incomplete', false), {
      usage: { inputTokens: 10, outputTokens: 2, costUsd: 0.01 },
    });
    expect(failureUsage(partial, 0.15).usage).toEqual({ inputTokens: 10, outputTokens: 2, costUsd: 0.01 });
    expect(failureUsage(new LlmError('fora', 'provider', true), 0.15).usage).toBeUndefined();
    expect([1, 2, 3, 10].map((n) => researchBackoffMs(n) / 60_000)).toEqual([30, 60, 120, 360]);
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
  it('só aceita http(s) públicos (nome e IP literal, inclusive IPv6 mapeado e CGNAT)', () => {
    expect(isPublicHttpUrl('https://ge.globo.com/x')).toBe(true);
    expect(isPublicHttpUrl('http://8.8.8.8/')).toBe(true);
    expect(isPublicHttpUrl('http://[2606:4700::1111]/')).toBe(true);
    for (const u of [
      'http://localhost/x',
      'http://localhost./x',
      'http://metadata/computeMetadata',
      'http://metadata.google.internal/',
      'http://127.0.0.1',
      'http://0x7f.1/',
      'http://2130706433/',
      'http://10.0.0.2/a',
      'http://192.168.1.1',
      'http://100.64.0.1/',
      'http://169.254.169.254/latest/meta-data',
      'http://0.0.0.0/',
      'file:///etc/passwd',
      'http://u:p@x.com',
      'http://[::1]/',
      'http://[::]/',
      'http://[::ffff:a9fe:a9fe]/',
      'http://[::ffff:127.0.0.1]/',
      'http://[64:ff9b::a9fe:a9fe]/',
      'http://[fe80::1]/',
      'http://[fd00:ec2::254]/',
    ])
      expect(isPublicHttpUrl(u), u).toBe(false);
    expect(isPublicAddress('::ffff:8.8.8.8')).toBe(true);
    expect(isPublicAddress('not-an-ip')).toBe(false);
  });

  it('extrai texto do HTML sem scripts', () => {
    expect(htmlToText('<p>Globo &amp; SporTV</p><script>alert(1)</script><style>a{}</style> &#233;')).toBe(
      'Globo & SporTV é',
    );
  });

  const fakeDns =
    (table: Record<string, string[]>): HostResolver =>
    async (host) => {
      const ips = table[host];
      if (!ips) throw Object.assign(new Error(`não resolve: ${host}`), { code: 'ENOTFOUND' });
      return ips.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
    };
  const call = (lookup: LookupFunction, host: string, all = false) =>
    new Promise<{ err: NodeJS.ErrnoException | null; address: unknown }>((resolve) =>
      lookup(host, { all }, (err, address) => resolve({ err, address })),
    );

  it('na conexão: recusa nome que resolve para endereço interno (qualquer um deles)', async () => {
    const lookup = guardedLookup(
      fakeDns({
        'publico.example': ['93.184.216.34', '2606:2800:220:1::1'],
        '127.0.0.1.nip.io': ['127.0.0.1'],
        'misto.example': ['93.184.216.34', '10.0.0.7'],
        'mapeado.example': ['::ffff:169.254.169.254'],
        'cgnat.example': ['100.100.100.200'],
      }),
    );
    expect(await call(lookup, 'publico.example')).toEqual({ err: null, address: '93.184.216.34' });
    expect((await call(lookup, 'publico.example', true)).address).toEqual([
      { address: '93.184.216.34', family: 4 },
      { address: '2606:2800:220:1::1', family: 6 },
    ]);
    for (const host of ['127.0.0.1.nip.io', 'misto.example', 'mapeado.example', 'cgnat.example'])
      expect((await call(lookup, host)).err?.code, host).toBe('EADDRNOTPUBLIC');
    expect((await call(lookup, 'inexistente.example')).err?.code).toBe('ENOTFOUND');
  });

  describe('HttpPageFetcher com servidor local e DNS falso (sem rede)', () => {
    let server: Server;
    let port = 0;
    const seen: { host: string; ua: string | undefined }[] = [];
    beforeAll(async () => {
      server = createServer((req, res) => {
        const host = (req.headers.host ?? '').split(':')[0]!;
        seen.push({ host, ua: req.headers['user-agent'] });
        const redirect = (location: string) => {
          res.writeHead(302, { location });
          res.end();
        };
        if (host === 'a.example') return redirect(`http://b.example:${port}/`);
        if (host === 'c.example') return redirect(`http://interno.example:${port}/`);
        if (host === 'd.example') return redirect('http://[::ffff:a9fe:a9fe]/latest/meta-data');
        if (host === 'e.example') return redirect(`http://misto.example:${port}/`);
        if (host === 'grande.example') {
          res.writeHead(200, { 'content-type': 'text/html' });
          res.end(`<p>${'x'.repeat(5_000)}</p>`);
          return;
        }
        res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' });
        res.end(gzipSync('<h1>ok Globo</h1>'));
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      port = (server.address() as AddressInfo).port;
    });
    afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

    // só o servidor de teste (127.0.0.1) é liberado além dos endereços públicos
    const local = ['127.0.0.1'];
    const fetcher = (maxBytes?: number) =>
      new HttpPageFetcher({
        resolve: fakeDns({
          'a.example': local,
          'b.example': local,
          'c.example': local,
          'd.example': local,
          'e.example': local,
          'grande.example': local,
          'interno.example': ['10.0.0.7'],
          'misto.example': ['127.0.0.1', '192.168.0.10'],
        }),
        allowAddress: (ip) => ip === '127.0.0.1' || isPublicAddress(ip),
        ...(maxBytes ? { maxBytes } : {}),
      });

    it('segue redirecionamento, descompacta e usa User-Agent genérico', async () => {
      expect(await fetcher().fetch(`http://a.example:${port}/`)).toMatchObject({
        ok: true,
        text: 'ok Globo',
        finalUrl: `http://b.example:${port}/`,
      });
      expect(seen.every((s) => s.ua === WTW_USER_AGENT)).toBe(true);
      expect(WTW_USER_AGENT).not.toMatch(/@/);
    });

    it('redirecionamento para host interno é recusado na conexão (o host interno nunca é contatado)', async () => {
      const f = fetcher();
      for (const start of ['c.example', 'd.example', 'e.example'])
        expect(await f.fetch(`http://${start}:${port}/`), start).toMatchObject({
          ok: false,
          error: 'url_not_allowed',
        });
      expect(seen.some((s) => ['interno.example', 'misto.example'].includes(s.host))).toBe(false);
    });

    it('limita o tamanho lido', async () => {
      const r = await fetcher(1_000).fetch(`http://grande.example:${port}/`);
      expect(r.ok).toBe(true);
      expect(r.text.length).toBeLessThan(5_000);
    });
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

  it('confere o trecho salvo na página, não só a menção à emissora', async () => {
    const fetcher = new FakePageFetcher({
      'https://ge.globo.com/grade': '<p>Grade da rodada: Time Um x Time Dois na TV Globo</p>',
    });
    const out = await verifyCandidates(
      [
        {
          broadcaster: 'Globo',
          evidence: [
            { url: 'https://ge.globo.com/grade', excerpt: 'Time Um x Time Dois na TV Globo' },
            { url: 'https://ge.globo.com/grade', excerpt: 'Time Três x Time Quatro na TV Globo' },
            { url: 'https://ge.globo.com/grade', excerpt: 'curto' },
          ],
        },
      ],
      br,
      fetcher,
      NOW,
    );
    expect(out.candidates[0]!.evidence.map((e) => [e.mentionsBroadcaster, e.excerptFound])).toEqual([
      [true, true],
      [true, false],
      [true, true],
    ]);
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
