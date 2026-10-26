/**
 * Ranqueamento das candidatas pelo Gemini (visão): recebe as miniaturas e devolve, por foto, o tipo (retrato,
 * ação, carro, outro), se é foto real e uma nota de qualidade. Só ordena: licença, resolução, época e
 * categoria já foram conferidas pelas regras (`select.ts`), e a IA nunca acrescenta uma foto.
 *
 * API `models/{modelo}:generateContent` com as imagens em `inline_data` e saída JSON (`responseSchema`).
 * A chave vem de GEMINI_API_KEY; o modelo, de GEMINI_MODEL_VISION (padrão: o leve da camada de IA).
 *
 * Cada chamada passa pelo ledger diário de IA (`ops.llm_usage`, @galaxie/ai-ledger), como as dos agentes:
 * reserva a estimativa antes (AI_STATUS, teto global e o do agente `assets`, AI_AGENT_USD_BUDGETS) e grava o
 * uso devolvido pelo Gemini depois. Sem orçamento, a chamada não sai (BudgetExceededError).
 */
import { estimateCostUsd, type TokenBudget } from '@galaxie/ai-ledger';
import type { Ranker } from './map.js';
import type { AiJudgement } from './select.js';

export const GEMINI_VISION_DEFAULT_MODEL = 'gemini-3.5-flash-lite';
const API = 'https://generativelanguage.googleapis.com/v1beta/models';

/** Agente no ledger (prefixo do `purpose`): teto próprio em AI_AGENT_USD_BUDGETS (`assets=1`). */
export const ASSETS_AGENT = 'assets';
/** Tokens de entrada presumidos por imagem (resolução padrão das imagens no Gemini 3). */
export const GEMINI_IMAGE_TOKENS = 1_120;
/** Teto de saída da ordem (JSON curto por foto e o raciocínio do modelo): limita o custo e a estimativa. */
export const RANK_MAX_OUTPUT_TOKENS = 8_192;

export interface GeminiRankerOptions {
  apiKey: string;
  model?: string;
  fetch?: typeof globalThis.fetch;
  /** Ledger do dia: reserva antes da chamada e grava o uso (agente `assets`). */
  budget: TokenBudget;
}

export interface RankImage {
  /** Miniatura (JPEG/PNG) já baixada. */
  body: Uint8Array;
  mime: string;
  title: string;
}

const SCHEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      index: { type: 'INTEGER' },
      kind: { type: 'STRING', enum: ['portrait', 'action', 'car', 'other'] },
      keep: { type: 'BOOLEAN' },
      quality: { type: 'INTEGER' },
      hero: { type: 'NUMBER' },
      reason: { type: 'STRING' },
    },
    required: ['index', 'kind', 'keep', 'quality'],
  },
};

export function rankPrompt(subject: string, kind: 'driver' | 'car', count: number): string {
  const what =
    kind === 'driver'
      ? `do piloto de Fórmula 1 ${subject}. "portrait" = rosto nítido e visível (retrato, entrevista, pódio de perto); "action" = o piloto em corrida, no carro, no box ou no pódio; "car" = só o carro; "other" = o resto`
      : `do carro de Fórmula 1 ${subject}. "car" = o carro inteiro e nítido (em corrida, no box ou exposto); "other" = detalhe, motor, miniatura, réplica ou outro carro`;
  return [
    `Você recebe ${count} fotos candidatas (índices 0 a ${count - 1}, na ordem em que aparecem) ${what}.`,
    'Para cada foto, responda: index, kind, keep (true só para fotografia real e bem feita; false para ilustração, pintura, estátua, mural, pôster, captura de tela, montagem, foto borrada ou cortada demais), quality (0 a 10: nitidez, enquadramento, luz, interesse editorial para TV) e reason (curta, em português).',
    ...(kind === 'car'
      ? [
          'Para cada foto, responda também hero (0 a 1): o quanto ela serve de fundo largo do topo da página do piloto, com o carro à direita e o texto sobre o resto.',
          'Prefira, nesta ordem: (1) foto de corrida da própria temporada, com o piloto no carro (0,8 a 1); (2) o carro em ação num evento histórico, como Goodwood ou o Nürburgring Classic (0,6 a 0,8); (3) o carro parado e inteiro, num museu ou exposição (0,4 a 0,6).',
          'Dê no máximo 0,2 para: close de pessoas; carro que não aparece inteiro ou só como detalhe (roda, cockpit, motor, bico); pessoa moderna identificável em primeiro plano; multidão ou objeto cobrindo o carro.',
        ]
      : []),
    'Não tente identificar a pessoa pelo rosto: a identidade já foi conferida pela categoria da Wikimedia Commons.',
  ].join('\n');
}

/**
 * Estimativa conservadora de uma chamada (para a reserva no ledger): o texto a ~4 caracteres por token, as
 * imagens a GEMINI_IMAGE_TOKENS cada e a saída máxima, ao preço do modelo (fora da tabela, o mais caro do Gemini).
 */
export function rankEstimate(
  texts: string[],
  imageCount: number,
  model: string,
): { tokens: number; usd: number; inputTokens: number } {
  const chars = texts.reduce((n, t) => n + t.length, 0) + JSON.stringify(SCHEMA).length;
  const inputTokens = Math.ceil(chars / 4) + imageCount * GEMINI_IMAGE_TOKENS;
  const usd = estimateCostUsd(model, { inputTokens, outputTokens: RANK_MAX_OUTPUT_TOKENS }, 0, 0, 'gemini');
  return { tokens: inputTokens + RANK_MAX_OUTPUT_TOKENS, usd, inputTokens };
}

interface GeminiBody {
  error?: { status?: string; message?: string };
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
}

/**
 * Julgamentos do Gemini para as imagens (na ordem enviada). Reserva no ledger antes (lança
 * BudgetExceededError / AiDisabledError sem chamar nada) e grava o uso depois; lança em erro de rede/API.
 */
export async function rankWithGemini(
  images: RankImage[],
  subject: string,
  kind: 'driver' | 'car',
  options: GeminiRankerOptions,
): Promise<AiJudgement[]> {
  if (!images.length) return [];
  const model = options.model ?? GEMINI_VISION_DEFAULT_MODEL;
  const prompt = rankPrompt(subject, kind, images.length);
  const parts: unknown[] = [{ text: prompt }];
  const titles = images.map((img, i) => `Foto ${i}: ${img.title}`);
  images.forEach((img, i) => {
    parts.push({ text: titles[i] });
    parts.push({ inline_data: { mime_type: img.mime, data: Buffer.from(img.body).toString('base64') } });
  });
  const estimate = rankEstimate([prompt, ...titles], images.length, model);
  // sem saldo (ou IA desligada) a chamada não sai: o alvo fica como estava e volta na próxima execução
  // faixa da política de execução (#357): `manual` fora do scheduler, senão a do agente assets
  const band = options.budget.bandOf(ASSETS_AGENT);
  await options.budget.reserve(ASSETS_AGENT, estimate.tokens, estimate.usd, band);
  const purpose = `${ASSETS_AGENT}:commons:${kind}:${subject}`;
  const record = (
    outcome: 'ok' | 'error',
    usage: { inputTokens: number; outputTokens: number },
    error?: string,
  ) =>
    options.budget
      .record({
        agent: ASSETS_AGENT,
        purpose,
        provider: 'gemini',
        model,
        tier: 'light',
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        webSearches: 0,
        costUsd: estimateCostUsd(model, usage, 0, 0, 'gemini'),
        outcome,
        error,
        band,
      })
      .catch((err: unknown) =>
        // a chamada já foi paga: falha ao gravar o ledger não descarta a resposta
        console.error(
          `[orçamento de IA] ${purpose}: falha ao gravar o uso no ledger: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
  // sem resposta do Gemini, nada foi cobrado de que se saiba: a linha fica com zero (não com a estimativa)
  const none = { inputTokens: 0, outputTokens: 0 };
  let res: Response;
  try {
    res = await (options.fetch ?? fetch)(`${API}/${model}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': options.apiKey },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: RANK_MAX_OUTPUT_TOKENS,
          // raciocínio curto: com o padrão, ele pode gastar a saída inteira e a resposta vir sem texto
          thinkingConfig: { thinkingLevel: 'low' },
          responseMimeType: 'application/json',
          responseSchema: SCHEMA,
        },
      }),
    });
  } catch (err) {
    await record('error', none, err instanceof Error ? err.message : String(err));
    throw err;
  }
  let body: GeminiBody;
  try {
    body = (await res.json()) as GeminiBody;
  } catch {
    const message = `Gemini: resposta não é JSON (HTTP ${res.status})`;
    await record('error', none, message);
    throw new Error(message);
  }
  const meta = body.usageMetadata;
  const usage = meta
    ? {
        inputTokens: meta.promptTokenCount ?? 0,
        // o raciocínio é cobrado como saída
        outputTokens: (meta.candidatesTokenCount ?? 0) + (meta.thoughtsTokenCount ?? 0),
      }
    : res.ok && !body.error
      ? // resposta paga sem o uso: conta a estimativa (o teto não trata a chamada paga como de graça)
        { inputTokens: estimate.inputTokens, outputTokens: RANK_MAX_OUTPUT_TOKENS }
      : none;
  if (!res.ok || body.error) {
    const message =
      `Gemini: ${body.error?.status ?? res.status} ${body.error?.message?.slice(0, 160) ?? ''}`.trim();
    await record('error', usage, message);
    throw new Error(message);
  }
  const candidate = body.candidates?.[0];
  const text = candidate?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  // cortada (MAX_TOKENS), bloqueada ou vazia: não é "nenhuma foto boa", é falha (o alvo fica como estava)
  if (!text.trim() || candidate?.finishReason !== 'STOP') {
    const message = `Gemini: resposta sem a ordem (finishReason ${candidate?.finishReason ?? 'ausente'})`;
    await record('error', usage, message);
    throw new Error(message);
  }
  await record('ok', usage);
  const parsed = JSON.parse(text) as AiJudgement[];
  return parsed
    .filter((j) => Number.isInteger(j.index) && j.index >= 0 && j.index < images.length)
    .map((j) => ({
      index: j.index,
      kind: j.kind,
      keep: !!j.keep,
      quality: Math.max(0, Math.min(10, Math.round(j.quality))),
      ...(kind === 'car' && typeof j.hero === 'number'
        ? { hero: Math.round(Math.max(0, Math.min(1, j.hero)) * 100) / 100 }
        : {}),
      ...(j.reason ? { reason: j.reason } : {}),
    }));
}

/** Ranqueador do mapeamento (`mapCommons`) com o Gemini, cobrado no ledger diário de IA. */
export function geminiRanker(options: GeminiRankerOptions): Ranker {
  return {
    model: options.model ?? GEMINI_VISION_DEFAULT_MODEL,
    rank: (images, subject, kind) => rankWithGemini(images, subject, kind, options),
  };
}
