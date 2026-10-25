import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  asset,
  broadcastAudit,
  broadcastRights,
  broadcastCorrection,
  broadcastOption,
  changeFeed,
  wtwRun,
  type Database,
} from '@galaxie/db';
import {
  addOption,
  applyAgentResult,
  applyMatchChannels,
  computeWtwMetrics,
  correctOption,
  currentOptions,
  getPublicWhereToWatch,
  listPendingAudits,
  loadWtwConfig,
  optionHistory,
  queueRerun,
  recordVerdict,
  removeOption,
  renderPrometheus,
  sampleForAudit,
  validateCandidates,
  WtwError,
  applyRightsResult,
  currentResearchedRights,
  listBroadcasters,
  ResearchedRightsIndex,
  rightsAnswer,
  rightsCandidates,
  syncBroadcasterLibrary,
  channelKey,
  OFFICIAL_LOGO_LICENSE,
  officialLogosByBroadcaster,
  officialLogoSourceUrl,
  type Candidate,
  type ValidatedRights,
} from '../src/index.js';
import { disposableDb, seedEvent } from './helpers.js';

const t = disposableDb();
let db: Database;
const config = loadWtwConfig({ env: { WTW_BLOCKLIST: 'Operadora Bloqueada' } });
const br = config.directory('BR');
const KICKOFF = new Date('2026-10-22T00:30:00Z');
const NOW = new Date('2026-10-21T12:00:00Z');

beforeAll(async () => {
  db = await t.setup();
}, 60_000);
afterAll(() => t.teardown());

const verified = (url: string, over: object = {}) => ({
  url,
  excerpt: 'transmissão ao vivo',
  accessible: true,
  mentionsBroadcaster: true,
  publishedAt: '2026-10-21T08:00:00Z',
  ...over,
});

function validate(candidates: Candidate[]) {
  return validateCandidates(candidates, {
    directory: br,
    competitionSlug: 'conmebol-libertadores',
    eventStartsAt: KICKOFF,
    now: NOW,
  }).options;
}

const feedCount = async (eventId: string) =>
  Number(
    (
      await db
        .select({ n: sql<string>`count(*)` })
        .from(changeFeed)
        .where(and(eq(changeFeed.entityType, 'where_to_watch'), eq(changeFeed.entityId, eventId)))
    )[0]!.n,
  );

describe('versionamento das opções do agente', () => {
  it('publica, renova sem nova versão, versiona mudança e retrai o que sumiu', async () => {
    const { eventId } = await seedEvent(db, { startsAt: KICKOFF });
    const first = validate([
      { broadcaster: 'TV Globo', evidence: [verified('https://ge.globo.com/a')] },
      { broadcaster: 'ESPN', evidence: [verified('https://www.lance.com.br/b')] },
    ]);
    const r1 = await applyAgentResult(db, {
      eventId,
      country: 'BR',
      options: first,
      retractMissing: true,
      now: NOW,
    });
    expect(r1).toMatchObject({ inserted: 2, touched: 0, retracted: 0, publicChanged: true });
    expect(await feedCount(eventId)).toBe(1);

    // mesma informação: só renova last_verified_at, sem versão nova nem change feed
    const later = new Date(NOW.getTime() + 3_600_000);
    const r2 = await applyAgentResult(db, {
      eventId,
      country: 'BR',
      options: first,
      retractMissing: true,
      now: later,
    });
    expect(r2).toMatchObject({ inserted: 0, touched: 2, publicChanged: false });
    expect(await feedCount(eventId)).toBe(1);
    const globo = (await currentOptions(db, eventId, 'BR')).find((o) => o.broadcasterId === 'globo')!;
    expect(globo.lastVerifiedAt.toISOString()).toBe(later.toISOString());

    // ESPN sumiu (vira lápide `retracted`) e a Globo ganhou link para assistir (mudança material → nova versão)
    const third = validate([
      {
        broadcaster: 'TV Globo',
        watchUrl: 'https://globoplay.globo.com/ao-vivo',
        evidence: [verified('https://ge.globo.com/a'), verified('https://www.lance.com.br/c')],
      },
    ]);
    const r3 = await applyAgentResult(db, {
      eventId,
      country: 'BR',
      options: third,
      retractMissing: true,
      now: later,
    });
    expect(r3).toMatchObject({ inserted: 1, retracted: 1, publicChanged: true });
    const current = await currentOptions(db, eventId, 'BR');
    expect(current.map((o) => [o.broadcasterId, o.status]).sort()).toEqual([
      ['espn', 'retracted'],
      ['globo', 'confirmed'],
    ]);
    const history = await optionHistory(db, eventId, 'BR');
    expect(history).toHaveLength(4);
    const oldGlobo = history.find((h) => h.id === globo.id)!;
    expect(oldGlobo.supersededBy).not.toBeNull();
    expect(oldGlobo.supersededAt).not.toBeNull();
    const newGlobo = current.find((o) => o.broadcasterId === 'globo')!;
    expect(newGlobo.firstSeenAt.toISOString()).toBe(globo.firstSeenAt.toISOString());
  });

  it('pending/omitted ficam guardadas mas não aparecem na API; sem nada confiável → unknown', async () => {
    const { eventId } = await seedEvent(db, { startsAt: KICKOFF });
    const opts = validate([
      { broadcaster: 'Canal Novo', medium: 'pay_tv', evidence: [verified('https://www.conmebol.com/x')] },
      {
        broadcaster: 'Globo',
        evidence: [
          verified('https://ge.globo.com/a'),
          verified('https://www.conmebol.com/y', { stance: 'denies' }),
        ],
      },
    ]);
    expect(opts.map((o) => o.status).sort()).toEqual(['omitted', 'pending']);
    await applyAgentResult(db, { eventId, country: 'BR', options: opts, retractMissing: true, now: NOW });
    const pub = await getPublicWhereToWatch(db, { eventId, country: 'BR' });
    expect(pub).toMatchObject({ status: 'unknown', options: [] });
    expect(
      await getPublicWhereToWatch(db, { eventId: '0192c7e2-0000-7000-8000-000000000000', country: 'BR' }),
    ).toBeNull();
  });

  it('filtra por região: nacional + a da região pedida', async () => {
    const { eventId } = await seedEvent(db, { startsAt: KICKOFF });
    const opts = validate([
      { broadcaster: 'Globo', evidence: [verified('https://ge.globo.com/a')] },
      { broadcaster: 'RBS TV', evidence: [verified('https://ge.globo.com/rs')] },
      { broadcaster: 'Disney+', evidence: [verified('https://www.disneyplus.com/x')] },
    ]);
    await applyAgentResult(db, { eventId, country: 'BR', options: opts, retractMissing: true, now: NOW });
    const all = await getPublicWhereToWatch(db, { eventId, country: 'br' });
    expect(all!.options.map((o) => [o.row.providerName, o.row.region])).toEqual([
      ['Globo', null],
      ['Globo', 'RS'],
      ['Disney+', null],
    ]);
    const sp = await getPublicWhereToWatch(db, { eventId, country: 'BR', region: 'sp' });
    expect(sp!.options.map((o) => o.row.region)).toEqual([null, null]);
    expect(all!.options[0]!.sources).toEqual([{ publisher: 'ge.globo.com', url: 'https://ge.globo.com/a' }]);
  });
});

describe('correção editorial', () => {
  it('inclui, corrige e remove com trilha de auditoria e change feed; o agente não sobrescreve', async () => {
    const { eventId } = await seedEvent(db, { startsAt: KICKOFF });
    const reportedAt = new Date(Date.now() - 120_000);
    const added = await addOption(db, {
      eventId,
      country: 'br',
      providerName: 'Paramount+',
      broadcasterId: 'paramount_plus',
      medium: 'streaming_svod',
      accessModel: 'subscription',
      evidence: [{ url: 'https://www.paramountplus.com/br/jogo', excerpt: 'Ao vivo no Paramount+' }],
      actor: 'editor.ana',
      reason: 'grade oficial publicada',
      reportedAt,
      blocklist: config.blocklist,
    });
    expect(added.option).toMatchObject({
      status: 'confirmed',
      confidence: '1.00',
      producedBy: 'editorial:editor.ana',
    });
    expect(added.changeId).toBeGreaterThan(0);

    // o agente tenta rebaixar a mesma chave: travada
    const agentOpts = validate([
      { broadcaster: 'Paramount Plus', evidence: [verified('https://blog.qualquer.net/x')] },
    ]);
    const r = await applyAgentResult(db, {
      eventId,
      country: 'BR',
      options: agentOpts,
      retractMissing: true,
      now: NOW,
    });
    expect(r.lockedByEditorial).toBe(1);

    const corrected = await correctOption(
      db,
      added.option!.id,
      { channel: 'Paramount+ Plano Premium' },
      {
        actor: 'editor.ana',
        reason: 'canal correto',
      },
    );
    expect(corrected.option).toMatchObject({ channelName: 'Paramount+ Plano Premium', status: 'confirmed' });
    await expect(
      correctOption(db, added.option!.id, { channel: 'x' }, { actor: 'editor.ana', reason: 'versão velha' }),
    ).rejects.toMatchObject({ code: 'conflict' });

    const removed = await removeOption(db, corrected.option!.id, {
      actor: 'editor.bia',
      reason: 'não vai passar',
    });
    expect(removed.option!.status).toBe('retracted');
    expect((await getPublicWhereToWatch(db, { eventId, country: 'BR' }))!.status).toBe('unknown');

    const trail = await db
      .select()
      .from(broadcastCorrection)
      .where(eq(broadcastCorrection.eventId, eventId))
      .orderBy(broadcastCorrection.createdAt);
    expect(trail.map((c) => [c.action, c.actor])).toEqual([
      ['add', 'editor.ana'],
      ['correct', 'editor.ana'],
      ['remove', 'editor.bia'],
    ]);
    expect(trail[0]!.reportedAt?.toISOString()).toBe(reportedAt.toISOString());
    expect(trail.every((c) => c.changeId! > 0)).toBe(true);
    expect(await feedCount(eventId)).toBe(3);
  });

  it('rejeita blocklist, região inválida e actor com e-mail', async () => {
    const { eventId } = await seedEvent(db, { startsAt: KICKOFF });
    const base = {
      eventId,
      country: 'BR',
      medium: 'pay_tv' as const,
      accessModel: 'subscription' as const,
      reason: 'teste',
      blocklist: config.blocklist,
    };
    await expect(
      addOption(db, { ...base, providerName: 'Operadora Bloqueada', actor: 'ed' }),
    ).rejects.toMatchObject({
      code: 'blocked',
    });
    await expect(
      addOption(db, { ...base, providerName: 'ESPN', region: 'Zona Sul', actor: 'ed' }),
    ).rejects.toBeInstanceOf(WtwError);
    await expect(
      addOption(db, { ...base, providerName: 'ESPN', actor: 'ana@exemplo.com' }),
    ).rejects.toMatchObject({
      code: 'invalid',
    });
  });

  it('enfileira reexecução manual', async () => {
    const { eventId } = await seedEvent(db, { startsAt: KICKOFF });
    const { runId } = await queueRerun(db, {
      eventId,
      country: 'br',
      actor: 'editor.ana',
      reason: 'pedido do cliente',
    });
    const [run] = await db.select().from(wtwRun).where(eq(wtwRun.id, runId));
    expect(run).toMatchObject({ status: 'queued', window: 'manual', mode: 'full', countryCode: 'BR' });
  });
});

describe('auditoria amostral e métricas', () => {
  it('sorteia de forma idempotente, inclui toda a faixa 0,70–0,75 e mede precisão', async () => {
    const { eventId } = await seedEvent(db, { startsAt: KICKOFF });
    const opts = validate([
      { broadcaster: 'Globo', evidence: [verified('https://ge.globo.com/a')] }, // 1,0
      { broadcaster: 'SBT', evidence: [verified('https://www.lance.com.br/x')] }, // 0,7 (fora da tabela? −0,2 → pending)
      { broadcaster: 'Paramount+', evidence: [verified('https://www.lance.com.br/y')] }, // 0,8
    ]);
    await applyAgentResult(db, { eventId, country: 'BR', options: opts, retractMissing: true, now: NOW });
    await db
      .update(broadcastOption)
      .set({ confidence: '0.72' })
      .where(and(eq(broadcastOption.eventId, eventId), eq(broadcastOption.broadcasterId, 'paramount_plus')));

    const s1 = await sampleForAudit(db, { date: '2026-10-21', size: 50 });
    expect(s1.lowConfidence).toBeGreaterThanOrEqual(1);
    const s2 = await sampleForAudit(db, { date: '2026-10-21', size: 50 });
    expect(s2.sampled).toBe(0); // já auditadas não voltam
    const pending = await listPendingAudits(db, 500);
    const mine = pending.filter((p) => p.eventId === eventId);
    expect(mine.map((p) => p.reason).sort()).toEqual(['daily_sample', 'low_confidence']);
    await recordVerdict(db, mine[0]!.auditId, { verdict: 'correct', reviewer: 'auditor.c' });
    await recordVerdict(db, mine[1]!.auditId, {
      verdict: 'incorrect',
      reviewer: 'auditor.c',
      note: 'era outro canal',
    });
    await expect(
      recordVerdict(db, mine[0]!.auditId, { verdict: 'correct', reviewer: 'x@y.z' }),
    ).rejects.toThrow();

    const m = await computeWtwMetrics(db, { countries: ['BR'], now: new Date() });
    expect(m.precision).toMatchObject({ correct: 1, incorrect: 1, ratio: 0.5 });
    expect(m.options.confirmed).toBeGreaterThan(0);
    const audits = await db.select().from(broadcastAudit).where(eq(broadcastAudit.eventId, eventId));
    expect(audits).toHaveLength(2);
  });

  it('cobertura até T-3h e verificação em T-3h para jogos tier 1 já iniciados', async () => {
    const kick = new Date('2026-10-20T23:00:00Z');
    const covered = await seedEvent(db, { startsAt: kick });
    const missing = await seedEvent(db, { startsAt: kick });
    const early = new Date(kick.getTime() - 5 * 3_600_000);
    const opts = validate([{ broadcaster: 'Globo', evidence: [verified('https://ge.globo.com/a')] }]);
    await applyAgentResult(db, {
      eventId: covered.eventId,
      country: 'BR',
      options: opts,
      retractMissing: true,
      now: early,
    });
    await db.insert(wtwRun).values({
      runKey: `${covered.eventId}:BR:T-3h`,
      eventId: covered.eventId,
      countryCode: 'BR',
      window: 'T-3h',
      mode: 'revalidate',
      status: 'done',
      finishedAt: new Date(kick.getTime() - 3 * 3_600_000),
    });
    // a opção do jogo "missing" só aparece depois de T-3h: não conta
    await applyAgentResult(db, {
      eventId: missing.eventId,
      country: 'BR',
      options: opts,
      retractMissing: true,
      now: new Date(kick.getTime() - 3_600_000),
    });
    const m = await computeWtwMetrics(db, {
      countries: ['BR'],
      now: new Date('2026-10-21T00:00:00Z'),
      days: 1,
    });
    expect(m.coverage).toMatchObject({ pairs: 2, coveredT3h: 1, ratio: 0.5, verifiedT3h: 1 });
    const prom = renderPrometheus(m);
    expect(prom).toMatch(/^galaxie_wtw_coverage_t3h_ratio 0\.5$/m);
    expect(prom).toMatch(/galaxie_wtw_target\{metric="precision"\} 0\.98/);
  });
});

describe('direitos pesquisados por temporada', () => {
  const result = (
    holders: string[],
    distribution: ValidatedRights['distribution'] = 'exclusive',
  ): ValidatedRights => ({
    country: 'MX',
    distribution,
    status: 'confirmed',
    confidence: 0.9,
    flags: [],
    notes: null,
    discarded: [],
    holders: holders.map((id) => ({
      broadcasterId: id,
      name: id,
      channels: [],
      kind: 'pay_tv',
      allMatches: distribution === 'exclusive',
      status: 'confirmed' as const,
      confidence: 0.9,
      evidence: [{ url: `https://${id}.example/direitos`, excerpt: 'x', fetchedAt: NOW.toISOString() }],
      flags: [],
    })),
  });

  it('versiona só quando muda (detentores/distribuição); sem mudança renova a verificação', async () => {
    const a = await applyRightsResult(db, {
      competition: 'liga-x',
      season: 2026,
      result: result(['fox']),
      now: NOW,
    });
    expect(a.action).toBe('inserted');
    const later = new Date(NOW.getTime() + 3_600_000);
    const b = await applyRightsResult(db, {
      competition: 'liga-x',
      season: 2026,
      result: result(['fox']),
      now: later,
    });
    expect(b).toEqual({ action: 'touched', id: a.id });
    const c = await applyRightsResult(db, {
      competition: 'liga-x',
      season: 2026,
      result: result(['fox', 'tv_azteca'], 'split'),
      now: later,
    });
    expect(c.action).toBe('inserted');
    const all = await db.select().from(broadcastRights).where(eq(broadcastRights.competitionSlug, 'liga-x'));
    expect(all).toHaveLength(2);
    expect(all.find((r) => r.id === a.id)!.supersededBy).toBe(c.id);

    const index = new ResearchedRightsIndex(await currentResearchedRights(db, { competitions: ['liga-x'] }));
    const entry = index.get('liga-x', 2026, 'MX')!;
    expect(entry).toMatchObject({ origin: 'research', distribution: 'split', holders: ['fox', 'tv_azteca'] });
    expect(index.get('liga-x', 2025, 'MX')).toBeNull();
  });
});

describe('biblioteca de emissoras e "canal a confirmar" na API', () => {
  it('sincroniza a biblioteca a partir do dicionário, registra o logo como asset e expõe na API', async () => {
    const r1 = await syncBroadcasterLibrary(db, config, NOW);
    expect(r1.upserted).toBeGreaterThan(30);
    expect(r1.logosRegistered).toBe(config.logos.size);
    const r2 = await syncBroadcasterLibrary(db, config, NOW);
    expect(r2.logosRegistered).toBe(0);
    const espn = (await listBroadcasters(db, { ids: ['espn'] }))[0]!;
    expect(espn.countries).toEqual(expect.arrayContaining(['BR', 'AR', 'MX']));
    expect(espn.kind).toBe('pay_tv');
    expect(espn.markets.BR!.channels).toContain('ESPN 2');
    const [logo] = await db.select().from(asset).where(eq(asset.id, espn.logoAssetId!));
    expect(logo).toMatchObject({ kind: 'broadcaster_logo', storageKey: null });
    expect((await listBroadcasters(db, { country: 'uy' })).every((b) => b.countries.includes('UY'))).toBe(
      true,
    );
  });

  it('só detentores sem o jogo garantido → `toConfirm` (a lista de opções continua vazia)', async () => {
    const { eventId } = await seedEvent(db, { startsAt: KICKOFF, slug: 'brasileirao-serie-a' });
    const rights = br.rightsFor('brasileirao-serie-a', KICKOFF);
    const answer = rightsAnswer(rights, { home: null, away: null, participants: [], round: null });
    const options = validateCandidates(rightsCandidates(answer, br), {
      directory: br,
      competitionSlug: 'brasileirao-serie-a',
      eventStartsAt: KICKOFF,
      now: NOW,
    }).options;
    expect(options.every((o) => o.status === 'probable')).toBe(true);
    await applyAgentResult(db, { eventId, country: 'BR', options, retractMissing: true, now: NOW });
    const pub = await getPublicWhereToWatch(db, { eventId, country: 'BR' });
    expect(pub).toMatchObject({ status: 'unknown', options: [] });
    expect(pub!.toConfirm.map((o) => o.row.broadcasterId)).toEqual(
      expect.arrayContaining(['globo', 'premiere']),
    );
    expect(pub!.toConfirm.find((o) => o.row.broadcasterId === 'globo')!.logo).toMatchObject({
      storageKey: null,
      sourceUrl: expect.stringMatching(/^https:\/\/upload\.wikimedia\.org\//),
    });
  });

  it('país sem nenhuma opção gravada: detentores dos direitos "a confirmar" (incertos, se só houver eles)', async () => {
    const { eventId } = await seedEvent(db, { startsAt: KICKOFF, slug: 'conmebol-libertadores' });
    // sem configuração: o comportamento antigo (nada)
    expect(await getPublicWhereToWatch(db, { eventId, country: 'AR' })).toMatchObject({
      status: 'unknown',
      toConfirm: [],
      fromRights: [],
    });
    // AR: os detentores da curadoria (ou os incertos, quando a linha só tem eles)
    const arRights = config.directory('AR').rightsFor('conmebol-libertadores', KICKOFF)!;
    const ar = await getPublicWhereToWatch(db, { eventId, country: 'AR' }, config);
    expect(ar).toMatchObject({ status: 'unknown', options: [], toConfirm: [] });
    expect(ar!.fromRights.map((o) => o.broadcasterId).sort()).toEqual(
      [...(arRights.holders.length ? arRights.holders : arRights.uncertainHolders)].sort(),
    );
    expect(ar!.fromRights[0]!.sources[0]!.url).toMatch(/^https:\/\//);
    // UY: curadoria com detentores → os detentores
    const uy = await getPublicWhereToWatch(db, { eventId, country: 'UY' }, config);
    expect(uy!.fromRights.map((o) => o.broadcasterId).sort()).toEqual(['disney_plus', 'espn']);
    // país fora da configuração: nada
    expect((await getPublicWhereToWatch(db, { eventId, country: 'DE' }, config))!.fromRights).toEqual([]);
  });

  it('acervo oficial: logo já no storage vence o da Commons, com versão escura e logo do canal', async () => {
    const official = officialLogosByBroadcaster(config.officialLogos).get('espn')!;
    const espn2 = official.channels.find((c) => c.channel === 'ESPN 2')!;
    expect(official.primary).not.toBeNull();
    const nodes = [official.primary!.light, official.primary!.dark!, espn2.light, espn2.dark!];
    await db.insert(asset).values(
      nodes.map((n, i) => ({
        kind: 'broadcaster_logo' as const,
        sourceUrl: officialLogoSourceUrl(n),
        storageKey: `broadcasters/oficial${i}.svg`,
        fetchedAt: NOW,
      })),
    );
    const r = await syncBroadcasterLibrary(db, config, NOW);
    expect(r.officialLogos).toBe(1);
    expect(r.channelLogos).toBe(1);
    const [row] = await listBroadcasters(db, { ids: ['espn'] });
    expect(row).toMatchObject({
      logoStorageKey: 'broadcasters/oficial0.svg',
      logoDarkStorageKey: 'broadcasters/oficial1.svg',
      logoSourceUrl: officialLogoSourceUrl(official.primary!.light),
      logoLicense: OFFICIAL_LOGO_LICENSE,
    });
    expect(row!.channelLogoKeys[channelKey('ESPN 2')]).toEqual({
      name: 'ESPN 2',
      storageKey: 'broadcasters/oficial2.svg',
      darkStorageKey: 'broadcasters/oficial3.svg',
    });

    // a opção no canal ESPN 2 mostra o logo do canal; sem canal, o da emissora (nunca a origem acervo-oficial://)
    const { eventId } = await seedEvent(db, { startsAt: KICKOFF });
    const base = {
      eventId,
      country: 'BR',
      broadcasterId: 'espn',
      medium: 'pay_tv' as const,
      accessModel: 'subscription' as const,
      evidence: [{ url: 'https://www.espn.com.br/jogo', excerpt: 'Ao vivo na ESPN' }],
      actor: 'editor.ana',
      reason: 'grade oficial',
      blocklist: config.blocklist,
    };
    await addOption(db, { ...base, providerName: 'ESPN', channel: 'ESPN 2' });
    await addOption(db, {
      ...base,
      providerName: 'Disney+',
      broadcasterId: 'disney_plus',
      medium: 'streaming_svod',
    });
    const pub = await getPublicWhereToWatch(db, { eventId, country: 'BR' });
    expect(pub!.options.find((o) => o.row.broadcasterId === 'espn')!.logo).toEqual({
      storageKey: 'broadcasters/oficial2.svg',
      darkStorageKey: 'broadcasters/oficial3.svg',
      sourceUrl: null,
    });
    expect(pub!.options.find((o) => o.row.broadcasterId === 'disney_plus')!.logo).toMatchObject({
      darkStorageKey: null,
      sourceUrl: expect.stringMatching(/^https:\/\//),
    });
  });
});

describe('canal do jogo × opção publicada da mesma emissora', () => {
  it('o canal do jogo corrigido vale na opção publicada; a correção editorial continua valendo', async () => {
    const { eventId } = await seedEvent(db, { startsAt: KICKOFF });
    const options = validate([
      { broadcaster: 'ESPN', channel: 'ESPN 2', evidence: [verified('https://www.espn.com.br/agenda')] },
    ]);
    expect(options.map((o) => [o.broadcasterId, o.channel, o.status])).toEqual([
      ['espn', 'ESPN 2', 'confirmed'],
    ]);
    await applyAgentResult(db, { eventId, country: 'BR', options, retractMissing: true, now: NOW });
    const source = 'https://www.espn.com.br/escala-da-rodada';
    await applyMatchChannels(db, {
      eventId,
      country: 'BR',
      accepted: [
        {
          broadcasterId: 'espn',
          providerName: 'ESPN',
          channel: 'ESPN 3',
          confidence: 0.9,
          sourceKind: 'official',
          evidence: [
            {
              url: source,
              publisher: 'espn.com.br',
              excerpt: 'Palmeiras x Fluminense na ESPN 3',
              sourceKind: 'broadcaster',
              publishedAt: null,
              pageVerified: true,
              fetchedAt: NOW.toISOString(),
            },
          ],
        },
      ],
      phase: 'pre',
      window: 'T-6h',
      researchId: null,
      now: NOW,
    });
    const pub = (await getPublicWhereToWatch(db, { eventId, country: 'BR' }, config))!;
    // uma opção só (a emissora já publicada), com o canal que a fonte do canal do jogo sustenta
    expect(pub.options.map((o) => [o.row.broadcasterId, o.row.channelName])).toEqual([['espn', 'ESPN 3']]);
    expect(pub.matchChannel.channels.map((c) => [c.option.row.channelName, c.source?.url])).toEqual([
      ['ESPN 3', source],
    ]);

    // a editoria fixou o ESPN 2: vale o dela, com a fonte dela (não a do canal do jogo)
    const { eventId: edited } = await seedEvent(db, { startsAt: KICKOFF });
    await addOption(db, {
      eventId: edited,
      country: 'BR',
      providerName: 'ESPN',
      broadcasterId: 'espn',
      channel: 'ESPN 2',
      medium: 'pay_tv',
      accessModel: 'subscription',
      evidence: [{ url: 'https://www.espn.com.br/jogo', excerpt: 'Ao vivo na ESPN 2' }],
      actor: 'editor.ana',
      reason: 'grade oficial',
      blocklist: config.blocklist,
    });
    await applyMatchChannels(db, {
      eventId: edited,
      country: 'BR',
      accepted: [
        {
          broadcasterId: 'espn',
          providerName: 'ESPN',
          channel: 'ESPN 3',
          confidence: 0.9,
          sourceKind: 'official',
          evidence: [
            {
              url: source,
              publisher: 'espn.com.br',
              excerpt: 'Palmeiras x Fluminense na ESPN 3',
              sourceKind: 'broadcaster',
              publishedAt: null,
              pageVerified: true,
              fetchedAt: NOW.toISOString(),
            },
          ],
        },
      ],
      phase: 'pre',
      window: 'T-6h',
      researchId: null,
      now: NOW,
    });
    const ed = (await getPublicWhereToWatch(db, { eventId: edited, country: 'BR' }, config))!;
    expect(ed.matchChannel.channels.map((c) => [c.option.row.channelName, c.source?.url])).toEqual([
      ['ESPN 2', 'https://www.espn.com.br/jogo'],
    ]);
  });
});
