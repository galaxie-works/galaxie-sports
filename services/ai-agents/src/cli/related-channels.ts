/**
 * Mapa de canais do Conteúdo relacionado (docs/12 §3.2): soma ao `enrich.related_channel` as entradas conferidas à
 * mão (`config/related-content/channels.yaml` e os `youtube.com/@handle` do dicionário de emissoras), resolvendo o
 * handle no `channels.list?forHandle=` (1 unidade cada, uma vez: fica no cache), e confere no YouTube os canais do
 * mapa (playlist de uploads, inscritos), inclusive os do Wikidata (CLI `canais:wikidata` do ingestor).
 *   pnpm --filter @galaxie/ai-agents related:canais --plan   # mostra o que faria, sem chamar nem gravar
 *   pnpm --filter @galaxie/ai-agents related:canais          # grava (balde geral do YouTube, poucas dezenas de unidades)
 */
import { parseArgs } from 'node:util';
import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { closeDb, competition, participant, relatedChannel, youtubeChannel } from '@galaxie/db';
import { loadWtwConfig } from '@galaxie/where-to-watch';
import { CHANNEL_CACHE_DAYS, ChannelBook } from '../related/channel-map.js';
import {
  ALLOWLIST_MIN_SUBSCRIBERS,
  broadcasterChannelsFrom,
  loadChannelEntries,
} from '../related/channels.js';
import { normalizeText } from '../guardrails/index.js';
import { YoutubeClient } from '../related/youtube.js';
import { dbFromEnv } from './common.js';

const { values } = parseArgs({ options: { plan: { type: 'boolean', default: false } }, strict: true });

const db = dbFromEnv();
try {
  const apiKey = process.env.YOUTUBE_API_KEY?.trim();
  if (!values.plan && !apiKey) throw new Error('YOUTUBE_API_KEY não definida no .env (veja .env.example).');
  const now = new Date();
  const yt = !values.plan && apiKey ? new YoutubeClient({ apiKey }) : null;
  const book = new ChannelBook(db, yt, { now });
  const wtw = loadWtwConfig();
  const entries = [...loadChannelEntries(), ...broadcasterChannelsFrom(wtw)].filter(
    (e) => e.kind !== 'media',
  );
  console.log(`Entradas da configuração: ${entries.length} (clubes, competições e emissoras)`);

  // 1. handle → id do canal (cache permanente; 1 unidade por handle novo)
  const fresh = new Date(now.getTime() - CHANNEL_CACHE_DAYS * 86_400_000);
  const handles = [...new Set(entries.flatMap((e) => (!e.id && e.handle ? [e.handle] : [])))];
  const cached = handles.length
    ? await db
        .select({ id: youtubeChannel.id, handle: youtubeChannel.handle })
        .from(youtubeChannel)
        .where(and(inArray(youtubeChannel.handle, handles), gte(youtubeChannel.fetchedAt, fresh)))
    : [];
  const idOf = new Map(cached.map((c) => [c.handle!, c.id]));
  const missingHandles: string[] = [];
  for (const h of handles.filter((x) => !idOf.has(x))) {
    if (!yt) {
      missingHandles.push(h);
      continue;
    }
    const ch = await yt.channelByHandle(h);
    if (!ch) {
      missingHandles.push(h);
      continue;
    }
    await book.saveDetail(ch.id, ch);
    idOf.set(h, ch.id);
  }
  console.log(
    `Handles: ${handles.length} · no cache ${cached.length} · ${yt ? 'resolvidos agora' : 'a resolver'} ` +
      `${handles.length - cached.length - (yt ? missingHandles.length : 0)}` +
      (yt && missingHandles.length ? ` · não existem: ${missingHandles.join(', ')}` : ''),
  );

  // 2. entrada → entidade (clube por nome e país, único; competição pelo slug; emissora pelo id do dicionário)
  const norm = (s: string) =>
    normalizeText(s)
      .replace(/[^\p{L}\p{N} ]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  const teams = await db
    .select({
      id: participant.id,
      name: participant.name,
      shortName: participant.shortName,
      country: participant.countryCode,
    })
    .from(participant)
    .where(eq(participant.kind, 'club'));
  const comps = await db.select({ id: competition.id, slug: competition.slug }).from(competition);
  const rows: (typeof relatedChannel.$inferInsert)[] = [];
  const unmatched: string[] = [];
  for (const e of entries) {
    const channelId = e.id ?? (e.handle ? idOf.get(e.handle) : undefined);
    if (!channelId) continue;
    const base = { channelId, source: 'config' as const, sourceRef: e.handle ?? e.id, country: e.country };
    if (e.kind === 'club') {
      const hits = teams.filter(
        (t) =>
          (!e.country || t.country === e.country) &&
          [t.name, t.shortName].some((n) => n && e.label && norm(n) === norm(e.label)),
      );
      if (hits.length === 1) rows.push({ ...base, kind: 'club', participantId: hits[0]!.id });
      else unmatched.push(`${e.label ?? e.handle} (${hits.length ? 'ambíguo' : 'sem time'})`);
    } else if (e.kind === 'competition') {
      const c = comps.find((x) => x.slug === e.label);
      if (c) rows.push({ ...base, kind: 'competition', competitionId: c.id });
      else unmatched.push(`${e.label} (sem competição)`);
    } else if (e.kind === 'broadcaster' && e.broadcaster) {
      rows.push({ ...base, kind: 'broadcaster', broadcasterId: e.broadcaster });
    }
  }
  console.log(
    `Mapa da configuração: ${rows.length} canal(is)` +
      (unmatched.length ? ` · sem par: ${unmatched.join('; ')}` : ''),
  );
  if (!values.plan && rows.length)
    await db
      .insert(relatedChannel)
      .values(rows)
      .onConflictDoUpdate({
        target: [
          relatedChannel.channelId,
          relatedChannel.kind,
          relatedChannel.participantId,
          relatedChannel.competitionId,
          relatedChannel.broadcasterId,
        ],
        set: { active: true, updatedAt: now },
      });

  // 3. confere no YouTube os canais do mapa (playlist de uploads e inscritos; 1 unidade por 50)
  const mapped = await db
    .selectDistinct({ id: relatedChannel.channelId, source: relatedChannel.source })
    .from(relatedChannel)
    .where(eq(relatedChannel.active, true));
  const details = await book.details(mapped.map((m) => m.id));
  const gone = mapped.filter((m) => !details.has(m.id));
  const small = mapped.filter((m) => {
    const s = details.get(m.id)?.subscribers;
    return m.source === 'wikidata' && s !== null && s !== undefined && s < ALLOWLIST_MIN_SUBSCRIBERS;
  });
  const counts = await db.execute<{ kind: string; source: string; n: number }>(
    sql`select kind, source, count(*)::int as n from enrich.related_channel where active group by 1, 2 order by 1, 2`,
  );
  console.table([...counts]);
  console.log(
    `Canais do mapa: ${mapped.length} · com detalhes ${details.size} · ${yt ? 'fora do ar' : 'sem cache'} ${gone.length}` +
      ` · do Wikidata abaixo de ${ALLOWLIST_MIN_SUBSCRIBERS} inscritos (ignorados): ${small.length}` +
      (yt ? ` · unidades do YouTube: ${yt.units}` : ' · prévia: nada foi chamado nem gravado'),
  );
} finally {
  await closeDb(db);
}
