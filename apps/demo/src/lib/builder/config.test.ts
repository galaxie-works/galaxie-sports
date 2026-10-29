import { normalizeAllowedOrigin } from '@galaxie/db';
import { DEFAULT_THEMES, WIDGET_CATALOG } from '@galaxie/widgets';
import { buildRegistryItem } from '@galaxie/widgets/registry';
import { describe, expect, it } from 'vitest';

import {
  ENTITY_TYPES,
  REGISTRY_COMPONENTS,
  REQUIRED_ENTITY,
  WIDGET_KINDS,
  embedSnippet,
  installCommand,
  parseOrigins,
  parseRegistryParam,
  parseTheme,
  parseWidgetInput,
  usageSnippet,
} from './config';

const ID = '01a16029-9283-77d0-b2e5-1d89336b2dbc';
const opts = { markets: ['BR', 'AR'], entityTypes: (k: keyof typeof ENTITY_TYPES) => ENTITY_TYPES[k] };
const base = {
  kind: 'match_card',
  name: '  Placar   da home ',
  config: { theme: DEFAULT_THEMES.dark, locale: 'pt-BR', market: 'br', defaults: { eventId: ID } },
};

describe('tema do widget', () => {
  it('aceita os temas prontos do pacote', () => {
    for (const theme of Object.values(DEFAULT_THEMES)) expect(parseTheme(theme)).toEqual(theme);
  });

  it('recusa cor fora de #rrggbb, raio fora da faixa e fonte que fecha a declaração CSS', () => {
    expect(parseTheme({ ...DEFAULT_THEMES.dark, primary: 'red' })).toBeNull();
    expect(parseTheme({ ...DEFAULT_THEMES.dark, radius: 99 })).toBeNull();
    expect(parseTheme({ ...DEFAULT_THEMES.dark, fontFamily: 'Inter; } body { display: none' })).toBeNull();
    expect(parseTheme({ ...DEFAULT_THEMES.dark, mode: 'sepia' })).toBeNull();
  });
});

describe('widget salvo', () => {
  it('normaliza nome e mercado e guarda a entidade em defaults', () => {
    const r = parseWidgetInput(base, opts);
    expect(r.ok && r.value).toEqual({
      kind: 'match_card',
      name: 'Placar da home',
      config: { theme: DEFAULT_THEMES.dark, locale: 'pt-BR', market: 'BR', defaults: { eventId: ID } },
    });
  });

  it('recusa o nome que normaliza para o núcleo comum do registry', () => {
    for (const name of ['Galaxie Core', 'galaxie-core', '  GALÁXIE · core! '])
      expect(parseWidgetInput({ ...base, name }, opts)).toEqual({ ok: false, error: 'name' });
    expect(parseWidgetInput({ ...base, name: 'Galaxie Core 2' }, opts).ok).toBe(true);
  });

  it('mercado precisa estar no plano (plano sem mercados aceita qualquer país)', () => {
    const mx = { ...base, config: { ...base.config, market: 'MX' } };
    expect(parseWidgetInput(mx, opts)).toEqual({ ok: false, error: 'market' });
    expect(parseWidgetInput(mx, { ...opts, markets: [] }).ok).toBe(true);
  });

  it('entidade só do tipo que o widget aceita, e uma só', () => {
    const team = { ...base, config: { ...base.config, defaults: { teamId: ID } } };
    expect(parseWidgetInput(team, opts)).toEqual({ ok: false, error: 'entity' });
    const two = { ...base, config: { ...base.config, defaults: { eventId: ID, competitionId: ID } } };
    expect(parseWidgetInput(two, opts)).toEqual({ ok: false, error: 'entity' });
    const standings = {
      ...base,
      kind: 'standings',
      config: { ...base.config, defaults: { competitionId: 'libertadores' } },
    };
    expect(parseWidgetInput(standings, opts).ok).toBe(true);
  });

  it('placar, tabela e onde assistir exigem a entidade padrão; a lista ao vivo, não', () => {
    const none = { ...base.config, defaults: {} };
    for (const kind of ['match_card', 'standings', 'where_to_watch'])
      expect(parseWidgetInput({ ...base, kind, config: none }, opts)).toEqual({
        ok: false,
        error: 'entityRequired',
      });
    const live = parseWidgetInput({ ...base, kind: 'live_list', config: none }, opts);
    expect(live.ok && live.value.config.defaults).toEqual({});
  });

  it('recusa tipo, nome e idioma desconhecidos', () => {
    expect(parseWidgetInput({ ...base, kind: 'banner' }, opts)).toEqual({ ok: false, error: 'kind' });
    expect(parseWidgetInput({ ...base, name: ' ' }, opts)).toEqual({ ok: false, error: 'name' });
    const es = { ...base, config: { ...base.config, locale: 'es-AR' } };
    expect(parseWidgetInput(es, opts)).toEqual({ ok: false, error: 'locale' });
  });
});

describe('domínios da chave publicável', () => {
  it('normaliza com a regra da API e separa o que não vale', () => {
    const r = parseOrigins(
      'app.exemplo.com\n*.exemplo.com, http://localhost:3000 https://app.exemplo.com/ ftp://x.com https://x.com/p',
      normalizeAllowedOrigin,
    );
    expect(r.origins).toEqual(['https://app.exemplo.com', 'https://*.exemplo.com', 'http://localhost:3000']);
    expect(r.invalid).toEqual(['ftp://x.com', 'https://x.com/p']);
  });
});

describe('catálogo de @galaxie/widgets', () => {
  it('as entidades de cada tipo batem com as props dos componentes', () => {
    const PROP = { event: 'eventId', competition: 'competitionId', team: 'teamId' } as const;
    for (const kind of WIDGET_KINDS) {
      const props: readonly string[] = [
        ...WIDGET_CATALOG[kind].requiredProps,
        ...WIDGET_CATALOG[kind].optionalProps,
      ];
      for (const type of ENTITY_TYPES[kind]) expect(props).toContain(PROP[type]);
    }
  });

  it('a entidade obrigatória de cada tipo é a prop obrigatória do componente', () => {
    const PROP = { event: 'eventId', competition: 'competitionId', team: 'teamId' } as const;
    for (const kind of WIDGET_KINDS) {
      const required = REQUIRED_ENTITY[kind];
      const entityProps = WIDGET_CATALOG[kind].requiredProps.filter((p) =>
        (Object.values(PROP) as string[]).includes(p),
      );
      expect(entityProps).toEqual(required ? [PROP[required]] : []);
      if (required) expect(ENTITY_TYPES[kind]).toContain(required);
    }
  });

  it('o snippet de uso aponta para o arquivo e o componente que o registry instala', () => {
    for (const kind of WIDGET_KINDS) {
      expect(REGISTRY_COMPONENTS[kind]).toBe(WIDGET_CATALOG[kind].registryComponent);
      const item = buildRegistryItem({
        kind,
        name: 'Operadora Exemplo · Placar!',
        theme: DEFAULT_THEMES.light,
        apiBaseUrl: 'https://api.sports.galaxie.works',
      });
      const files = item.files.map((f) => f.target.replace(/\.tsx$/, ''));
      const snippet = usageSnippet({ kind, name: 'Operadora Exemplo · Placar!' });
      const path = /from '@\/(.+)'/.exec(snippet)?.[1];
      expect(files).toContain(path);
      expect(snippet).toContain(`<${REGISTRY_COMPONENTS[kind]} />`);
    }
  });
});

describe('instalação', () => {
  it('comando do shadcn com a URL do registry', () => {
    expect(installCommand(ID, 'https://sports.galaxie.works')).toBe(
      `npx shadcn@latest add https://sports.galaxie.works/r/${ID}.json`,
    );
  });

  it('embed HTML: o script uma vez e o elemento com o id do widget', () => {
    expect(embedSnippet(ID, 'https://sports.galaxie.works')).toBe(
      `<script src="https://sports.galaxie.works/embed.js" async></script>\n` +
        `<galaxie-widget widget="${ID}" key="gs_pk_live_…"></galaxie-widget>`,
    );
  });

  it('o segmento da rota só aceita <uuid>.json', () => {
    expect(parseRegistryParam(`${ID.toUpperCase()}.json`)).toBe(ID);
    expect(parseRegistryParam(ID)).toBeNull();
    expect(parseRegistryParam(`${ID}.json.bak`)).toBeNull();
    expect(parseRegistryParam('../etc.json')).toBeNull();
  });
});
