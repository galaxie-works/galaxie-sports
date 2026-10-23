/**
 * Conteúdo relacionado (docs/12, #127) ponta a ponta com banco descartável e YouTube falso: plano sem
 * chamadas, busca completa dentro da cota, política de direitos, classificação LLM + regras,
 * gravação versionada, change feed, revalidação (vídeo fora do ar → retracted) e expiração em 30 dias.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  changeFeed,
  readRelatedContent,
  RELATED_CONTENT_TOPIC,
  relatedContent,
  relatedRun,
  type Database,
} from '@galaxie/db';
import { loadWtwConfig } from '@galaxie/where-to-watch';
import { FakeLlmClient } from '../src/llm/fake.js';
import { broadcasterChannelsFrom, ChannelAllowlist, loadChannelEntries } from '../src/related/channels.js';
import { runRelatedAgent, type RelatedRunOptions } from '../src/related/run.js';
import { relatedPolicyFromEnv } from '../src/related/priority.js';
import { expireStaleRelated } from '../src/related/store.js';
import { YoutubeClient, type FetchLike } from '../src/related/youtube.js';
import { detailFixture, disposableDb, idOf, ingest, seedCatalog } from './helpers.js';

const env = disposableDb();
let db: Database;
let eventId: string;
const NOW = new Date('2026-10-12T00:00:00Z');

interface FakeVideo {
  id: string;
  title: string;
  channel: string;
  handle: string;
  subscribers: number;
  duration: string;
  views: number;
  publishedAt?: string;
  embeddable?: boolean;
}

const VIDEOS: FakeVideo[] = [
  {
    id: 'v-official',
    title: 'MELHORES MOMENTOS | PALMEIRAS 4 X 1 CORINTHIANS',
    channel: 'UCpal',
    handle: '@Palmeiras',
    subscribers: 5e6,
    duration: 'PT9M40S',
    views: 250_000,
  },
  {
    id: 'v-short',
    title: 'Golaço do Palmeiras contra o Corinthians #shorts',
    channel: 'UCge',
    handle: '@getv',
    subscribers: 9e6,
    duration: 'PT41S',
    views: 900_000,
  },
  {
    id: 'v-coletiva',
    title: 'COLETIVA | Técnico do Palmeiras após a vitória',
    channel: 'UCpal',
    handle: '@Palmeiras',
    subscribers: 5e6,
    duration: 'PT25M',
    views: 40_000,
  },
  {
    id: 'v-react',
    title: 'REACT Palmeiras 4x1 Corinthians - torcedor reage',
    channel: 'UCreact',
    handle: '@reactfc',
    subscribers: 300_000,
    duration: 'PT14M',
    views: 80_000,
  },
  {
    id: 'v-reupload',
    title: 'Palmeiras x Corinthians melhores momentos HD',
    channel: 'UCpirata',
    handle: '@pirata123',
    subscribers: 1_200,
    duration: 'PT8M',
    views: 3_000,
  },
  {
    id: 'v-outro',
    title: 'Flamengo x Vasco | Melhores momentos',
    channel: 'UCge',
    handle: '@getv',
    subscribers: 9e6,
    duration: 'PT10M',
    views: 1e6,
  },
  {
    id: 'v-antigo',
    title: 'Palmeiras 2 x 0 Corinthians | Brasileirão 2025',
    channel: 'UCpal',
    handle: '@Palmeiras',
    subscribers: 5e6,
    duration: 'PT10M',
    views: 5e5,
  },
];

function fakeYoutube(state: { removed: Set<string>; searches: string[] }): FetchLike {
  return async (url) => {
    const u = new URL(url);
    const p = u.searchParams;
    const json = (body: unknown) => new Response(JSON.stringify(body));
    if (u.pathname.endsWith('/search')) {
      state.searches.push(`${p.get('q')}|${p.get('videoDuration') ?? 'any'}|${p.get('relevanceLanguage')}`);
      const items = (
        p.get('videoDuration') === 'short' ? VIDEOS.filter((v) => v.duration === 'PT41S') : VIDEOS
      ).map((v) => ({
        id: { videoId: v.id },
        snippet: { channelId: v.channel, title: v.title, publishedAt: '2026-10-11T23:00:00Z' },
      }));
      return json({ items });
    }
    if (u.pathname.endsWith('/videos')) {
      const ids = p.get('id')!.split(',');
      return json({
        items: VIDEOS.filter((v) => ids.includes(v.id) && !state.removed.has(v.id)).map((v) => ({
          id: v.id,
          snippet: {
            title: v.title,
            description: 'Inscreva-se no canal!',
            channelId: v.channel,
            channelTitle: v.handle.slice(1),
            publishedAt: v.publishedAt ?? '2026-10-11T23:00:00Z',
            thumbnails: { high: { url: `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg` } },
          },
          contentDetails: { duration: v.duration },
          statistics: { viewCount: String(v.views) },
          player:
            v.duration === 'PT41S'
              ? { embedWidth: '1280', embedHeight: '2276' }
              : { embedWidth: '1280', embedHeight: '720' },
          status: { privacyStatus: 'public', embeddable: v.embeddable ?? true },
        })),
      });
    }
    const ids = p.get('id')!.split(',');
    const seen = new Map(VIDEOS.map((v) => [v.channel, v]));
    return json({
      items: ids.flatMap((id) => {
        const v = seen.get(id);
        return v
          ? [
              {
                id,
                snippet: { title: v.handle.slice(1), customUrl: v.handle },
                statistics: { subscriberCount: String(v.subscribers) },
              },
            ]
          : [];
      }),
    });
  };
}

/** LLM falso: classifica pelos títulos e marca o vídeo da temporada passada como outro jogo. */
const llmResponder = (req: { messages: { content: string }[] }) => {
  const content = req.messages[0]!.content;
  const ids = [...content.matchAll(/"id":"([^"]+)"/g)].map((m) => m[1]!);
  const type: Record<string, string> = {
    'v-official': 'highlights',
    'v-short': 'goal',
    'v-coletiva': 'press_conference',
    'v-react': 'fan_reaction',
    'v-reupload': 'highlights',
    'v-antigo': 'highlights',
  };
  return {
    data: {
      videos: ids
        .filter((id) => type[id])
        .map((id) => ({ id, content_type: type[id], about_this_event: id !== 'v-antigo', confidence: 0.9 })),
    },
    model: 'fake-light',
  };
};

let state: { removed: Set<string>; searches: string[] };
let base: Omit<RelatedRunOptions, 'llm' | 'youtube'>;

beforeAll(async () => {
  db = await env.setup();
  await seedCatalog(db, [
    { slug: 'brasileirao-serie-a', name: 'Serie A', leagueId: 71, tier: 1, type: 'league', country: 'BR' },
  ]);
  await ingest(db, [detailFixture()], new Date('2026-10-11T22:25:00Z'));
  eventId = await idOf(db, 'event', 1492407);
  const wtw = loadWtwConfig();
  base = {
    now: NOW,
    wtw,
    allowlist: new ChannelAllowlist({
      entries: [...loadChannelEntries(), ...broadcasterChannelsFrom(wtw)],
      blocklist: wtw.blocklist,
    }),
    // fila e orçamento sem a segunda busca e sem reserva: estes testes cobrem busca, revalidação e corte
    // pela cota; a política nova tem testes próprios (related/priority.test.ts)
    policy: { ...relatedPolicyFromEnv({}), secondSearchMinutes: 0, highReservePercent: 0 },
  };
  state = { removed: new Set(), searches: [] };
}, 120_000);

afterAll(async () => {
  await env.teardown();
});

describe('Conteúdo relacionado (integração)', () => {
  it('--plan: candidato, consultas e unidades estimadas, sem chamar nem gravar', async () => {
    const report = await runRelatedAgent(db, { ...base, plan: true, llm: null, youtube: null });
    expect(report.items).toEqual([
      expect.objectContaining({
        eventId,
        action: 'planned',
        mode: 'full',
        queries: ['pt:highlights', 'pt:shorts', 'pt:goals', 'pt:postgame'],
        units: 404,
      }),
    ]);
    expect(report.items[0]!.reason).toContain('Palmeiras x Corinthians melhores momentos');
    expect(await db.select().from(relatedRun)).toHaveLength(0);
  });

  it('busca completa: links diretos, política de direitos, classificação e change feed', async () => {
    const yt = new YoutubeClient({ apiKey: 'test', fetch: fakeYoutube(state) });
    const llm = new FakeLlmClient(llmResponder);
    const report = await runRelatedAgent(db, { ...base, llm, youtube: yt });
    const item = report.items[0]!;
    expect(item).toMatchObject({ action: 'searched', mode: 'full', published: 4, llm: true });
    expect(state.searches).toHaveLength(4);
    expect(state.searches[1]).toBe('Palmeiras Corinthians #shorts|short|pt');
    expect(report.unitsSpent).toBe(4 * 100 + 1 + 1);
    expect(llm.calls).toHaveLength(1);
    expect(llm.calls[0]!.tier).toBe('light');

    const all = await db.select().from(relatedContent).where(isNull(relatedContent.supersededBy));
    const by = new Map(all.map((r) => [r.externalId, r]));
    expect(by.has('v-outro')).toBe(false); // não cita os times do jogo
    expect(by.get('v-official')).toMatchObject({
      status: 'published',
      sourceTier: 'official',
      contentType: 'highlights',
      format: 'long',
      aspectRatio: '16:9',
      url: 'https://www.youtube.com/watch?v=v-official',
      embedUrl: 'https://www.youtube.com/embed/v-official',
      thumbnailUrl: 'https://i.ytimg.com/vi/v-official/hqdefault.jpg',
      classifiedBy: 'llm:fake-light',
      durationSeconds: 580,
    });
    expect(by.get('v-short')).toMatchObject({
      status: 'published',
      sourceTier: 'rights_holder',
      contentType: 'goal',
      format: 'short',
      aspectRatio: '9:16',
      url: 'https://www.youtube.com/shorts/v-short',
    });
    expect(by.get('v-react')).toMatchObject({
      status: 'published',
      sourceTier: 'creator',
      contentType: 'fan_reaction',
    });
    expect(by.get('v-reupload')).toMatchObject({
      status: 'rejected',
      sourceTier: 'unknown',
      flags: ['rights_risk'],
    });
    expect(by.get('v-antigo')).toMatchObject({ status: 'rejected', flags: ['not_this_event'] });

    const page = await readRelatedContent(db, eventId);
    expect(page.rows.map((r) => r.externalId)).toEqual(['v-short', 'v-official', 'v-coletiva', 'v-react']);
    expect(page.counts).toEqual({ highlights: 1, goal: 1, press_conference: 1, fan_reaction: 1 });
    const shorts = await readRelatedContent(db, eventId, { format: 'short' });
    expect(shorts.rows.map((r) => r.externalId)).toEqual(['v-short']);

    const feed = await db.select().from(changeFeed).where(eq(changeFeed.topic, RELATED_CONTENT_TOPIC));
    expect(feed).toHaveLength(1);
    expect(feed[0]).toMatchObject({ entityType: 'related_content', entityId: eventId });
    expect((feed[0]!.payload as { tags: string[] }).tags).toContain(`related_content:${eventId}`);

    const [run] = await db.select().from(relatedRun);
    expect(run).toMatchObject({
      status: 'done',
      mode: 'full',
      quotaUnits: 402,
      searches: 4,
      published: 4,
      quotaDay: '2026-10-11',
    });
  });

  it('revalidação (1 h depois): só videos.list; vídeo fora do ar vira retracted e sai da API', async () => {
    state.removed.add('v-coletiva');
    const searchesBefore = state.searches.length;
    const yt = new YoutubeClient({ apiKey: 'test', fetch: fakeYoutube(state) });
    const llm = new FakeLlmClient(llmResponder);
    const report = await runRelatedAgent(db, {
      ...base,
      now: new Date(NOW.getTime() + 3_600_000),
      llm,
      youtube: yt,
    });
    expect(report.items[0], report.items[0]!.reason).toMatchObject({
      action: 'revalidated',
      mode: 'revalidate',
      published: 3,
    });
    expect(state.searches.length).toBe(searchesBefore);
    expect(report.unitsSpent).toBe(2);
    expect(llm.calls).toHaveLength(0); // nada novo para classificar

    const page = await readRelatedContent(db, eventId);
    expect(page.rows.map((r) => r.externalId)).not.toContain('v-coletiva');
    const versions = await db
      .select()
      .from(relatedContent)
      .where(and(eq(relatedContent.eventId, eventId), eq(relatedContent.externalId, 'v-coletiva')));
    expect(versions.map((v) => v.status).sort()).toEqual(['published', 'retracted']);
    expect(
      await db.select().from(changeFeed).where(eq(changeFeed.topic, RELATED_CONTENT_TOPIC)),
    ).toHaveLength(2);
  });

  it('cota do dia: corta consultas que não cabem e pula quando não sobra nada', async () => {
    const yt = new YoutubeClient({ apiKey: 'test', fetch: fakeYoutube(state) });
    // 402 + 2 já gastos no dia de cota 2026-10-11; limite 610 → cabe 2 buscas (2×100 + 4)
    const plan = await runRelatedAgent(db, {
      ...base,
      plan: true,
      force: true,
      dailyQuota: 610,
      reservePercent: 0,
      llm: null,
      youtube: null,
    });
    expect(plan.items[0]).toMatchObject({ action: 'planned', queries: ['pt:highlights', 'pt:shorts'] });
    const skipped = await runRelatedAgent(db, {
      ...base,
      force: true,
      dailyQuota: 410,
      reservePercent: 0,
      llm: null,
      youtube: yt,
    });
    expect(skipped.items[0]).toMatchObject({ action: 'skipped' });
    expect(skipped.items[0]!.reason).toContain('cota do YouTube insuficiente');
  });

  it('expira em 30 dias sem atualização: apaga título, miniatura e estatísticas em todas as versões', async () => {
    const res = await expireStaleRelated(db, { now: new Date(NOW.getTime() + 31 * 86_400_000) });
    expect(res.events).toEqual([eventId]);
    const rows = await db.select().from(relatedContent).where(eq(relatedContent.eventId, eventId));
    expect(rows.every((r) => r.title === '' && r.thumbnailUrl === null && r.statistics === null)).toBe(true);
    expect((await readRelatedContent(db, eventId)).rows).toHaveLength(0);
  });
});
