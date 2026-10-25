/**
 * LlmClient para o Gemini — API Interactions (`POST /v1beta/interactions`), Grounding with Google Search
 * (`tools: [{ type: 'google_search' }]`) e saída estruturada (`response_format` JSON Schema).
 * Docs (conferidas em 2026-10-23): ai.google.dev/gemini-api/docs/structured-output,
 * .../docs/google-search e ai.google.dev/api/interactions-api.
 *
 * Com busca, a pesquisa é feita em DOIS PASSOS. Na saída estruturada com busca a API não devolve as
 * citações do grounding, e as URLs escritas pelo modelo no JSON podem não existir (comparação de
 * 2026-10-23: Liga MX e Femenil com 0/8 países, todas as fontes inacessíveis). Então:
 *   1. texto livre com `google_search`: as `annotations` (`url_citation`) trazem a fonte real de cada
 *      trecho da resposta — links de redirecionamento do Google, resolvidos aqui para a URL real;
 *   2. sem busca, o modelo leve converte o texto no JSON pedido, recebendo a lista numerada dessas
 *      fontes como as ÚNICAS permitidas. O resultado traz `groundedUrls` e quem chama descarta qualquer
 *      URL de fora (o agente do onde assistir faz isso antes do validador).
 * Sem filtro de domínios na busca do Google: a allowlist vai no prompt e o validador de direitos só
 * aceita fonte de domínio permitido que cita a emissora (docs/07 §2.2), como nos outros provedores.
 */
import { DEFAULT_MAX_OUTPUT_TOKENS } from '../budget.js';
import { classifyProviderError, LlmError } from '../errors.js';
import { assertMatchesSchema, parseJsonOutput, strictSchemaProblems } from '../json-schema.js';
import { estimateCostUsd, GEMINI_GROUNDING_USD_PER_QUERY } from '../pricing.js';
import { withRetry, type RetryOptions } from '../retry.js';
import type { LlmCitation, LlmClient, LlmJsonRequest, LlmResult, LlmTier } from '../types.js';
import { dedupeCitations, splitMessages, UsageMeter, withUsage } from './common.js';

export const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
/** Host dos links de redirecionamento das citações do grounding. */
const GROUNDING_REDIRECT_HOST = 'vertexaisearch.cloud.google.com';
const MAX_REDIRECTS_RESOLVED = 40;
/** Trechos citados por fonte que vão para o passo 2 (e o tamanho de cada um). */
const MAX_SEGMENTS_PER_SOURCE = 6;
const MAX_SEGMENT_CHARS = 240;
export const GEMINI_THINKING_LEVEL = 'low';
/**
 * O Gemini bloqueia a resposta que reproduz texto de página protegido ("Request blocked due to
 * copyright/recitation content"). Os trechos de evidência não precisam ser literais: o verificador
 * confere a página (acessível, de domínio permitido, citando a emissora), não o trecho.
 */
export const NO_RECITATION_NOTE =
  'Não copie texto literal das páginas da web (direitos autorais): nos campos de trecho/citação, escreva uma paráfrase curta com suas palavras, citando a URL da fonte.';

/** Instrução do passo 1 (pesquisa em texto, com as fontes citadas pelo grounding). */
export const RESEARCH_STEP_NOTE =
  'Responda em texto corrido (não em JSON), organizado por país, com tudo o que encontrar para preencher a resposta pedida. Use a busca e baseie cada afirmação em fontes encontradas nela.';

/**
 * Teto de buscas da chamada. A ferramenta `google_search` não tem parâmetro de teto de consultas (nem
 * na Interactions API nem na generateContent): o modelo decide quantas faz e cada uma é cobrada
 * (GEMINI_GROUNDING_USD_PER_QUERY). O teto vai como instrução no passo 1; a contagem real volta em
 * `usage.grounding_tool_count`, fica no ledger (`web_searches`) e o orçamento alerta a chamada acima
 * do teto (o painel conta essas chamadas).
 */
export function searchCapNote(maxSearches: number | undefined): string {
  if (maxSearches === undefined) return '';
  return `Faça no máximo ${maxSearches} ${maxSearches === 1 ? 'consulta' : 'consultas'} de busca no total: planeje as consultas antes, combine termos numa mesma consulta e pare quando tiver o suficiente.`;
}

/** Instrução do passo 2 (estruturação sem busca, só com as fontes do passo 1). */
export const STRUCTURE_STEP_NOTE =
  'Converta o resultado da pesquisa abaixo no JSON pedido. Use SOMENTE as fontes da lista "Fontes permitidas": todo campo de URL de evidência precisa ser exatamente uma URL dessa lista, e o trecho deve vir do texto da pesquisa associado a essa fonte. Afirmação sem fonte da lista não entra (deixe "a confirmar"/vazio). Não invente URLs. Os rótulos [S1], [S2]... da lista servem só para achar a URL: nunca os escreva dentro dos campos de texto.';

interface Annotation {
  type: string;
  url?: string;
  title?: string;
  start_index?: number;
  end_index?: number;
}

/** Subconjunto da resposta da Interactions API que usamos (robusto a campos novos). */
interface InteractionOutput {
  status?: string;
  steps?: Array<{
    type: string;
    content?: Array<{ type: string; text?: string; annotations?: Annotation[] }>;
    arguments?: { queries?: string[] };
  }>;
  usage?: {
    total_input_tokens?: number;
    total_output_tokens?: number;
    total_thought_tokens?: number;
    total_cached_tokens?: number;
    total_tool_use_tokens?: number;
    grounding_tool_count?: Array<{ type?: string; count?: number }>;
  } | null;
  error?: { code?: number; message?: string; status?: string };
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface GeminiClientOptions {
  apiKey?: string;
  models: Record<LlmTier, string>;
  maxRetries?: number;
  timeoutMs?: number;
  /** fetch injetado (testes). */
  fetch?: FetchLike;
  retry?: Partial<RetryOptions>;
}

/** Fonte do grounding (URL real) com os trechos da resposta que ela sustenta. */
export interface GroundedSource {
  url: string;
  title: string | null;
  segments: string[];
}

/** Erro HTTP com `status` (o classificador de erros lê o código). */
class GeminiHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | undefined,
  ) {
    super(message);
    this.name = 'GeminiHttpError';
  }
}

/** Trecho do texto pelos índices em bytes UTF-8 da anotação (fim exclusivo). */
export function segmentOf(text: string, start: number | undefined, end: number | undefined): string {
  if (start === undefined || end === undefined || end <= start) return '';
  return Buffer.from(text, 'utf8').subarray(start, end).toString('utf8').replace(/\s+/g, ' ').trim();
}

/** Lista numerada das fontes para o passo 2. */
export function sourcesBlock(sources: GroundedSource[]): string {
  return sources
    .map((s, i) => {
      const segs = s.segments.map((t) => `   - "${t}"`).join('\n');
      return `[S${i + 1}] ${s.url}${s.title ? ` (${s.title})` : ''}${segs ? `\n${segs}` : ''}`;
    })
    .join('\n');
}

export class GeminiLlmClient implements LlmClient {
  private readonly fetch: FetchLike;

  constructor(private readonly options: GeminiClientOptions) {
    if (!options.fetch && !options.apiKey)
      throw new LlmError('GEMINI_API_KEY ausente (provedor gemini).', 'config', false);
    this.fetch = options.fetch ?? ((url, init) => fetch(url, init));
  }

  /** Corpo da requisição (exposto para teste): com `schema`, saída JSON; com `search`, a busca do Google. */
  buildBody(
    req: LlmJsonRequest,
    model: string,
    opts: { input?: string; extraSystem?: string; schema?: boolean; search?: boolean } = {},
  ): Record<string, unknown> {
    const { system, dialog } = splitMessages(req);
    const input =
      opts.input ??
      (dialog.length === 1
        ? dialog[0]!.content
        : dialog
            .map((m) => `${m.role === 'assistant' ? 'Assistente' : 'Usuário'}: ${m.content}`)
            .join('\n\n'));
    const body: Record<string, unknown> = {
      model,
      system_instruction: [system, opts.extraSystem, NO_RECITATION_NOTE].filter(Boolean).join('\n\n'),
      input,
      // o raciocínio conta no limite de saída: `low` evita a resposta incompleta em pesquisas longas
      generation_config: {
        max_output_tokens: req.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
        thinking_level: GEMINI_THINKING_LEVEL,
      },
      store: false,
    };
    if (opts.schema ?? true)
      body.response_format = { type: 'text', mime_type: 'application/json', schema: req.schema };
    if (opts.search ?? req.webSearch) body.tools = [{ type: 'google_search' }];
    return body;
  }

  async generateJson<T>(req: LlmJsonRequest): Promise<LlmResult<T>> {
    const problems = strictSchemaProblems(req.schema);
    if (problems.length)
      throw new LlmError(
        `Schema ${req.schemaName} incompatível com o modo estrito: ${problems.join('; ')}`,
        'config',
        false,
      );
    const model = req.model ?? this.options.models[req.tier];
    // o passo 2 só organiza o texto: modelo leve, sem busca
    const structureModel = req.webSearch ? this.options.models.light : model;
    // um medidor por passo (cada um com o preço do seu modelo); todas as tentativas são cobradas
    const research = new UsageMeter();
    const structure = new UsageMeter();
    const cost = () => {
      const c1 = research.inputTokens
        ? estimateCostUsd(
            model,
            meterTokens(research),
            research.webSearchCalls,
            GEMINI_GROUNDING_USD_PER_QUERY,
          )
        : 0;
      const c2 = estimateCostUsd(structureModel, meterTokens(structure));
      return c1 === undefined || c2 === undefined ? undefined : Math.round((c1 + c2) * 1e6) / 1e6;
    };
    const usage = () => {
      const total = new UsageMeter();
      for (const m of [research, structure])
        total.add({
          input: m.inputTokens,
          output: m.outputTokens,
          cached: m.cachedInputTokens,
          searches: m.webSearchCalls,
        });
      return total.toUsage(cost());
    };
    try {
      return await withRetry(
        async () => {
          let sources: GroundedSource[] | null = null;
          let input: string | undefined;
          if (req.webSearch) {
            const found = await this.interact(
              this.buildBody(req, model, {
                schema: false,
                search: true,
                extraSystem: [
                  RESEARCH_STEP_NOTE,
                  searchCapNote(req.maxSearches),
                  allowlistNote(req.allowedDomains),
                ]
                  .filter(Boolean)
                  .join('\n\n'),
              }),
              research,
            );
            sources = await this.groundedSources(found.text, found.annotations);
            const { dialog } = splitMessages(req);
            input = [
              dialog.map((m) => m.content).join('\n\n'),
              `## Resultado da pesquisa\n${found.text}`,
              `## Fontes permitidas\n${sources.length ? sourcesBlock(sources) : '(nenhuma: a busca não trouxe fontes)'}`,
            ].join('\n\n');
          }
          const out = await this.interact(
            this.buildBody(req, structureModel, {
              ...(input !== undefined ? { input, extraSystem: STRUCTURE_STEP_NOTE } : {}),
              schema: true,
              search: false,
            }),
            structure,
          );
          const data = assertMatchesSchema<T>(
            req.schema,
            parseJsonOutput(out.text, req.schemaName),
            req.schemaName,
          );
          const citations: LlmCitation[] = sources
            ? sources.map((s) => ({ url: s.url, ...(s.title ? { title: s.title } : {}) }))
            : await this.resolveRedirects(out.annotations.filter((a) => a.url).map((a) => ({ url: a.url! })));
          return {
            data,
            citations: dedupeCitations(citations),
            usage: usage(),
            provider: 'gemini' as const,
            model,
            ...(sources ? { groundedUrls: sources.map((s) => s.url) } : {}),
          };
        },
        { retries: this.options.maxRetries ?? 3, ...this.options.retry },
      );
    } catch (err) {
      throw withUsage(err, usage());
    }
  }

  /** Uma interação: texto da resposta, anotações e uso (somado em `meter`). */
  private async interact(
    body: Record<string, unknown>,
    meter: UsageMeter,
  ): Promise<{ text: string; annotations: Annotation[] }> {
    const res = await this.create(body);
    const steps = res.steps ?? [];
    const u = res.usage ?? {};
    const searches =
      (u.grounding_tool_count ?? [])
        .filter((g) => g.type === 'google_search')
        .reduce((s, g) => s + (g.count ?? 0), 0) ||
      steps
        .filter((s) => s.type === 'google_search_call')
        .reduce((s, st) => s + Math.max(1, st.arguments?.queries?.length ?? 0), 0);
    meter.add({
      // o resultado das ferramentas entra como entrada; o raciocínio é cobrado como saída
      input: (u.total_input_tokens ?? 0) + (u.total_tool_use_tokens ?? 0),
      output: (u.total_output_tokens ?? 0) + (u.total_thought_tokens ?? 0),
      cached: u.total_cached_tokens,
      searches,
    });
    if (res.status === 'incomplete') throw new LlmError('gemini: resposta incompleta.', 'incomplete', false);
    if (res.status === 'failed')
      throw new LlmError(
        `gemini: interação falhou (${res.error?.message ?? 'sem detalhe'}).`,
        'provider',
        true,
      );
    const contents = steps
      .filter((s) => s.type === 'model_output')
      .flatMap((s) => s.content ?? [])
      .filter((c) => c.type === 'text');
    // índices das anotações são relativos ao texto do próprio bloco: concatenamos ajustando o deslocamento
    let text = '';
    const annotations: Annotation[] = [];
    for (const c of contents) {
      const offset = Buffer.byteLength(text, 'utf8');
      for (const a of c.annotations ?? [])
        if (a.type === 'url_citation')
          annotations.push({
            ...a,
            ...(a.start_index !== undefined ? { start_index: a.start_index + offset } : {}),
            ...(a.end_index !== undefined ? { end_index: a.end_index + offset } : {}),
          });
      text += c.text ?? '';
    }
    return { text, annotations };
  }

  /** Fontes reais do grounding com os trechos que cada uma sustenta (redirecionamento não resolvido sai). */
  private async groundedSources(text: string, annotations: Annotation[]): Promise<GroundedSource[]> {
    const raw = annotations.filter((a) => a.url);
    const resolved = await this.resolveRedirects(
      raw.map((a) => ({ url: a.url!, ...(a.title ? { title: a.title } : {}) })),
    );
    const byUrl = new Map<string, GroundedSource>();
    resolved.forEach((c, i) => {
      if (isRedirect(c.url)) return;
      const a = raw[i]!;
      const s = byUrl.get(c.url) ?? { url: c.url, title: a.title ?? null, segments: [] };
      const seg = segmentOf(text, a.start_index, a.end_index).slice(0, MAX_SEGMENT_CHARS);
      if (seg && !s.segments.includes(seg) && s.segments.length < MAX_SEGMENTS_PER_SOURCE)
        s.segments.push(seg);
      byUrl.set(c.url, s);
    });
    return [...byUrl.values()];
  }

  private async create(body: Record<string, unknown>): Promise<InteractionOutput> {
    let res: Response;
    try {
      res = await this.fetch(`${GEMINI_API_BASE}/interactions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': this.options.apiKey ?? '' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 180_000),
      });
    } catch (err) {
      throw classifyProviderError(err, 'gemini');
    }
    const json = (await res.json().catch(() => ({}))) as InteractionOutput | InteractionOutput[];
    // erros vêm às vezes como lista de um elemento
    const out = Array.isArray(json) ? (json[0] ?? {}) : json;
    if (!res.ok) {
      const e = out.error ?? {};
      throw classifyProviderError(
        new GeminiHttpError(e.message ?? `HTTP ${res.status}`, res.status, e.status),
        'gemini',
      );
    }
    return out;
  }

  /** Links de redirecionamento do grounding → URL real (o mesmo link é resolvido uma vez só). */
  private async resolveRedirects(list: LlmCitation[]): Promise<LlmCitation[]> {
    const cache = new Map<string, Promise<string>>();
    let budget = MAX_REDIRECTS_RESOLVED;
    const resolve = (url: string): Promise<string> => {
      const hit = cache.get(url);
      if (hit) return hit;
      const p =
        !isRedirect(url) || budget-- <= 0
          ? Promise.resolve(url)
          : this.fetch(url, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(10_000) })
              .then((r) => r.headers.get('location') ?? url)
              .catch(() => url);
      cache.set(url, p);
      return p;
    };
    return Promise.all(list.map(async (c) => ({ ...c, url: await resolve(c.url) })));
  }
}

function isRedirect(url: string): boolean {
  try {
    return new URL(url).hostname === GROUNDING_REDIRECT_HOST;
  } catch {
    return false;
  }
}

/**
 * A busca do Google não filtra domínios (a da OpenAI filtra): sem esta orientação o Gemini cita sites
 * fora do dicionário do país, que o validador não aceita como prova (comparação de 2026-10-23).
 */
export function allowlistNote(domains: readonly string[] | undefined): string {
  if (!domains?.length) return '';
  return `Só valem como prova fontes destes domínios (busque neles, inclusive com "site:dominio"; fonte de fora não conta): ${domains.join(', ')}.`;
}

function meterTokens(m: UsageMeter) {
  return { inputTokens: m.inputTokens, outputTokens: m.outputTokens, cachedInputTokens: m.cachedInputTokens };
}
