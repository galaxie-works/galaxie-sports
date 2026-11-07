import { waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_THEMES, PUBLISHABLE_KEY_HEADER } from '../core/model.js';
import { PREVIEW_IDS, createPreviewFetch } from '../fixtures.js';
import {
  EMBED_TAG,
  defineGalaxieWidgetElement,
  parseEmbedConfig,
  resolveEmbed,
  type EmbedConfig,
} from './element.js';

const WIDGET = '01a16029-9283-77d0-b2e5-1d89336b2dbc';
const SCHEDULE = '01a16029-9283-77d0-b2e5-1d89336b2dbd';
const VIDEOS = '01a16029-9283-77d0-b2e5-1d89336b2dbe';
const SQUAD = '01a16029-9283-77d0-b2e5-1d89336b2dbf';

const config = (over: Partial<EmbedConfig> = {}): EmbedConfig => ({
  id: WIDGET,
  kind: 'match_card',
  version: 2,
  theme: DEFAULT_THEMES.sunset,
  locale: 'pt-BR',
  market: 'BR',
  defaults: { eventId: PREVIEW_IDS.liveEvent },
  apiBaseUrl: 'https://api.exemplo.test',
  ...over,
});

const preview = createPreviewFetch();
const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
  const url = String(input);
  if (url === `https://sports.exemplo.test/e/${WIDGET}.json`) return Response.json(config());
  if (url === `https://sports.exemplo.test/e/${SCHEDULE}.json`)
    return Response.json(
      config({ id: SCHEDULE, kind: 'team_schedule', defaults: { teamId: 'time-salvo-no-builder' } }),
    );
  if (url === `https://sports.exemplo.test/e/${VIDEOS}.json`)
    return Response.json(
      config({ id: VIDEOS, kind: 'related_videos', defaults: { eventId: PREVIEW_IDS.finishedEvent } }),
    );
  if (url === `https://sports.exemplo.test/e/${SQUAD}.json`)
    return Response.json({
      ...config({ id: SQUAD, kind: 'team_squad', defaults: { teamId: PREVIEW_IDS.team } }),
      options: { showCoaches: false, groupByPosition: true, season: 2025 },
    });
  if (url.includes('/e/')) return Response.json({ error: 'not_found' }, { status: 404 });
  return preview(input, init);
});

// o elemento é registrado uma vez por página (e por arquivo de teste)
defineGalaxieWidgetElement({ origin: 'https://sports.exemplo.test', fetch: fetchMock });

afterEach(() => {
  document.body.innerHTML = '';
  fetchMock.mockClear();
});

const shadowText = (el: Element) => el.shadowRoot?.textContent ?? '';

describe('<galaxie-widget>', () => {
  it('lê a configuração salva e desenha o widget no Shadow DOM, com a chave publicável', async () => {
    document.body.innerHTML = `<${EMBED_TAG} widget="${WIDGET}" key="gs_pk_live_exemplo"></${EMBED_TAG}>`;
    const el = document.querySelector(EMBED_TAG)!;
    await waitFor(() => expect(shadowText(el)).toContain('2 – 1'));
    expect(el.shadowRoot!.querySelector('.gs-root')).toBeTruthy();
    // nada vaza para o DOM da página
    expect(document.body.querySelector('.gs-root')).toBeNull();
    const api = fetchMock.mock.calls.find(([u]) =>
      String(u).startsWith('https://api.exemplo.test/v1/events/'),
    );
    expect(new Headers(api![1]?.headers).get(PUBLISHABLE_KEY_HEADER)).toBe('gs_pk_live_exemplo');
  });

  it('dois elementos do mesmo widget leem a configuração uma vez só', async () => {
    document.body.innerHTML = `<${EMBED_TAG} widget="${WIDGET}" key="k"></${EMBED_TAG}><${EMBED_TAG} widget="${WIDGET}" key="k"></${EMBED_TAG}>`;
    const [a, b] = document.querySelectorAll(EMBED_TAG);
    await waitFor(() => expect(shadowText(a!) + shadowText(b!)).toMatch(/2 – 1[\s\S]*2 – 1/));
    // a configuração ficou em cache desde o primeiro teste
    expect(fetchMock.mock.calls.filter(([u]) => String(u).includes('/e/'))).toHaveLength(0);
  });

  it('widget inexistente mostra um aviso curto no lugar', async () => {
    document.body.innerHTML = `<${EMBED_TAG} widget="nao-existe"></${EMBED_TAG}>`;
    const el = document.querySelector(EMBED_TAG)!;
    await waitFor(() => expect(shadowText(el)).toContain('widget indisponível'));
    // a falha não fica em cache: outro elemento tenta de novo
    document.body.innerHTML += `<${EMBED_TAG} widget="nao-existe"></${EMBED_TAG}>`;
    await waitFor(() =>
      expect(fetchMock.mock.calls.filter(([u]) => String(u).includes('/e/nao-existe'))).toHaveLength(2),
    );
  });

  it('os tipos novos também: agenda do time com team-id no atributo e vídeos do jogo', async () => {
    document.body.innerHTML =
      `<${EMBED_TAG} widget="${SCHEDULE}" key="k" team-id="${PREVIEW_IDS.team}"></${EMBED_TAG}>` +
      `<${EMBED_TAG} widget="${VIDEOS}" key="k"></${EMBED_TAG}>`;
    const [schedule, videos] = document.querySelectorAll(EMBED_TAG);
    await waitFor(() => expect(shadowText(schedule!)).toContain('Próximos jogos'));
    await waitFor(() => expect(shadowText(videos!)).toContain('Vídeos do jogo'));
    expect(videos!.shadowRoot!.querySelectorAll('.gs-video').length).toBeGreaterThan(0);
    const calls = fetchMock.mock.calls.map(([u]) => String(u));
    expect(calls.some((u) => u.includes(`/v1/teams/${PREVIEW_IDS.team}/events`))).toBe(true);
    expect(calls.some((u) => u.includes('time-salvo-no-builder'))).toBe(false);
  });

  it('elenco do time (#825): time salvo e opções do Builder', async () => {
    document.body.innerHTML = `<${EMBED_TAG} widget="${SQUAD}" key="k"></${EMBED_TAG}>`;
    const el = document.querySelector(EMBED_TAG)!;
    await waitFor(() => expect(shadowText(el)).toContain('Goleiros'));
    expect(shadowText(el)).toContain('Rafael Moura');
    expect(shadowText(el)).not.toContain('Técnicos');
    const calls = fetchMock.mock.calls.map(([u]) => String(u));
    expect(
      calls.some((u) => u.includes(`/v1/teams/${PREVIEW_IDS.team}/squad?`) && u.includes('season=2025')),
    ).toBe(true);
  });

  it('carregar o script de novo não registra o elemento duas vezes', () => {
    expect(() => defineGalaxieWidgetElement()).not.toThrow();
  });
});

describe('resolveEmbed', () => {
  it('atributos trocam idioma, mercado e entidade; valores inválidos ficam com o salvo', () => {
    expect(resolveEmbed(config({ defaults: { teamId: 'salvo' } }), { teamId: 'outro-time' })).toMatchObject({
      teamId: 'outro-time',
    });
    expect(resolveEmbed(config({ defaults: { teamId: 'salvo' } }))).toMatchObject({ teamId: 'salvo' });
    expect(resolveEmbed(config(), { locale: 'es', market: 'ar', eventId: 'outro' })).toMatchObject({
      locale: 'es',
      market: 'AR',
      eventId: 'outro',
    });
    expect(resolveEmbed(config(), { locale: 'fr', market: 'ARG' })).toMatchObject({
      locale: 'pt-BR',
      market: 'BR',
      eventId: PREVIEW_IDS.liveEvent,
    });
  });
});

describe('parseEmbedConfig', () => {
  it('recusa o que não tem o formato da rota /e/<id>.json', () => {
    expect(parseEmbedConfig(config())).toMatchObject({ kind: 'match_card' });
    expect(parseEmbedConfig({ ...config(), kind: 'outro' })).toBeNull();
    expect(parseEmbedConfig({ ...config(), locale: 'fr' })).toBeNull();
    expect(parseEmbedConfig(null)).toBeNull();
    expect(parseEmbedConfig({ ...config(), defaults: undefined })?.defaults).toEqual({});
  });

  it('opções de conteúdo: só as do tipo, válidas', () => {
    const parsed = parseEmbedConfig({
      ...config(),
      options: { showGoals: true, showVenue: true, showReferee: 'x', limit: 3 },
    });
    expect(parsed?.options).toEqual({ showGoals: true });
  });

  it('opções da tabela: só faixas conhecidas com #rrggbb', () => {
    const parsed = parseEmbedConfig({
      ...config(),
      kind: 'standings',
      standings: {
        showLegend: false,
        zoneColors: { relegation: '#AA0000', direct: 'red;}', outra: '#000000' },
      },
    });
    expect(parsed?.standings).toEqual({ showLegend: false, zoneColors: { relegation: '#aa0000' } });
  });

  it('lê as opções da lista de jogos e descarta o que não conhece', () => {
    const parsed = parseEmbedConfig({
      ...config(),
      kind: 'live_list',
      liveList: { liveOnly: true, showVenue: true, showCity: 'sim', limit: 5000, outra: true },
    });
    // liveOnly antigo vira o modo ao vivo
    expect(parsed?.liveList).toEqual({ mode: 'live', showVenue: true });
  });
});
