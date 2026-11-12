'use server';

/**
 * Ações da Cosmos no Builder (#1005): montar widgets a partir de uma frase e escrever os passos de instalação no jeito
 * do site do cliente. O tenant e o cargo saem da sessão; o texto do cliente é conferido aqui antes de ir ao modelo.
 */
import { builderDb, getWidget } from '@/lib/builder/store';
import { readClientContext } from '@/lib/client/session';
import { isUuid } from '@/lib/client/tenants';
import { getDictionary } from '@/lib/i18n/dictionary';
import { getRequestLocale } from '@/lib/i18n/server';
import { fill } from '@/lib/i18n/text';

import { COMPOSE_TEXT_MAX, isComposeMode } from './widget-compose';
import { INSTALL_SITE_MAX, isInstallTarget, type InstallGuide } from './widget-install';
import { composeWidgets, installGuide, type WidgetTaskError } from './widget-tasks';

export interface ComposedCard {
  kind: string;
  name: string;
  entity: string | null;
  why: string | null;
  draft: string;
}

export type ComposeActionResult =
  { ok: true; widgets: ComposedCard[]; skipped: number } | { ok: false; error: string };

async function texts() {
  const locale = await getRequestLocale();
  return { locale, T: getDictionary(locale).client.cosmosBuilder.errors };
}

const message = (T: Record<WidgetTaskError, string>, code: WidgetTaskError) => T[code] ?? T.failed;

export async function composeWithCosmos(input: {
  text: unknown;
  mode: unknown;
}): Promise<ComposeActionResult> {
  const [ctx, { locale, T }] = await Promise.all([readClientContext(), texts()]);
  if (!ctx) return { ok: false, error: T.unauthorized };
  const text = typeof input.text === 'string' ? input.text.trim() : '';
  if (!text) return { ok: false, error: T.empty };
  if ([...text].length > COMPOSE_TEXT_MAX)
    return { ok: false, error: fill(T.tooLong, { max: COMPOSE_TEXT_MAX }) };
  if (!isComposeMode(input.mode)) return { ok: false, error: T.failed };
  const r = await composeWidgets(ctx, { text, mode: input.mode }, locale);
  if (!r.ok) return { ok: false, error: message(T, r.error) };
  return {
    ok: true,
    widgets: r.widgets.map((w) => ({
      kind: w.input.kind,
      name: w.input.name,
      entity: w.entityLabel,
      why: w.why,
      draft: w.draft,
    })),
    skipped: r.rejected.length,
  };
}

export type InstallActionResult = { ok: true; guide: InstallGuide } | { ok: false; error: string };

export async function installWithCosmos(input: {
  widgetId: unknown;
  target: unknown;
  site: unknown;
}): Promise<InstallActionResult> {
  const [ctx, { locale, T }] = await Promise.all([readClientContext(), texts()]);
  if (!ctx?.tenant) return { ok: false, error: T.unauthorized };
  if (!isInstallTarget(input.target)) return { ok: false, error: T.failed };
  const site = typeof input.site === 'string' ? input.site.trim() : '';
  if ([...site].length > INSTALL_SITE_MAX)
    return { ok: false, error: fill(T.tooLong, { max: INSTALL_SITE_MAX }) };
  const widget =
    typeof input.widgetId === 'string' && isUuid(input.widgetId)
      ? await getWidget(builderDb(), input.widgetId)
      : null;
  // widget de outro tenant (ou arquivado) não existe para quem pede
  if (!widget || widget.tenantId !== ctx.tenant.id || widget.archivedAt)
    return { ok: false, error: T.notFound };
  const r = await installGuide(
    ctx,
    { widget: { id: widget.id, kind: widget.kind, name: widget.name }, target: input.target, site },
    locale,
  );
  return r.ok ? r : { ok: false, error: message(T, r.error) };
}
