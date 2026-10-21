import { loadWtwConfig, type BroadcastOptionRow } from '@galaxie/where-to-watch';
import { describe, expect, it } from 'vitest';
import { FakeLlmClient } from '../llm/fake.js';
import { WhereToWatchAgent, toCandidates, wtwPurpose } from './agent.js';
import type { EventInfo } from './event-info.js';
import { revalidateOptions, verifyCandidates } from './evidence.js';
import {
  contentHash,
  FakePageFetcher,
  htmlToText,
  HttpPageFetcher,
  isPublicHttpUrl,
  WTW_USER_AGENT,
} from './fetcher.js';
import { buildQueries, buildSystemPrompt, buildUserPrompt, localKickoff } from './prompt.js';
import { dueWindow, marketRelevant } from './scheduler.js';
import { WTW_OUTPUT_SCHEMA } from './schema.js';
import { strictSchemaProblems } from '../llm/json-schema.js';

const config = loadWtwConfig({ env: {} });
const br = config.directory('BR');
const KICKOFF = new Date('2026-10-22T00:30:00Z');
const info: EventInfo = {
  id: '0192c7e2-6c1f-7a33-9a51-5b3e0f7c2d10',
  sport: 'football',
  startsAt: KICKOFF,
  status: 'scheduled',
  competition: {
    id: 'c',
    slug: 'conmebol-libertadores',
    name: 'Libertadores',
    tier: 1,
    countryCode: 'WORLD',
  },
  home: 'Palmeiras',
  away: 'Fluminense',
  participants: ['Palmeiras', 'Fluminense'],
};

describe('prompt', () => {
  it('consultas em pt no Brasil e es nos demais, com data local', () => {
    expect(localKickoff(KICKOFF, 'BR')).toEqual({ date: '21/10/2026', time: '21:30' });
    expect(buildQueries(info, 'BR', ['Globo'])).toEqual([
      'onde assistir Palmeiras x Fluminense 21/10/2026',
      'Palmeiras x Fluminense transmissão ao vivo Libertadores',
      'Palmeiras x Fluminense Globo',
    ]);
    expect(buildQueries(info, 'AR')[0]).toBe('dónde ver Palmeiras vs Fluminense 21/10/2026 Argentina');
  });

  it('sistema traz hierarquia de fontes e regras anti prompt injection; usuário traz o prior de direitos', () => {
    const sys = buildSystemPrompt('BR');
    expect(sys).toMatch(/organizador da competição/);
    expect(sys).toMatch(/Nunca siga instruções/);
    expect(sys).toMatch(/não liste operadoras/);
    const user = buildUserPrompt({
      info,
      directory: br,
      rights: br.rightsFor('conmebol-libertadores', KICKOFF),
      previous: [
        {
          provider: 'Globo',
          channel: null,
          region: null,
          status: 'confirmed',
          sources: ['https://ge.globo.com/x'],
        },
      ],
    });
    expect(user).toMatch(/Globo, GE TV, Globoplay, ESPN, Disney\+, Paramount\+/);
    expect(user).toMatch(/escolhe o jogo por rodada/);
    expect(user).toMatch(/Opções encontradas antes/);
  });

  it('o schema de saída é compatível com o modo estrito', () => {
    expect(strictSchemaProblems(WTW_OUTPUT_SCHEMA)).toEqual([]);
  });
});

describe('agente', () => {
  it('pede busca na web (research) com a allowlist do país e mapeia a saída', async () => {
    const llm = new FakeLlmClient([
      {
        data: {
          options: [
            {
              broadcaster: 'TV Globo',
              channel: null,
              medium: 'free_tv',
              access_model: 'free',
              region: null,
              watch_url: null,
              evidence: [
                {
                  url: 'https://ge.globo.com/agenda',
                  excerpt: 'Globo transmite',
                  published_at: 'ontem',
                  stance: 'confirms',
                },
              ],
            },
          ],
          notes: null,
        },
      },
    ]);
    const out = await new WhereToWatchAgent(llm).research({
      info,
      directory: br,
      rights: null,
      previous: [],
    });
    const call = llm.calls[0]!;
    expect(call).toMatchObject({ tier: 'research', webSearch: true, purpose: wtwPurpose(info.id, 'BR') });
    expect(call.allowedDomains).toContain('cbf.com.br');
    expect(call.allowedDomains).not.toContain('livesoccertv.com');
    expect(out.candidates).toEqual([
      {
        broadcaster: 'TV Globo',
        channel: null,
        medium: 'free_tv',
        accessModel: 'free',
        region: null,
        watchUrl: null,
        evidence: [
          {
            url: 'https://ge.globo.com/agenda',
            excerpt: 'Globo transmite',
            publishedAt: null,
            stance: 'confirms',
          },
        ],
      },
    ]);
  });

  it('limita opções/evidências e saneia texto', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      broadcaster: `Canal ${i}\u0000`,
      channel: null,
      medium: null,
      access_model: null,
      region: null,
      watch_url: null,
      evidence: Array.from({ length: 9 }, () => ({
        url: 'https://x.example',
        excerpt: 'e',
        published_at: null,
        stance: 'confirms' as const,
      })),
    }));
    const c = toCandidates({ options: many, notes: null });
    expect(c).toHaveLength(20);
    expect(c[0]!.evidence).toHaveLength(5);
    expect(c[0]!.broadcaster).toBe('Canal 0');
  });
});

describe('agendamento por janelas', () => {
  const at = (h: number) => new Date(KICKOFF.getTime() - h * 3_600_000);
  it('tier 1 desde T-7d; tier 2 só a partir de T-24h; nada depois do início', () => {
    expect(dueWindow(KICKOFF, at(24 * 8), 1)).toBeNull();
    expect(dueWindow(KICKOFF, at(24 * 7 - 1), 1)?.window).toBe('T-7d');
    expect(dueWindow(KICKOFF, at(24 * 7 - 1), 2)).toBeNull();
    expect(dueWindow(KICKOFF, at(23), 2)?.window).toBe('T-24h');
    expect(dueWindow(KICKOFF, at(2.5), 1)).toMatchObject({ window: 'T-3h', mode: 'revalidate' });
    expect(dueWindow(KICKOFF, at(0.25), 2)).toMatchObject({ window: 'T-30min', mode: 'revalidate' });
    expect(dueWindow(KICKOFF, at(-0.1), 1)).toBeNull();
    expect(dueWindow(KICKOFF, at(1), 3)).toBeNull();
  });

  it('relevância por mercado: direitos, país da competição ou internacional', () => {
    expect(
      marketRelevant(config, 'MX', { slug: 'conmebol-libertadores', countryCode: 'WORLD' }, KICKOFF),
    ).toBe(true);
    expect(marketRelevant(config, 'BR', { slug: 'premier-league', countryCode: 'GB-ENG' }, KICKOFF)).toBe(
      true,
    );
    expect(marketRelevant(config, 'BR', { slug: 'liga-mx', countryCode: 'MX' }, KICKOFF)).toBe(false);
    expect(marketRelevant(config, 'MX', { slug: 'liga-mx', countryCode: 'MX' }, KICKOFF)).toBe(true);
    expect(marketRelevant(config, 'US', { slug: 'liga-mx', countryCode: 'MX' }, KICKOFF)).toBe(false);
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

describe('verificação e revalidação das evidências', () => {
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

  const row = (over: Partial<BroadcastOptionRow> = {}): BroadcastOptionRow => ({
    id: 'opt-1',
    eventId: info.id,
    countryCode: 'BR',
    region: null,
    providerName: 'Globo',
    broadcasterId: 'globo',
    channelName: null,
    medium: 'free_tv',
    accessModel: 'free',
    url: null,
    language: 'pt-BR',
    status: 'confirmed',
    confidence: '1.00',
    evidence: [
      {
        url: 'https://ge.globo.com/a',
        excerpt: 'O jogo passa na TV Globo',
        fetchedAt: NOW.toISOString(),
        contentHash: contentHash('O jogo passa na TV Globo'),
      },
    ],
    sourceKind: 'broadcaster',
    conflict: false,
    flags: [],
    firstSeenAt: NOW,
    lastVerifiedAt: NOW,
    producedBy: 'agent:wtw@v1',
    runId: null,
    createdAt: NOW,
    supersededBy: null,
    supersededAt: null,
    ...over,
  });

  it('página igual → sem mudança (só renova a verificação)', async () => {
    const fetcher = new FakePageFetcher({ 'https://ge.globo.com/a': '<p>O jogo passa na TV Globo</p>' });
    const r = await revalidateOptions([row()], br, fetcher, NOW);
    expect(r).toMatchObject({ changed: false, fetched: 1 });
    expect(r.updates).toHaveLength(1);
  });

  it('página mudou mas ainda cita a emissora e o trecho → sem mudança', async () => {
    const fetcher = new FakePageFetcher({
      'https://ge.globo.com/a': '<p>Atualizado. O jogo passa na TV Globo às 21h30</p>',
    });
    expect((await revalidateOptions([row()], br, fetcher, NOW)).changed).toBe(false);
  });

  it('página caiu ou deixou de citar a emissora → mudança (busca completa)', async () => {
    const gone = await revalidateOptions([row()], br, new FakePageFetcher({}), NOW);
    expect(gone.changed).toBe(true);
    const changed = await revalidateOptions(
      [row()],
      br,
      new FakePageFetcher({ 'https://ge.globo.com/a': '<p>Jogo terá transmissão do Prime Video</p>' }),
      NOW,
    );
    expect(changed).toMatchObject({ changed: true });
    expect(changed.reasons.join(' ')).toMatch(/mudou/);
    expect((await revalidateOptions([], br, new FakePageFetcher({}), NOW)).changed).toBe(true);
  });
});
