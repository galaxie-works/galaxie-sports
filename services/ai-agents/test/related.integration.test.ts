/**
 * Conteúdo relacionado (docs/12, #127) ponta a ponta com banco descartável e YouTube falso: plano sem
 * chamadas, busca completa dentro da cota, política de direitos, classificação LLM + regras,
 * gravação versionada, change feed, revalidação (vídeo fora do ar → retracted) e expiração em 30 dias.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AUTO_CHANNEL_RULE_BY,
  changeFeed,
  event,
  eventParticipant,
  readRelatedContent,
  RELATED_CONTENT_TOPIC,
  relatedBudget,
  relatedChannel,
  relatedChannelRule,
  relatedContent,
  relatedPlaybackBlock,
  relatedRun,
  youtubeChannel,
  type Database,
} from '@galaxie/db';
import { Blocklist, loadWtwConfig } from '@galaxie/where-to-watch';
import { ChannelBook } from '../src/related/channel-map.js';
import { broadcasterChannelsFrom, ChannelAllowlist, loadChannelEntries } from '../src/related/channels.js';
import { runRelatedAgent, type RelatedRunOptions } from '../src/related/run.js';
import { relatedPolicyFromEnv } from '../src/related/priority.js';
import { purgeYoutubeData } from '../src/related/store.js';
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

function fakeYoutube(state: { removed: Set<string>; searches: string[]; videoIds?: string[] }): FetchLike {
  return async (url) => {
    const u = new URL(url);
    const p = u.searchParams;
    if (u.pathname.endsWith('/videos')) state.videoIds?.push(...p.get('id')!.split(','));
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

let state: { removed: Set<string>; searches: string[] };
let base: Omit<RelatedRunOptions, 'youtube'>;

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
    // pela cota; a política nova tem testes próprios (related/priority.test.ts, budget.test.ts) e a
    // simulação do dia (related-day.integration.test.ts)
    policy: {
      ...relatedPolicyFromEnv({}),
      secondSearchMinutes: 0,
      reserveMaxPercent: 0,
      maxSearchesPerRun: 4,
      revalidateMinutes: 30,
    },
  };
  state = { removed: new Set(), searches: [] };
}, 120_000);

afterAll(async () => {
  await env.teardown();
});

describe('Conteúdo relacionado (integração)', () => {
  it('--plan: candidato, consultas e unidades estimadas, sem chamar nem gravar', async () => {
    const report = await runRelatedAgent(db, { ...base, plan: true, youtube: null });
    expect(report.items).toEqual([
      expect.objectContaining({
        eventId,
        action: 'planned',
        mode: 'full',
        queries: ['pt:highlights', 'pt:shorts', 'pt:goals', 'pt:postgame'],
        searches: 4,
        units: 2,
      }),
    ]);
    expect(report.items[0]!.reason).toContain('Palmeiras x Corinthians melhores momentos');
    expect(await db.select().from(relatedRun)).toHaveLength(0);
  });

  it('busca completa: links diretos, política de direitos, classificação e change feed', async () => {
    const yt = new YoutubeClient({ apiKey: 'test', fetch: fakeYoutube(state) });
    const report = await runRelatedAgent(db, { ...base, youtube: yt });
    const item = report.items[0]!;
    expect(item).toMatchObject({ action: 'searched', mode: 'full', published: 5 });
    // parada cedo: a segunda busca (#shorts) não trouxe vídeo novo aproveitável → as outras duas não saem
    expect(state.searches).toHaveLength(2);
    expect(state.searches[1]).toBe('Palmeiras Corinthians #shorts|short|pt');
    // balde de busca: 2 consultas; balde geral: 1 videos.list + 1 channels.list
    expect(report.quota.search.spent).toBe(2);
    expect(report.quota.api.spent).toBe(2);

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
      classifiedBy: 'rules@v1',
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
    // imagem de jogo de canal sem direito também é publicada (decisão do dono, 27/10/2026); o ranking a põe
    // depois dos oficiais e detentores
    expect(by.get('v-reupload')).toMatchObject({
      status: 'published',
      sourceTier: 'unknown',
      contentType: 'highlights',
      flags: [],
    });
    // sem palavra-chave no título, a regra não sabe o tipo: fica pendente (confiança baixa)
    expect(by.get('v-antigo')).toMatchObject({ status: 'pending', contentType: 'other' });

    const page = await readRelatedContent(db, eventId);
    expect(page.rows.map((r) => r.externalId)).toEqual([
      'v-short',
      'v-official',
      'v-coletiva',
      'v-react',
      'v-reupload',
    ]);
    expect(page.counts).toEqual({ highlights: 2, goal: 1, press_conference: 1, fan_reaction: 1 });
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
      quotaUnits: 4,
      apiUnits: 2,
      searches: 2,
      published: 5,
      quotaDay: '2026-10-11',
    });
  });

  it('revalidação (1 h depois): só videos.list; vídeo fora do ar vira retracted e sai da API', async () => {
    state.removed.add('v-coletiva');
    const searchesBefore = state.searches.length;
    const yt = new YoutubeClient({ apiKey: 'test', fetch: fakeYoutube(state) });
    const report = await runRelatedAgent(db, {
      ...base,
      now: new Date(NOW.getTime() + 3_600_000),
      youtube: yt,
    });
    expect(report.items[0], report.items[0]!.reason).toMatchObject({
      action: 'revalidated',
      mode: 'revalidate',
      published: 4,
    });
    expect(state.searches.length).toBe(searchesBefore);
    // 1 videos.list; o canal já está no cache permanente (enrich.youtube_channel)
    expect(report.quota).toMatchObject({ search: { spent: 0 }, api: { spent: 1 } });

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

  it('canal que entra na blocklist editorial: o vídeo já publicado é retirado na revalidação', async () => {
    const yt = new YoutubeClient({ apiKey: 'test', fetch: fakeYoutube(state) });
    const report = await runRelatedAgent(db, {
      ...base,
      now: new Date(NOW.getTime() + 2 * 3_600_000),
      allowlist: new ChannelAllowlist({
        entries: [...loadChannelEntries(), ...broadcasterChannelsFrom(base.wtw)],
        blocklist: new Blocklist([{ name: 'reactfc', aliases: [], domains: [] }]),
      }),
      youtube: yt,
    });
    expect(report.items[0]).toMatchObject({ action: 'revalidated', published: 3 });
    const versions = await db
      .select()
      .from(relatedContent)
      .where(and(eq(relatedContent.eventId, eventId), eq(relatedContent.externalId, 'v-react')));
    expect(versions.map((v) => v.status).sort()).toEqual(['published', 'retracted']);
    expect((await readRelatedContent(db, eventId)).rows.map((r) => r.externalId)).not.toContain('v-react');

    // balde geral: com 1 unidade sobrando, a revalidação (videos.list + channels.list) nem entra
    const used = report.quota.api.usedBefore + report.quota.api.spent;
    const tight = await runRelatedAgent(db, {
      ...base,
      now: new Date(NOW.getTime() + 4 * 3_600_000),
      dailyQuota: used + 1,
      reservePercent: 0,
      youtube: yt,
    });
    expect(tight.items).toHaveLength(0);
    expect(tight.idle).toBe(1);
    expect(tight.quota.api.spent).toBe(0);
  });

  it('cota do dia: corta consultas que não cabem e pula quando não sobra nada', async () => {
    const yt = new YoutubeClient({ apiKey: 'test', fetch: fakeYoutube(state) });
    // 2 consultas já gastas no dia de cota 2026-10-11 (balde de busca, contado em consultas); limite 4 → cabem 2
    const plan = await runRelatedAgent(db, {
      ...base,
      plan: true,
      force: true,
      searchDailyQuota: 4,
      reservePercent: 0,
      youtube: null,
    });
    expect(plan.items[0]).toMatchObject({ action: 'planned', queries: ['pt:highlights', 'pt:shorts'] });
    const skipped = await runRelatedAgent(db, {
      ...base,
      force: true,
      searchDailyQuota: 2,
      reservePercent: 0,
      youtube: yt,
    });
    expect(skipped.items[0]).toMatchObject({ action: 'skipped', quotaSkip: true });
    expect(skipped.items[0]!.reason).toContain('balde de busca do YouTube esgotado');
    // o painel de Operação lê o orçamento do dia e os jogos pulados por cota
    const [budget] = await db.select().from(relatedBudget);
    expect(budget).toMatchObject({ quotaDay: '2026-10-11', searchLimit: 2, searchUsed: 2, apiLimit: 10_000 });
    expect(budget!.skipped.map((s) => s.eventId)).toEqual([eventId]);
  });

  it('coleta: vídeo recusado e canal bloqueado não vão para o videos.list (não gastam cota)', async () => {
    const before = await db.select().from(relatedRun);
    // v-react recusado pelo player; o canal da emissora (v-short, v-outro) bloqueado no limiar de recusas
    await db.insert(relatedPlaybackBlock).values({
      provider: 'youtube',
      externalId: 'v-react',
      code: 150,
      channelId: 'UCreact',
      tenantId: null,
      firstReportedAt: NOW,
      lastReportedAt: NOW,
    });
    await db.insert(relatedChannelRule).values({
      provider: 'youtube',
      channelId: 'UCge',
      mode: 'block',
      updatedBy: AUTO_CHANNEL_RULE_BY,
    });
    const seen = { removed: new Set<string>(), searches: [] as string[], videoIds: [] as string[] };
    const yt = new YoutubeClient({ apiKey: 'test', fetch: fakeYoutube(seen) });
    const report = await runRelatedAgent(db, {
      ...base,
      now: new Date(NOW.getTime() + 5 * 3_600_000),
      force: true,
      youtube: yt,
    });
    expect(report.items[0], report.items[0]!.reason).toMatchObject({ action: 'searched' });
    expect(seen.searches.length).toBeGreaterThan(0);
    // nenhum id bloqueado chegou ao videos.list: nem os da busca, nem os guardados
    for (const id of ['v-react', 'v-short', 'v-outro']) expect(seen.videoIds).not.toContain(id);
    expect(seen.videoIds).toContain('v-official');
    const [run] = (await db.select().from(relatedRun)).filter((r) => !before.some((b) => b.id === r.id));
    // guardado bloqueado: o v-short (o v-react já tinha sido retirado pela blocklist editorial)
    expect(run!.stats).toMatchObject({ blockedSkipped: { stored: 1 } });
    expect((run!.stats as { blockedSkipped: { videos: number } }).blockedSkipped.videos).toBeGreaterThan(0);
    // os guardados bloqueados não são retirados: só ficam fora da vitrine (voltam se o bloqueio sair)
    const current = await db
      .select({ externalId: relatedContent.externalId, status: relatedContent.status })
      .from(relatedContent)
      .where(and(eq(relatedContent.eventId, eventId), isNull(relatedContent.supersededBy)));
    expect(current.find((r) => r.externalId === 'v-short')?.status).toBe('published');
    const page = await readRelatedContent(db, eventId);
    expect(page.rows.map((r) => r.externalId)).not.toContain('v-short');
    expect(page.rows.map((r) => r.externalId)).not.toContain('v-react');
  });

  it('canal bloqueado sem cache fresco não vai para o channels.list', async () => {
    // o canal do Palmeiras no mapa, bloqueado no painel, e sem cache em youtube_channel
    const [home] = await db
      .select({ id: eventParticipant.participantId })
      .from(eventParticipant)
      .where(and(eq(eventParticipant.eventId, eventId), eq(eventParticipant.side, 'home')));
    await db.insert(relatedChannel).values({
      channelId: 'UCbloq',
      kind: 'club',
      participantId: home!.id,
      source: 'config',
    });
    await db.insert(relatedChannelRule).values({ provider: 'youtube', channelId: 'UCbloq', mode: 'block' });
    const calls: string[] = [];
    const fetch: FetchLike = async (url) => {
      calls.push(new URL(url).pathname);
      return new Response(JSON.stringify({ items: [] }));
    };
    const book = new ChannelBook(db, new YoutubeClient({ apiKey: 'test', fetch }), { now: NOW });
    const query = {
      participantIds: [home!.id],
      competitionId: null,
      holders: new Set<string>(),
      markets: [],
    };
    expect(await book.knownChannels(query, new Set(['UCbloq']))).toEqual([]);
    expect(calls).toEqual([]);
    // sem o filtro, o mesmo canal pediria o channels.list
    await book.knownChannels(query);
    expect(calls.some((c) => c.endsWith('/channels'))).toBe(true);
    await db.delete(relatedChannel).where(eq(relatedChannel.channelId, 'UCbloq'));
    await db.delete(relatedChannelRule).where(eq(relatedChannelRule.channelId, 'UCbloq'));
  });

  it('retenção de 30 dias: apaga vídeos, canais e recusas; o canal no limiar fica bloqueado por regra', async () => {
    // a CazéTV de produção: 3 vídeos recusados, nenhuma regra
    const t0 = new Date(NOW.getTime() - 3_600_000);
    await db.insert(relatedPlaybackBlock).values(
      ['cz-a', 'cz-b', 'cz-c'].map((externalId) => ({
        provider: 'youtube',
        externalId,
        code: 150 as const,
        channelId: 'UCcaze',
        tenantId: null,
        firstReportedAt: t0,
        lastReportedAt: t0,
      })),
    );
    await db.insert(relatedChannelRule).values({
      provider: 'youtube',
      channelId: 'UCmanual',
      mode: 'block',
      channelTitle: 'Título vindo da API',
      updatedBy: 'admin@galaxie.test',
      updatedAt: t0,
    });
    const later = new Date(NOW.getTime() + 31 * 86_400_000);
    // vídeo achado de novo há pouco (dado fresco), com a recusa antiga: ao sair a recusa, volta à vitrine
    await db.insert(relatedPlaybackBlock).values({
      provider: 'youtube',
      externalId: 'v-volta',
      code: 150,
      channelId: 'UCnovo',
      tenantId: null,
      firstReportedAt: t0,
      lastReportedAt: t0,
    });
    await db.insert(relatedContent).values({
      eventId,
      provider: 'youtube',
      externalId: 'v-volta',
      url: 'https://www.youtube.com/watch?v=v-volta',
      title: 'Palmeiras x Corinthians | Bastidores',
      channelId: 'UCnovo',
      channelTitle: 'Canal novo',
      sourceTier: 'media',
      contentType: 'behind_the_scenes',
      format: 'long',
      aspectRatio: '16:9',
      publishedAt: NOW,
      rankScore: '1.000',
      confidence: '0.90',
      classifiedBy: 'rules@v1',
      status: 'published',
      firstSeenAt: new Date(later.getTime() - 86_400_000),
      lastCheckedAt: new Date(later.getTime() - 86_400_000),
    });
    const res = await purgeYoutubeData(db, { now: later });
    expect(res.promoted).toEqual(['UCcaze']);
    expect(res.events).toEqual([eventId]);
    expect(res.rows).toBeGreaterThan(0);
    expect(res.channels).toBeGreaterThan(0);
    expect(res.blocks).toBe(5); // as 3 da CazéTV, a do v-react e a do v-volta
    expect(res.ruleTitles).toBe(1);
    // nada do YouTube com mais de 30 dias sobra: nem vídeo (com título, canal e handle), nem o cache de canais,
    // nem os ids recusados; só o v-volta, obtido há um dia
    const left = await db.select().from(relatedContent).where(eq(relatedContent.eventId, eventId));
    expect(left.map((r) => r.externalId)).toEqual(['v-volta']);
    expect(await db.select().from(youtubeChannel)).toEqual([]);
    expect(await db.select().from(relatedPlaybackBlock)).toEqual([]);
    expect((await readRelatedContent(db, eventId)).rows.map((r) => r.externalId)).toEqual(['v-volta']);
    // o bloqueio da CazéTV continua, como regra nossa (só o id do canal); a regra manual perdeu o título
    const rules = await db.select().from(relatedChannelRule);
    expect(rules.find((r) => r.channelId === 'UCcaze')).toMatchObject({
      mode: 'block',
      updatedBy: AUTO_CHANNEL_RULE_BY,
      channelTitle: null,
    });
    expect(rules.find((r) => r.channelId === 'UCmanual')?.channelTitle).toBeNull();
    // a vitrine do jogo é avisada: o que saiu, o que voltou, e o esporte e a competição para os filtros
    const feed = await db.select().from(changeFeed).where(eq(changeFeed.entityId, eventId));
    const [ev] = await db.select().from(event).where(eq(event.id, eventId));
    expect(feed.at(-1)!.payload).toMatchObject({
      sport: 'football',
      competition_id: ev!.competitionId,
      data: { added: ['v-volta'], removed: expect.arrayContaining(['v-official']) },
    });
    expect((feed.at(-1)!.payload as { data: { removed: string[] } }).data.removed).not.toContain('v-volta');
    // idempotente
    expect(await purgeYoutubeData(db, { now: later })).toMatchObject({
      promoted: [],
      rows: 0,
      events: [],
      channels: 0,
      blocks: 0,
      reports: 0,
      ruleTitles: 0,
    });
  });
});
