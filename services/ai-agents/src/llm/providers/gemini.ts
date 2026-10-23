/**
 * LlmClient para o Gemini — API Interactions (`POST /v1beta/interactions`) com saída estruturada
 * (`response_format` JSON Schema) e Grounding with Google Search (`tools: [{ type: 'google_search' }]`).
 * A combinação saída estruturada + busca só existe nessa API e nos modelos Gemini 3 em diante.
 * Docs (conferidas em 2026-10-23): ai.google.dev/gemini-api/docs/structured-output,
 * .../docs/google-search e ai.google.dev/api/interactions-api.
 *
 * Sem filtro de domínios na busca do Google: a allowlist vai no prompt e o validador de direitos só
 * aceita fontes de domínio permitido que citam a emissora (docs/07 §2.2) — como nos outros provedores.
 * As citações do grounding vêm como links de redirecionamento do Google; resolvemos para a URL real.
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
const MAX_REDIRECTS_RESOLVED = 30;
export const GEMINI_THINKING_LEVEL = 'low';
/**
 * O Gemini bloqueia a resposta que reproduz texto de página protegido ("Request blocked due to
 * copyright/recitation content"). Os trechos de evidência não precisam ser literais: o verificador
 * confere a página (acessível, de domínio permitido, citando a emissora), não o trecho.
 */
export const NO_RECITATION_NOTE =
  'Não copie texto literal das páginas da web (direitos autorais): nos campos de trecho/citação, escreva uma paráfrase curta com suas palavras, citando a URL da fonte.';

/** Subconjunto da resposta da Interactions API que usamos (robusto a campos novos). */
interface InteractionOutput {
  status?: string;
  steps?: Array<{
    type: string;
    content?: Array<{
      type: string;
      text?: string;
      annotations?: Array<{ type: string; url?: string; title?: string }>;
    }>;
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

export class GeminiLlmClient implements LlmClient {
  private readonly fetch: FetchLike;

  constructor(private readonly options: GeminiClientOptions) {
    if (!options.fetch && !options.apiKey)
      throw new LlmError('GEMINI_API_KEY ausente (provedor gemini).', 'config', false);
    this.fetch = options.fetch ?? ((url, init) => fetch(url, init));
  }

  /** Monta o corpo da requisição (exposto para teste). */
  buildBody(req: LlmJsonRequest, model: string): Record<string, unknown> {
    const { system, dialog } = splitMessages(req);
    const input =
      dialog.length === 1
        ? dialog[0]!.content
        : dialog
            .map((m) => `${m.role === 'assistant' ? 'Assistente' : 'Usuário'}: ${m.content}`)
            .join('\n\n');
    const body: Record<string, unknown> = {
      model,
      system_instruction: [system, NO_RECITATION_NOTE].filter(Boolean).join('\n\n'),
      input,
      response_format: { type: 'text', mime_type: 'application/json', schema: req.schema },
      // o raciocínio conta no limite de saída: `low` evita a resposta incompleta em pesquisas longas
      generation_config: {
        max_output_tokens: req.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
        thinking_level: GEMINI_THINKING_LEVEL,
      },
      store: false,
    };
    if (req.webSearch) body.tools = [{ type: 'google_search' }];
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
    const meter = new UsageMeter();
    const cost = () =>
      estimateCostUsd(
        model,
        {
          inputTokens: meter.inputTokens,
          outputTokens: meter.outputTokens,
          cachedInputTokens: meter.cachedInputTokens,
        },
        meter.webSearchCalls,
        GEMINI_GROUNDING_USD_PER_QUERY,
      );
    try {
      return await withRetry(
        async () => {
          const res = await this.create(this.buildBody(req, model));
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
          if (res.status === 'incomplete')
            throw new LlmError('gemini: resposta incompleta.', 'incomplete', false);
          if (res.status === 'failed')
            throw new LlmError(
              `gemini: interação falhou (${res.error?.message ?? 'sem detalhe'}).`,
              'provider',
              true,
            );
          const texts = steps
            .filter((s) => s.type === 'model_output')
            .flatMap((s) => s.content ?? [])
            .filter((c) => c.type === 'text');
          const data = assertMatchesSchema<T>(
            req.schema,
            parseJsonOutput(texts.map((c) => c.text ?? '').join(''), req.schemaName),
            req.schemaName,
          );
          const raw: LlmCitation[] = texts.flatMap((c) =>
            (c.annotations ?? [])
              .filter((a) => a.type === 'url_citation' && a.url)
              .map((a) => ({ url: a.url!, ...(a.title ? { title: a.title } : {}) })),
          );
          return {
            data,
            citations: dedupeCitations(await this.resolveRedirects(raw)),
            usage: meter.toUsage(cost()),
            provider: 'gemini' as const,
            model,
          };
        },
        { retries: this.options.maxRetries ?? 3, ...this.options.retry },
      );
    } catch (err) {
      throw withUsage(err, meter.toUsage(cost()));
    }
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

  /** Links de redirecionamento do grounding → URL real (o validador confere domínio e conteúdo). */
  private async resolveRedirects(list: LlmCitation[]): Promise<LlmCitation[]> {
    let budget = MAX_REDIRECTS_RESOLVED;
    return Promise.all(
      list.map(async (c) => {
        let host: string;
        try {
          host = new URL(c.url).hostname;
        } catch {
          return c;
        }
        if (host !== GROUNDING_REDIRECT_HOST || budget-- <= 0) return c;
        try {
          const r = await this.fetch(c.url, {
            method: 'GET',
            redirect: 'manual',
            signal: AbortSignal.timeout(10_000),
          });
          const location = r.headers.get('location');
          return location ? { ...c, url: location } : c;
        } catch {
          return c;
        }
      }),
    );
  }
}
