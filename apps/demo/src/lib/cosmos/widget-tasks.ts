/**
 * Widget por frase e passos de instalação da Cosmos (#1005), no servidor: monta o prompt, chama a função pela carteira
 * (`runCosmosTask`), busca as entidades em `/v1/search` e valida cada widget com `parseWidgetInput`, a mesma regra de
 * salvar. Nada é salvo aqui: o editor abre preenchido e só o cliente salva.
 */
import type { SearchResponse } from '@galaxie/contracts';
import {
  activeFunctionMinCredits,
  parseModelJson,
  readCosmosSettings,
  runCosmosTask,
  type TaskErrorCode,
} from '@galaxie/cosmos';
import { DEFAULT_THEMES, WIDGET_CATALOG } from '@galaxie/widgets';

import {
  ENTITY_TYPES,
  marketsFor,
  parseWidgetInput,
  toWidgetLocale,
  type WidgetInput,
} from '@/lib/builder/config';
import { brandThemeItems } from '@/lib/builder/editor';
import { searchSport } from '@/lib/builder/sports';
import { builderDb } from '@/lib/builder/store';
import type { WidgetEntityType } from '@/lib/builder/types';
import { can } from '@/lib/client/permissions';
import type { ClientContext } from '@/lib/client/session';
import { galaxieGet } from '@/lib/galaxie/server';
import { apiLocale, type Locale } from '@/lib/i18n/config';

import {
  COMPOSE_FUNCTION,
  COMPOSE_MAX_WIDGETS,
  composeKinds,
  composeMaxOutputTokens,
  composePrompt,
  encodeDraftParam,
  parseComposeAnswer,
  specToRawInput,
  type ComposeMode,
  type ComposeSpec,
} from './widget-compose';
import {
  INSTALL_FUNCTION,
  INSTALL_MAX_OUTPUT_TOKENS,
  installPrompt,
  parseInstallAnswer,
  type InstallGuide,
  type InstallTarget,
} from './widget-install';

export type WidgetTaskError = TaskErrorCode | 'unauthorized' | 'module' | 'role';

/**
 * Quem pode pedir: quem edita o Builder (`settings.manage`) num tenant com a Cosmos contratada. A equipe Galaxie
 * acompanha qualquer tenant sem gastar os créditos dele.
 */
export function widgetTaskAccess(
  ctx: Pick<ClientContext, 'role' | 'tenant' | 'actor'>,
): 'unauthorized' | 'module' | 'role' | null {
  if (!ctx.tenant) return 'unauthorized';
  if (ctx.role === 'admin') return null;
  if (!ctx.tenant.modules.includes('cosmos_ai')) return 'module';
  if (!can(ctx, 'settings.manage')) return 'role';
  return null;
}

/** Mínimo de cada função para o aviso de custo da tela; null = função fora do catálogo (a tela some). */
export async function widgetTaskMinimums(): Promise<{ compose: number | null; install: number | null }> {
  const db = builderDb();
  const [compose, install] = await Promise.all([
    activeFunctionMinCredits(db, COMPOSE_FUNCTION),
    activeFunctionMinCredits(db, INSTALL_FUNCTION),
  ]);
  return { compose, install };
}

export interface ComposedWidget {
  input: WidgetInput;
  /** Nome da entidade achada (ou null, sem entidade). */
  entityLabel: string | null;
  why: string | null;
  /** `?cosmos=` do editor. */
  draft: string;
}

export interface ComposeRejected {
  kind: string;
  why: string | null;
  /** O que faltou: a entidade não foi achada, ou a validação recusou. */
  reason: 'entity' | 'invalid';
}

/** Primeiro resultado da busca no tipo pedido (o melhor casamento vem primeiro). */
async function findEntity(
  type: WidgetEntityType,
  query: string,
  sport: string | null,
  locale: Locale,
): Promise<{ id: string; name: string } | null> {
  try {
    const res = await galaxieGet<SearchResponse>('/v1/search', {
      q: query,
      types: type,
      limit: 1,
      locale: apiLocale(locale),
      ...(sport ? { sport } : {}),
    });
    const hit = res.data.find((r) => r.type === type);
    return hit ? { id: hit.id, name: hit.name } : null;
  } catch {
    return null;
  }
}

export async function composeWidgets(
  ctx: ClientContext,
  input: { text: string; mode: ComposeMode },
  locale: Locale,
): Promise<
  { ok: true; widgets: ComposedWidget[]; rejected: ComposeRejected[] } | { ok: false; error: WidgetTaskError }
> {
  const denied = widgetTaskAccess(ctx);
  if (denied) return { ok: false, error: denied };
  const tenant = ctx.tenant!;
  const db = builderDb();
  const markets = marketsFor(tenant.markets);
  const brandThemes = await brandThemeItems(tenant.id);
  const screenLocale = toWidgetLocale(locale);
  const prompt = composePrompt({
    text: input.text,
    mode: input.mode,
    kinds: composeKinds(tenant.sports),
    tenantSports: tenant.sports,
    markets,
    brandThemes: brandThemes.map((b) => b.name),
    screenLocale,
  });
  const max = input.mode === 'page' ? COMPOSE_MAX_WIDGETS : 1;

  const evaluate = async (text: string) => {
    const specs = parseComposeAnswer(parseModelJson(text), max);
    const widgets: ComposedWidget[] = [];
    const rejected: ComposeRejected[] = [];
    for (const spec of specs) {
      const one = await toWidget(spec);
      if ('reason' in one) rejected.push(one);
      else widgets.push(one);
    }
    return { usable: widgets.length > 0, value: { widgets, rejected } };
  };

  const toWidget = async (spec: ComposeSpec): Promise<ComposedWidget | ComposeRejected> => {
    const found = spec.entity
      ? await findEntity(spec.entity.type, spec.entity.query, searchSport(spec.kind, spec.sport), locale)
      : null;
    const raw = specToRawInput(spec, {
      entity: found && spec.entity ? { type: spec.entity.type, id: found.id } : null,
      brandThemes,
      presets: DEFAULT_THEMES,
      fallbackName: WIDGET_CATALOG[spec.kind].name[spec.locale ?? screenLocale],
      defaultLocale: screenLocale,
      markets,
      tenantSports: tenant.sports,
    });
    const parsed = parseWidgetInput(raw, {
      markets: tenant.markets,
      entityTypes: (kind) => ENTITY_TYPES[kind],
      sports: tenant.sports,
    });
    if (!parsed.ok)
      return {
        kind: spec.kind,
        why: spec.why,
        reason: parsed.error === 'entityRequired' || (spec.entity && !found) ? 'entity' : 'invalid',
      };
    return {
      input: parsed.value,
      entityLabel: found?.name ?? null,
      why: spec.why,
      draft: encodeDraftParam(parsed.value),
    };
  };

  const r = await runCosmosTask(
    db,
    {
      tenantId: tenant.id,
      userId: ctx.userId,
      functionName: COMPOSE_FUNCTION,
      scope: 'builder',
      system: prompt.system,
      message: prompt.message,
      maxOutputTokens: composeMaxOutputTokens(input.mode),
      metadata: { mode: input.mode },
      evaluate,
      ...(ctx.role === 'admin' ? { staff: { route: '/cliente/builder#cosmos-widget' } } : {}),
    },
    { settings: await readCosmosSettings(db) },
  );
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, ...r.value };
}

const LANGUAGE: Record<Locale, string> = {
  'pt-BR': 'Brazilian Portuguese',
  'es-AR': 'Spanish',
  en: 'English',
};

export async function installGuide(
  ctx: ClientContext,
  input: {
    widget: { id: string; kind: WidgetInput['kind']; name: string };
    target: InstallTarget;
    site: string;
  },
  locale: Locale,
): Promise<{ ok: true; guide: InstallGuide } | { ok: false; error: WidgetTaskError }> {
  const denied = widgetTaskAccess(ctx);
  if (denied) return { ok: false, error: denied };
  const db = builderDb();
  const prompt = installPrompt({
    target: input.target,
    site: input.site,
    widget: input.widget,
    language: LANGUAGE[locale],
  });
  const r = await runCosmosTask(
    db,
    {
      tenantId: ctx.tenant!.id,
      userId: ctx.userId,
      functionName: INSTALL_FUNCTION,
      scope: 'builder',
      system: prompt.system,
      message: prompt.message,
      maxOutputTokens: INSTALL_MAX_OUTPUT_TOKENS,
      metadata: { target: input.target },
      evaluate: async (text) => {
        const guide = parseInstallAnswer(parseModelJson(text));
        return { usable: guide !== null, value: guide! };
      },
      ...(ctx.role === 'admin' ? { staff: { route: '/cliente/builder#cosmos-install' } } : {}),
    },
    { settings: await readCosmosSettings(db) },
  );
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, guide: r.value };
}
