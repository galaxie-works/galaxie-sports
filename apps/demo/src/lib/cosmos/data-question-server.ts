/**
 * Perguntas sobre os dados (#1006), no servidor: o laço de até três rodadas ("planejar → consultar → responder") roda
 * dentro de uma tarefa da carteira (`runCosmosTask` com `execute`), então todas as chamadas ao modelo entram num só
 * acerto. As consultas são só GET de dados, conferidas por `checkCall` (contrato + plano do tenant) e feitas pelo
 * servidor; o modelo nunca vê a chave nem dados de outro tenant. Resposta com número que não está nos dados não é
 * mostrada nem cobrada.
 */
import { activeFunctionMinCredits, readCosmosSettings, runCosmosTask } from '@galaxie/cosmos';
import { DEFAULT_THEMES, WIDGET_CATALOG } from '@galaxie/widgets';

import { ENTITY_TYPES, marketsFor, parseWidgetInput, toWidgetLocale } from '@/lib/builder/config';
import { brandThemeItems } from '@/lib/builder/editor';
import { builderDb } from '@/lib/builder/store';
import type { ClientContext } from '@/lib/client/session';
import { galaxieGet } from '@/lib/galaxie/server';
import type { ApiRequest } from '@/lib/galaxie/request';
import { apiLocale, type Locale } from '@/lib/i18n/config';
import { getTimeZone } from '@/lib/i18n/server';
import { openApiDocument } from '@/lib/openapi-reference';

import { assistantAccessError } from './assistant-server';
import {
  CALLS_MAX,
  DATA_FUNCTION,
  DATA_MAX_OUTPUT_TOKENS,
  DATA_ROUNDS,
  dataCatalog,
  dataPrompt,
  judgeDataAnswer,
  RESULT_CHARS,
  runDataLoop,
  toApiRequest,
  widgetFor,
  type DataRoute,
  type DataScope,
  type DataStep,
} from './data-questions';
import { encodeDraftParam, specToRawInput, type ComposeSpec } from './widget-compose';

export type DataQuestionError =
  | 'unauthorized'
  | 'staff'
  | 'module'
  | 'role'
  | 'unavailable'
  | 'insufficient'
  | 'blocked'
  | 'disabled'
  | 'no_wallet'
  | 'rate_limited'
  | 'failed'
  | 'unreadable';

export interface DataSource {
  request: ApiRequest;
  /** `?cosmos=` do editor do Builder, quando a consulta tem um widget equivalente. */
  widget: { kind: string; draft: string } | null;
}

export type DataAnswer =
  | { status: 'answered'; answer: string; sources: DataSource[]; charged: number }
  /** A API não tem o dado (ou o plano não cobre): não cobra. */
  | { status: 'no_data'; answer: string; sources: DataSource[] }
  /** O modelo citou número que não está nos dados: a resposta não aparece e não cobra. */
  | { status: 'unverified' };

/** Prazo de cada consulta à API dentro do laço (a tarefa roda dentro da reserva). */
const API_TIMEOUT_MS = 8_000;

let catalog: DataRoute[] | null = null;
const routes = () => (catalog ??= dataCatalog(openApiDocument()));

/** Mínimo da função para o aviso da tela; null = função fora do catálogo (o modo "dados" some). */
export const dataQuestionMinCredits = () => activeFunctionMinCredits(builderDb(), DATA_FUNCTION);

const EMPTY_SPEC: Omit<ComposeSpec, 'kind'> = {
  name: null,
  locale: null,
  market: null,
  entity: null,
  sport: null,
  theme: null,
  options: {},
  standings: null,
  liveList: null,
  why: null,
};

export async function askDataQuestion(
  ctx: ClientContext,
  input: { question: string; context: { route: string; title: string } },
  locale: Locale,
): Promise<{ ok: true; result: DataAnswer } | { ok: false; error: DataQuestionError }> {
  const denied = assistantAccessError(ctx);
  if (denied) return { ok: false, error: denied };
  const tenant = ctx.tenant!;
  const db = builderDb();
  const timeZone = await getTimeZone(locale);
  const scope: DataScope = { sports: tenant.sports, markets: tenant.markets };
  const today = new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date());
  const first = dataPrompt({
    question: input.question,
    context: input.context,
    catalog: routes(),
    steps: [],
    locale,
    today,
    last: false,
  });

  const r = await runCosmosTask(
    db,
    {
      tenantId: tenant.id,
      userId: ctx.userId,
      functionName: DATA_FUNCTION,
      scope: 'assistant',
      system: first.system,
      message: first.message,
      maxOutputTokens: DATA_MAX_OUTPUT_TOKENS,
      rounds: DATA_ROUNDS,
      // as rodadas seguintes levam os resultados (até CALLS_MAX, cortados), repetidos a cada rodada
      extraInputChars: CALLS_MAX * RESULT_CHARS * (DATA_ROUNDS - 1),
      keepUnusable: true,
      metadata: { route: input.context.route.slice(0, 200) },
      execute: async (ask) => {
        const loop = await runDataLoop(
          ask,
          (call) =>
            galaxieGet<unknown>(
              call.path,
              { ...call.query, locale: apiLocale(locale), tz: timeZone },
              { signal: AbortSignal.timeout(API_TIMEOUT_MS) },
            ),
          { ...input, catalog: routes(), scope, locale, today },
        );
        const verdict = judgeDataAnswer(loop, { question: input.question, today });
        return { usable: verdict.status === 'answered', value: verdict };
      },
      ...(ctx.role === 'admin'
        ? { staff: { route: `${input.context.route.slice(0, 200)}#cosmos-data` } }
        : {}),
    },
    { settings: await readCosmosSettings(db) },
  );
  if (!r.ok) return { ok: false, error: r.error };
  const v = r.value;
  if (!v || v.status === 'unreadable') return { ok: false, error: 'unreadable' };
  if (v.status === 'unverified') return { ok: true, result: { status: 'unverified' } };
  const sources = await sourcesOf(v.steps, ctx, locale);
  if (v.status === 'no_data') return { ok: true, result: { status: 'no_data', answer: v.answer, sources } };
  return { ok: true, result: { status: 'answered', answer: v.answer, sources, charged: r.charged } };
}

/** Fontes no formato do botão "Ver código", com o atalho para o Builder quando há widget equivalente. */
async function sourcesOf(steps: DataStep[], ctx: ClientContext, locale: Locale): Promise<DataSource[]> {
  const tenant = ctx.tenant!;
  const brandThemes = await brandThemeItems(tenant.id).catch(() => []);
  const markets = marketsFor(tenant.markets);
  return steps.map((s): DataSource => {
    const w = widgetFor(s.call);
    let widget: DataSource['widget'] = null;
    if (w) {
      const raw = specToRawInput(
        { ...EMPTY_SPEC, kind: w.kind },
        {
          entity: w.entity,
          brandThemes,
          presets: DEFAULT_THEMES,
          fallbackName: WIDGET_CATALOG[w.kind].name[toWidgetLocale(locale)],
          defaultLocale: toWidgetLocale(locale),
          markets,
          tenantSports: tenant.sports,
        },
      );
      const parsed = parseWidgetInput(raw, {
        markets: tenant.markets,
        entityTypes: (kind) => ENTITY_TYPES[kind],
        sports: tenant.sports,
      });
      if (parsed.ok) widget = { kind: w.kind, draft: encodeDraftParam(parsed.value) };
    }
    return { request: toApiRequest(s.call, `GET ${s.call.route}`), widget };
  });
}
