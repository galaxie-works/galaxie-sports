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
} from '@galaxie/widgets';

import type { EditorDraft } from '@/components/client/widget-editor';
import type { TenantInfo } from '@/lib/client/tenants';
import { galaxieGet } from '@/lib/galaxie/server';
import { apiLocale, type Locale } from '@/lib/i18n/config';

import {
  entityFromDefaults,
  isWidgetKind,
  isWidgetLocale,
  marketsFor,
  toWidgetLocale,
  WIDGET_KINDS,
} from './config';
import type { Widget, WidgetEntityType, WidgetKind } from './types';

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

export function newDraft(kindParam: string | undefined, tenant: TenantInfo, locale: Locale): EditorDraft {
  const kind: WidgetKind = isWidgetKind(kindParam) ? kindParam : WIDGET_KINDS[0];
  return {
    name: WIDGET_CATALOG[kind].name[toWidgetLocale(locale)],
    kind,
    theme: { ...DEFAULT_THEMES.dark },
    locale: toWidgetLocale(locale),
    market: marketsFor(tenant.markets)[0]!,
    entity: null,
    standings: {},
    liveList: {},
    options: {},
    optionEntities: {},
  };
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
  }
  return out;
}

export async function draftOf(widget: Widget, locale: Locale): Promise<EditorDraft> {
  const entity = entityFromDefaults(widget.config.defaults);
  const options = parseWidgetOptions(widget.kind, widget.config.options) ?? {};
  return {
    name: widget.name,
    kind: widget.kind,
    theme: widget.config.theme,
    locale: isWidgetLocale(widget.config.locale) ? widget.config.locale : toWidgetLocale(locale),
    market: widget.config.market,
    entity: entity ? await resolveEntity(entity.type, entity.id, locale) : null,
    standings: parseStandingsOptions(widget.config.standings) ?? {},
    liveList: parseLiveListOptions(widget.config.liveList) ?? {},
    options,
    optionEntities: await optionEntitiesOf(widget.kind, options, locale),
  };
}
