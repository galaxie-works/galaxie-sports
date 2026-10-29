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

  it('carregar o script de novo não registra o elemento duas vezes', () => {
    expect(() => defineGalaxieWidgetElement()).not.toThrow();
  });
});

describe('resolveEmbed', () => {
  it('atributos trocam idioma, mercado e entidade; valores inválidos ficam com o salvo', () => {
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
});
