/**
 * Ranqueamento das candidatas pelo Gemini (visão): recebe as miniaturas e devolve, por foto, o tipo (retrato,
 * ação, carro, outro), se é foto real e uma nota de qualidade. Só ordena: licença, resolução, época e
 * categoria já foram conferidas pelas regras (`select.ts`), e a IA nunca acrescenta uma foto.
 *
 * API `models/{modelo}:generateContent` com as imagens em `inline_data` e saída JSON (`responseSchema`).
 * A chave vem de GEMINI_API_KEY; o modelo, de GEMINI_MODEL_VISION (padrão: o leve da camada de IA).
 */
import type { Ranker } from './map.js';
import type { AiJudgement } from './select.js';

export const GEMINI_VISION_DEFAULT_MODEL = 'gemini-3.5-flash-lite';
const API = 'https://generativelanguage.googleapis.com/v1beta/models';

export interface GeminiRankerOptions {
  apiKey: string;
  model?: string;
  fetch?: typeof globalThis.fetch;
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

/** Julgamentos do Gemini para as imagens (na ordem enviada). Lança em erro de rede/API. */
export async function rankWithGemini(
  images: RankImage[],
  subject: string,
  kind: 'driver' | 'car',
  options: GeminiRankerOptions,
): Promise<AiJudgement[]> {
  if (!images.length) return [];
  const parts: unknown[] = [{ text: rankPrompt(subject, kind, images.length) }];
  images.forEach((img, i) => {
    parts.push({ text: `Foto ${i}: ${img.title}` });
    parts.push({ inline_data: { mime_type: img.mime, data: Buffer.from(img.body).toString('base64') } });
  });
  const res = await (options.fetch ?? fetch)(
    `${API}/${options.model ?? GEMINI_VISION_DEFAULT_MODEL}:generateContent`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': options.apiKey },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: SCHEMA },
      }),
    },
  );
  const body = (await res.json()) as {
    error?: { status?: string; message?: string };
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  if (!res.ok || body.error)
    throw new Error(
      `Gemini: ${body.error?.status ?? res.status} ${body.error?.message?.slice(0, 160) ?? ''}`.trim(),
    );
  const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '[]';
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

/** Ranqueador do mapeamento (`mapCommons`) com o Gemini. */
export function geminiRanker(options: GeminiRankerOptions): Ranker {
  return {
    model: options.model ?? GEMINI_VISION_DEFAULT_MODEL,
    rank: (images, subject, kind) => rankWithGemini(images, subject, kind, options),
  };
}
