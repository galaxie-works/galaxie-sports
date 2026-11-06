/**
 * Rascunho inicial do Builder (só no servidor): widget novo com os padrões do tenant, ou o widget salvo
 * com o rótulo da entidade padrão resolvido na API (o banco guarda só o id em `defaults`).
 */
import {
  DEFAULT_THEMES,
  WIDGET_CATALOG,
  WIDGET_OPTIONS,
  parseLiveListOptions,
  parseStandingsOptions,
  parseWidgetOptions,
  type LookupSource,
} from '@galaxie/widgets';

import type { EditorDraft } from '@/components/client/widget-editor';
import type { TenantInfo } from '@/lib/client/tenants';
import { galaxieGet } from '@/lib/galaxie/server';
import { apiLocale, type Locale } from '@/lib/i18n/config';

import {
  entityFromDefaults,
  isWidgetKind,
  sportOf,
  isWidgetLocale,
  marketsFor,
  toWidgetLocale,
  WIDGET_KINDS,
} from './config';
import { defaultSport, sportChoices, sportForNewWidget } from './sports';
import { builderDb, listWidgetThemes } from './store';
import type { BrandThemeItem, Widget, WidgetEntityType, WidgetKind } from './types';

/** Temas da marca do tenant como vão para o navegador (por nome). */
export async function brandThemeItems(tenantId: string): Promise<BrandThemeItem[]> {
  return (await listWidgetThemes(builderDb(), tenantId)).map((x) => ({
    id: x.id,
    name: x.name,
    theme: x.theme,
    widgetCount: x.widgetCount,
  }));
}

const PATH: Record<WidgetEntityType, string> = {
  competition: '/v1/competitions',
  team: '/v1/teams',
  event: '/v1/events',
};

type Named = {
  name?: string;
  logo?: string | null;
  participants?: { name: string; short_name?: string | null }[];
};

/** Nome e escudo da entidade na API; sem resposta, fica o id (o widget continua editável). */
async function resolveEntity(
  type: WidgetEntityType,
  id: string,
  locale: Locale,
): Promise<EditorDraft['entity']> {
  try {
    const data = await galaxieGet<Named>(`${PATH[type]}/${encodeURIComponent(id)}`, {
      locale: apiLocale(locale),
    });
    const label =
      type === 'event' && data.participants?.length
        ? data.participants.map((p) => p.short_name ?? p.name).join(' × ')
        : (data.name ?? id);
    return { type, id, label, image: data.logo ?? null };
  } catch {
    return { type, id, label: id, image: null };
  }
}

/**
 * Widget novo do catálogo: o tipo (`?tipo=`) e a aba de onde veio (`?esporte=`, que dá o esporte). Com
 * `?tema=<id>` (vindo da aba Temas), já ligado àquele tema da marca; sem ele, ligado ao único tema da
 * marca do tenant, quando há um só; senão, o tema escuro pronto.
 */
export function newDraft(
  kindParam: string | undefined,
  tenant: TenantInfo,
  locale: Locale,
  brandThemes: BrandThemeItem[] = [],
  brandThemeParam?: string,
  familyParam?: string,
): EditorDraft {
  const kind: WidgetKind = isWidgetKind(kindParam) ? kindParam : WIDGET_KINDS[0];
  const sport = sportForNewWidget(kind, familyParam);
  const brand =
    brandThemes.find((x) => x.id === brandThemeParam) ??
    (brandThemes.length === 1 ? brandThemes[0] : undefined);
  return {
    name: WIDGET_CATALOG[kind].name[toWidgetLocale(locale)],
    kind,
    // esporte fora do plano: o primeiro do plano que o tipo aceita (nos de todos os esportes, todos)
    sport:
      sport && (!tenant.sports.length || tenant.sports.includes(sport))
        ? sport
        : defaultSport(kind) && sportChoices(tenant.sports, kind)[0]
          ? sportChoices(tenant.sports, kind)[0]!.sport
          : null,
    theme: brand ? { ...brand.theme } : { ...DEFAULT_THEMES.dark },
    brandThemeId: brand?.id ?? null,
    locale: toWidgetLocale(locale),
    market: marketsFor(tenant.markets)[0]!,
    entity: null,
    standings: {},
    liveList: {},
    options: {},
    optionEntities: {},
  };
}

const LOOKUP_PATH: Record<LookupSource, string> = {
  eq_competition: '/v1/equestrian/competitions',
  eq_athlete: '/v1/equestrian/athletes',
  eq_horse: '/v1/equestrian/horses',
  games: '/v1/multisport/games',
};

/** Nome da prova, do cavaleiro, do cavalo ou da edição escolhida nas opções; sem resposta, o id. */
async function lookupLabel(source: LookupSource, id: string, locale: Locale): Promise<string> {
  try {
    const data = await galaxieGet<{ name?: string }>(`${LOOKUP_PATH[source]}/${encodeURIComponent(id)}`, {
      locale: apiLocale(locale),
    });
    return data.name ?? id;
  } catch {
    return id;
  }
}

/** Nome e escudo das entidades guardadas nas opções (time a destacar, campeonato do filtro). */
async function optionEntitiesOf(
  kind: WidgetKind,
  options: Record<string, unknown>,
  locale: Locale,
): Promise<EditorDraft['optionEntities']> {
  const out: EditorDraft['optionEntities'] = {};
  for (const spec of WIDGET_OPTIONS[kind] ?? []) {
    const id = options[spec.key];
    if ((spec.type === 'team' || spec.type === 'competition') && typeof id === 'string') {
      const entity = await resolveEntity(spec.type, id, locale);
      if (entity) out[spec.key] = entity;
    }
    if (spec.type === 'lookup' && typeof id === 'string') {
      out[spec.key] = { type: 'lookup', id, label: await lookupLabel(spec.source, id, locale) };
    }
  }
  return out;
}

export async function draftOf(widget: Widget, locale: Locale): Promise<EditorDraft> {
  const entity = entityFromDefaults(widget.config.defaults);
  const options = parseWidgetOptions(widget.kind, widget.config.options) ?? {};
  return {
    name: widget.name,
    kind: widget.kind,
    // widget salvo antes do esporte (os de futebol): o padrão do tipo
    sport: sportOf(widget.kind, widget.config.defaults?.sport) ?? defaultSport(widget.kind),
    theme: widget.config.theme,
    brandThemeId: widget.config.brandThemeId ?? null,
    locale: isWidgetLocale(widget.config.locale) ? widget.config.locale : toWidgetLocale(locale),
    market: widget.config.market,
    entity: entity ? await resolveEntity(entity.type, entity.id, locale) : null,
    standings: parseStandingsOptions(widget.config.standings) ?? {},
    liveList: parseLiveListOptions(widget.config.liveList) ?? {},
    options,
    optionEntities: await optionEntitiesOf(widget.kind, options, locale),
  };
}
