import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  competition,
  competitionProfile,
  copyTemplate,
  country,
  derby,
  derbyTeam,
  event,
  eventParticipant,
  loadRun,
  participant,
  providerMap,
  sport,
  teamProfile,
  venue,
  type Database,
} from '@galaxie/db';
import { assignEventDerbies, findDerby } from '../src/derby.js';
import { loadKnowledge, type KnowledgeBase } from '../src/load.js';
import { seedSemantic } from '../src/seed.js';
import { createTestDb } from './helpers.js';

let db: Database;
let drop: () => Promise<void>;
let kb: KnowledgeBase;

beforeAll(async () => {
  ({ db, drop } = await createTestDb());
  kb = await loadKnowledge();
}, 60_000);

afterAll(async () => {
  if (drop) await drop();
});

async function addClub(name: string, apiId: number) {
  const [p] = await db
    .insert(participant)
    .values({ sport: 'football', kind: 'club', name, countryCode: 'BR' })
    .returning();
  await db.insert(providerMap).values({
    entityType: 'participant',
    entityId: p!.id,
    provider: 'api-sports',
    sport: 'football',
    providerId: String(apiId),
  });
  return p!.id;
}

async function addMatch(homeId: string, awayId: string) {
  const startsAt = new Date('2026-10-25T19:00:00Z');
  const [ev] = await db
    .insert(event)
    .values({ sport: 'football', startsAt, endsAtExpected: new Date(startsAt.getTime() + 115 * 60_000) })
    .returning();
  await db.insert(eventParticipant).values([
    { eventId: ev!.id, participantId: homeId, side: 'home' },
    { eventId: ev!.id, participantId: awayId, side: 'away' },
  ]);
  return ev!.id;
}

const derbyOf = async (eventId: string) =>
  (await db.select({ derbyId: event.derbyId }).from(event).where(eq(event.id, eventId)))[0]?.derbyId ?? null;

describe('seedSemantic', () => {
  it('carrega toda a base de data/knowledge', async () => {
    const result = await seedSemantic(db, kb, { gitSha: 'abc123' });
    expect(result.teams).toMatchObject({ total: 218, inserted: 218, updated: 0, removed: 0 });
    expect(result.derbies).toMatchObject({ total: 93, inserted: 93 });
    expect(result.competitions).toMatchObject({ total: 58, inserted: 58 });
    expect(result.copyTemplates.inserted).toBeGreaterThanOrEqual(8 * 24);

    const [palmeiras] = await db.select().from(teamProfile).where(eq(teamProfile.slug, 'palmeiras'));
    expect(palmeiras).toMatchObject({
      kind: 'club',
      countryCode: 'BR',
      apiSportsTeamId: 121,
      founded: '1914-08-26',
      reviewStatus: 'approved',
      sourceFile: 'data/knowledge/football/teams/br.yaml',
    });
    expect(palmeiras!.rivals).toContainEqual({ team: 'sao-paulo', derby: 'choque-rei', intensity: 4 });
    // textos livres por idioma (docs/06 §3.3): original em pt-BR, traduções de i18n/<locale>.yaml
    expect(palmeiras!.textLocale).toBe('pt-BR');
    expect(palmeiras!.texts['es']).toMatchObject({ mascot: 'Porco (cerdo)', review_status: 'approved' });
    expect(palmeiras!.texts['es-AR']!.identity![1]).toContain('hinchada');
    expect(palmeiras!.texts['es-AR']).not.toHaveProperty('note'); // observação editorial fica só no YAML
    const [boca] = await db.select().from(teamProfile).where(eq(teamProfile.slug, 'boca-juniors'));
    expect(boca).toMatchObject({ textLocale: 'es-AR', texts: { 'pt-BR': { colors: ['azul', 'ouro'] } } });
    // arquivo com vários países: cada clássico na voz do seu
    const [uruguayo] = await db.select().from(derby).where(eq(derby.slug, 'clasico-uruguayo'));
    expect(uruguayo!.textLocale).toBe('es-UY');
    const [brazil] = await db.select().from(teamProfile).where(eq(teamProfile.slug, 'brazil-nt'));
    expect(brazil).toMatchObject({ kind: 'national_team', countryCode: 'BR', worldCupTitles: 5 });
    // outros esportes (issue #44): tipo do arquivo de participantes, ainda sem vínculo com o core
    const [checo] = await db.select().from(teamProfile).where(eq(teamProfile.slug, 'f1-sergio-perez'));
    expect(checo).toMatchObject({
      kind: 'driver',
      countryCode: 'MX',
      participantId: null,
      sourceFile: 'data/knowledge/formula-1/participants/drivers.yaml',
    });
    expect(checo!.nicknames).toContain('Checo');
    const [lakersCeltics] = await db.select().from(derby).where(eq(derby.slug, 'basketball-lakers-celtics'));
    expect(lakersCeltics).toMatchObject({ intensity: 5, scope: 'national' });

    const [choque] = await db.select().from(derby).where(eq(derby.slug, 'choque-rei'));
    const pair = await db.select().from(derbyTeam).where(eq(derbyTeam.derbyId, choque!.id));
    expect(pair.map((p) => p.teamSlug).sort()).toEqual(['palmeiras', 'sao-paulo']);

    const [run] = await db.select().from(loadRun);
    expect(run).toMatchObject({ gitSha: 'abc123', teams: 218, derbies: 93, competitions: 58 });
    const copies = await db.select().from(copyTemplate).where(eq(copyTemplate.key, 'pt-BR.rivalry-3'));
    expect(copies[0]).toMatchObject({
      locale: 'pt-BR',
      copyIntent: 'rivalry',
      affinityType: 'rival',
      reviewStatus: 'draft',
    });
  });

  it('é idempotente: a segunda carga não reescreve nada', async () => {
    const before = await db
      .select({ slug: teamProfile.slug, updatedAt: teamProfile.updatedAt })
      .from(teamProfile);
    const result = await seedSemantic(db, kb, { gitSha: 'abc123' });
    for (const s of [result.teams, result.derbies, result.competitions, result.copyTemplates])
      expect(s).toMatchObject({ inserted: 0, updated: 0, removed: 0 });
    expect(result.teams.unchanged).toBe(218);
    const after = await db
      .select({ slug: teamProfile.slug, updatedAt: teamProfile.updatedAt })
      .from(teamProfile);
    expect(after).toEqual(expect.arrayContaining(before));
    expect(await db.select().from(loadRun)).toHaveLength(2);
  });

  it('liga perfis a participantes e marca Palmeiras × São Paulo como Choque-Rei', async () => {
    await db.insert(sport).values({ slug: 'football', name: { 'pt-BR': 'Futebol' } });
    await db.insert(country).values({ code: 'BR', name: { 'pt-BR': 'Brasil', en: 'Brazil' } });
    const palmeiras = await addClub('Palmeiras', 121);
    const saoPaulo = await addClub('Sao Paulo', 126);
    const corinthians = await addClub('Corinthians', 131);
    const bahia = await addClub('Bahia', 118);

    // eventos já existentes antes do seed (o normalizador de outro agente grava core.event)
    const choqueRei = await addMatch(saoPaulo, palmeiras);
    const derbyPaulista = await addMatch(palmeiras, corinthians);
    const notDerby = await addMatch(palmeiras, bahia);

    const result = await seedSemantic(db, kb);
    expect(result.linked.teams).toBe(4);
    expect(result.events.updated).toBe(2);

    const [choque] = await db.select().from(derby).where(eq(derby.slug, 'choque-rei'));
    expect(await derbyOf(choqueRei)).toBe(choque!.id);
    const [paulista] = await db.select().from(derby).where(eq(derby.slug, 'derby-paulista'));
    expect(await derbyOf(derbyPaulista)).toBe(paulista!.id);
    expect(await derbyOf(notDerby)).toBeNull();

    // findDerby em qualquer ordem
    expect(await findDerby(db, palmeiras, saoPaulo)).toMatchObject({
      slug: 'choque-rei',
      name: 'Choque-Rei',
      intensity: 4,
    });
    expect(await findDerby(db, saoPaulo, palmeiras)).toMatchObject({ slug: 'choque-rei' });
    expect(await findDerby(db, palmeiras, bahia)).toBeNull();
    expect(await findDerby(db, palmeiras, palmeiras)).toBeNull();
  });

  it('recalcula só os eventos pedidos (gancho do upsert de eventos)', async () => {
    const [p] = await db
      .select({ id: teamProfile.participantId })
      .from(teamProfile)
      .where(eq(teamProfile.slug, 'palmeiras'));
    const [s] = await db
      .select({ id: teamProfile.participantId })
      .from(teamProfile)
      .where(eq(teamProfile.slug, 'sao-paulo'));
    const fresh = await addMatch(p!.id!, s!.id!);
    expect(await derbyOf(fresh)).toBeNull();
    const out = await assignEventDerbies(db, { eventIds: [fresh] });
    expect(out.updated).toBe(1);
    expect(await derbyOf(fresh)).not.toBeNull();
    expect((await assignEventDerbies(db, { eventIds: [fresh] })).updated).toBe(0);
    expect((await assignEventDerbies(db, { eventIds: [] })).updated).toBe(0);
  });

  it('liga competições pelo ID da liga ou pelo slug do catálogo', async () => {
    const [serieA] = await db
      .insert(competition)
      .values({
        sport: 'football',
        slug: 'brazil-serie-a-71',
        name: 'Serie A',
        type: 'league',
        countryCode: 'BR',
      })
      .returning();
    await db.insert(providerMap).values({
      entityType: 'competition',
      entityId: serieA!.id,
      provider: 'api-sports',
      sport: 'football',
      providerId: '71',
    });
    const [paulistao] = await db
      .insert(competition)
      .values({
        sport: 'football',
        slug: 'paulistao',
        name: 'Paulista A1',
        type: 'league',
        countryCode: 'BR',
      })
      .returning();
    const result = await seedSemantic(db, kb);
    expect(result.linked.competitions).toBeGreaterThanOrEqual(1);
    const rows = await db.select().from(competitionProfile);
    expect(rows.find((r) => r.slug === 'brasileirao-serie-a')?.competitionId).toBe(serieA!.id);
    const paulistaoProfile = rows.find((r) => r.slug === 'paulistao');
    if (paulistaoProfile) expect(paulistaoProfile.competitionId).toBe(paulistao!.id);
  });

  it('liga estádios curados a core.venue: ID do fornecedor, estádio-sede e jogos como mandante', async () => {
    const addVenue = async (name: string, city: string, apiId?: number) => {
      const [v] = await db.insert(venue).values({ name, city }).returning();
      if (apiId)
        await db.insert(providerMap).values({
          entityType: 'venue',
          entityId: v!.id,
          provider: 'api-sports',
          sport: 'football',
          providerId: String(apiId),
        });
      return v!.id;
    };
    const profileOf = async (slug: string) =>
      (
        await db.select({ id: teamProfile.participantId }).from(teamProfile).where(eq(teamProfile.slug, slug))
      )[0]!.id!;
    // Palmeiras: ID 258 no YAML; o fornecedor ainda diz "Allianz Parque"
    const allianz = await addVenue('Allianz Parque', 'São Paulo, São Paulo', 258);
    // São Paulo: estádio-sede com o nome antigo entre parênteses
    const morumbi = await addVenue('Estádio Cícero Pompeu de Toledo (Morumbi)', 'São Paulo, São Paulo', 269);
    await db
      .update(participant)
      .set({ homeVenueId: morumbi })
      .where(eq(participant.id, await profileOf('sao-paulo')));
    // Corinthians: só aparece como estádio de um jogo em casa ("Arena Corinthians" é apelido no YAML)
    const arena = await addVenue('Arena Corinthians', 'São Paulo, São Paulo', 229);
    const home = await addMatch(await profileOf('corinthians'), await profileOf('bahia'));
    await db.update(event).set({ venueId: arena }).where(eq(event.id, home));
    // mesmo nome de patrocinador em outro lugar: não liga
    const munich = await addVenue('Allianz Arena', 'München', 700);

    const result = await seedSemantic(db, kb);
    expect(result.venues.conflicts).toEqual([]);
    const curated = new Map(
      (await db.select({ id: venue.id, curated: venue.curated, name: venue.name }).from(venue)).map((v) => [
        v.id,
        v,
      ]),
    );
    expect(curated.get(allianz)).toMatchObject({
      name: 'Allianz Parque',
      curated: {
        name: 'Nubank Parque',
        city: 'São Paulo',
        former_names: [{ name: 'Allianz Parque', until: '2026-05-03' }],
        team_slugs: ['palmeiras'],
        matched_by: 'provider_id',
      },
    });
    expect(curated.get(morumbi)?.curated).toMatchObject({ name: 'MorumBIS', matched_by: 'name' });
    expect(curated.get(arena)?.curated).toMatchObject({
      name: 'Neo Química Arena',
      team_slugs: ['corinthians'],
    });
    expect(curated.get(munich)?.curated).toBeNull();

    // idempotente
    expect((await seedSemantic(db, kb)).venues.changed).toBe(0);
  });

  it('remove o que saiu do YAML e limpa o derby_id dos eventos', async () => {
    const choqueEvent = (await db.select({ id: event.id, derbyId: event.derbyId }).from(event)).find(
      (e) => e.derbyId !== null,
    );
    expect(choqueEvent).toBeDefined();
    const trimmed: KnowledgeBase = {
      ...kb,
      derbies: kb.derbies.filter((d) => !d.entry.teams.includes('sao-paulo')),
      teams: kb.teams.filter((t) => t.entry.slug !== 'sao-paulo'),
      copyTemplates: kb.copyTemplates.filter((c) => c.locale !== 'es-EC'),
    };
    const removedDerbies = kb.derbies.length - trimmed.derbies.length;
    const result = await seedSemantic(db, trimmed);
    expect(result.teams.removed).toBe(1);
    expect(result.derbies.removed).toBe(removedDerbies);
    expect(result.copyTemplates.removed).toBe(kb.copyTemplates.length - trimmed.copyTemplates.length);
    expect(await db.select().from(teamProfile).where(eq(teamProfile.slug, 'sao-paulo'))).toHaveLength(0);
    expect(await db.select().from(derby).where(eq(derby.slug, 'choque-rei'))).toHaveLength(0);
    // o estádio do perfil removido perde a curadoria (volta a valer o nome do fornecedor)
    expect(result.venues.changed).toBe(1);
    // eventos Palmeiras × São Paulo perdem o clássico; Derby Paulista continua
    const events = await db.select({ id: event.id, derbyId: event.derbyId }).from(event);
    const [paulista] = await db.select().from(derby).where(eq(derby.slug, 'derby-paulista'));
    expect(events.filter((e) => e.derbyId === paulista!.id)).toHaveLength(1);
    expect(events.filter((e) => e.derbyId !== null)).toHaveLength(1);

    // volta ao estado completo
    const back = await seedSemantic(db, kb);
    expect(back.teams.inserted).toBe(1);
    expect(back.derbies.inserted).toBe(removedDerbies);
  });
});
