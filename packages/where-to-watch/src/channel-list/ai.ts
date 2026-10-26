/**
 * A IA (Gemini, na VPS) só nas sobras do casamento determinístico: recebe direitos numerados e canais
 * numerados e devolve só índices e enums. Nada de nome de plataforma ou plano em texto livre; o
 * validador determinístico (`validateAiMatches`) confere tudo, e qualquer violação vira
 * `sem_canal_na_lista` com nota.
 */
import type { WtwCountry } from '../config/types.js';
import type { ChannelDictionary, ResolvedChannel } from './match.js';
import {
  CHANNEL_MATCH_KINDS,
  matchBase,
  type ChannelMatchKind,
  type ChannelRight,
  type RightMatch,
} from './types.js';

/**
 * Canais por pedido. Com mais candidatos, as sobras do país vão em mais de um pedido (cada direito
 * num só, com todos os candidatos dele); só os de um direito que sozinho passa do limite ficam de
 * fora, com nota.
 */
export const AI_MAX_CHANNELS = 400;
export const AI_NOTE_MAX = 200;

/** Um pedido à IA: as sobras de um país (ou parte delas, quando passam de `AI_MAX_CHANNELS` canais). */
export interface AiBatch {
  country: WtwCountry;
  /** `direito_idx` = posição aqui. */
  rights: ChannelRight[];
  /** `canal_cliente_idx` = índice do canal na lista do cliente. */
  channels: ResolvedChannel[];
  /** Candidatos que ficaram de fora pelo limite (direito que sozinho passa de `AI_MAX_CHANNELS`). */
  omittedChannels: number;
}

/** Palavras que não identificam marca (não bastam para mandar um par à IA). */
const GENERIC_WORDS = new Set(
  'tv canal channel channels hd sd fhd uhd sports sport deportes deporte esportes esporte plus premium network the del los las por para con live vivo play app online'.split(
    ' ',
  ),
);

/** Palavras de marca de um nome ("Disney+ Premium" → disney). */
export function brandWords(name: string): string[] {
  return name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\+/g, ' plus ')
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !GENERIC_WORDS.has(w));
}

/**
 * Sobras agrupadas por país, já filtradas pelo código: os direitos sem candidato do país e os canais
 * ao vivo sem uso que podem ser dele (do próprio país ou pan-regionais), só quando direito e canal
 * dividem ao menos uma palavra de marca. Canal que o dicionário diz ser de outra emissora não vai.
 * País sem par possível não vai para a IA. Passou de `AI_MAX_CHANNELS` canais, o país vai em mais de
 * um pedido: cada direito entra no primeiro em que os candidatos dele ainda cabem (os da mesma marca
 * dividem canais e tendem a ficar juntos), então todo direito volta exatamente uma vez.
 */
export function aiBatches(
  rights: ChannelRight[],
  channels: ResolvedChannel[],
  dict?: ChannelDictionary,
): AiBatch[] {
  const out: AiBatch[] = [];
  const countries = [...new Set(rights.map((r) => r.country))];
  const words = new Map(channels.map((c) => [c.facts.idx, new Set(brandWords(c.facts.base))]));
  for (const country of countries) {
    const open = channels.filter(
      (c) =>
        !c.facts.vod &&
        (c.country === country || c.country === null) &&
        !(dict && dict.resolve(country, c.facts)),
    );
    const countryRights = rights.filter((r) => r.country === country);
    const shares = (r: ChannelRight, c: ResolvedChannel) => {
      const names = dict ? dict.namesOf(country, r.broadcasterId) : [r.name];
      const w = words.get(c.facts.idx)!;
      return names.some((n) => brandWords(n).some((x) => w.has(x)));
    };
    const groups: { rights: ChannelRight[]; idx: Set<number>; left: Set<number> }[] = [];
    for (const r of countryRights) {
      const own = open.filter((c) => shares(r, c)).map((c) => c.facts.idx);
      if (!own.length) continue;
      const take = own.slice(0, AI_MAX_CHANNELS);
      const fits = (g: (typeof groups)[number]) =>
        g.idx.size + take.filter((i) => !g.idx.has(i)).length <= AI_MAX_CHANNELS;
      let g = groups.find(fits);
      if (!g) groups.push((g = { rights: [], idx: new Set(), left: new Set() }));
      g.rights.push(r);
      for (const i of take) g.idx.add(i);
      for (const i of own.slice(AI_MAX_CHANNELS)) g.left.add(i);
    }
    for (const g of groups)
      out.push({
        country,
        rights: g.rights,
        channels: open.filter((c) => g.idx.has(c.facts.idx)),
        omittedChannels: [...g.left].filter((i) => !g.idx.has(i)).length,
      });
  }
  return out;
}

/**
 * Versão do prompt (system, mensagem e schema). Entra no `purpose` de cada chamada e na nota da IA:
 * mudou o texto ou o schema, suba a versão.
 */
export const CHANNEL_MATCH_PROMPT_VERSION = 'channels@v1';
export const CHANNEL_MATCH_SCHEMA_NAME = 'casamento_canais_cliente';

/** Acesso do direito no vocabulário do prompt validado (vem do dicionário, nunca da IA). */
export type PromptAccess =
  'aberto' | 'assinatura_base' | 'ppv' | 'streaming_assinatura' | 'streaming_gratuito' | 'radio';

export function promptAccess(r: Pick<ChannelRight, 'medium' | 'accessModel'>): PromptAccess {
  if (r.medium === 'free_tv') return 'aberto';
  if (r.medium === 'radio') return 'radio';
  if (r.accessModel === 'ppv') return 'ppv';
  if (r.medium === 'pay_tv') return 'assinatura_base';
  if (r.medium === 'streaming_svod') return 'streaming_assinatura';
  return 'streaming_gratuito';
}

/**
 * Schema da saída (o structured output validado, com o item trocado para `direito_idx`): só índices
 * em enum, do próprio pedido, e o tipo de casamento.
 */
export function channelMatchSchema(batch: AiBatch): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['transmissores'],
    properties: {
      transmissores: {
        type: 'array',
        description: 'Exatamente um item por direito da entrada, na ordem de direito_idx.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['direito_idx', 'canal_cliente_idx', 'casamento', 'nota_auditoria'],
          properties: {
            direito_idx: {
              type: 'integer',
              enum: batch.rights.map((_, i) => i),
              description: 'Índice do direito na matriz de entrada.',
            },
            canal_cliente_idx: {
              type: ['integer', 'null'],
              enum: [...batch.channels.map((c) => c.facts.idx), null],
              description: 'Índice do canal na lista do cliente; null quando casamento = sem_canal_na_lista.',
            },
            casamento: { type: 'string', enum: [...CHANNEL_MATCH_KINDS] },
            nota_auditoria: {
              type: ['string', 'null'],
              description: 'Só para feed_generico ou nome_divergente (até 200 caracteres); senão, null.',
            },
          },
        },
      },
    },
  };
}

export interface ChannelMatchOutput {
  transmissores: {
    direito_idx: number;
    canal_cliente_idx: number | null;
    casamento: ChannelMatchKind;
    nota_auditoria: string | null;
  }[];
}

/**
 * System instruction validado no teste do AI Studio (deu o resultado esperado no exemplo de
 * referência), com os ajustes: direitos numerados, marca de praça casa como `exato` e a regra do VOD.
 */
export const CHANNEL_MATCH_SYSTEM = [
  'Você é o motor analítico de classificação do Galaxie Sports. Sua função é mapear e julgar o cruzamento de canais de IPTV com a matriz de direitos, operando estritamente através de índices e identificadores lógicos.',
  '',
  'Regras de Decisão Críticas:',
  "1. MAPEAMENTO DE ÍNDICES: O campo 'direito_idx' deve conter o índice do direito na matriz fornecida no prompt, e cada direito volta exatamente uma vez. O campo 'canal_cliente_idx' deve conter estritamente o índice numérico (inteiro baseado em 0) do canal correspondente localizado na lista fornecida no prompt. Se o direito não possuir nenhum canal equivalente, mapeie obrigatoriamente como null e defina o casamento como 'sem_canal_na_lista'.",
  '2. CRITÉRIO DE CASAMENTO:',
  "   - 'exato': O canal é a emissora do direito no mesmo país e no mesmo tipo de transmissão. Marca de praça ou afiliada (ex.: |SP|, RJ) não é divergência: a emissora casa como exato.",
  "   - 'feed_generico': Sinais pan-regionais (ex: ESPN 2 LATAM) mapeados para países sem sinal dedicado.",
  "   - 'nome_divergente': Quando houver correspondência de marca, mas o sufixo ou tipo de grade sugerir divergência (ex: Matriz dita TV Aberta e a lista possui canal com sufixo 'SPORTS').",
  "3. VALIDAÇÃO DE JANELA (STREAMING VS LINEAR): Se o direito for exclusivo de streaming nativo, canais lineares de TV por assinatura tradicionais não devem ser computados como casamento exato. Se não houver o canal de streaming na lista, marque como 'sem_canal_na_lista'.",
  "4. VOD NÃO É TRANSMISSÃO AO VIVO: canal marcado como VOD nunca casa com um direito; use 'sem_canal_na_lista'.",
  '5. PROIBIÇÃO DE ESCRITA LIVRE: Você está terminantemente proibido de gerar textos para plataformas ou planos. Utilize apenas os índices fornecidos na matriz de entrada e os Enums do Schema. nota_auditoria só para feed_generico ou nome_divergente.',
].join('\n');

/** Mensagem do usuário no molde validado: direitos numerados (país, plataforma e acesso do dicionário) e canais indexados. */
export function channelMatchInput(batch: AiBatch): string {
  return [
    '--- DIREITOS E PLATAFORMAS EXTRAÍDOS DA BASE DE DADOS (DADOS CONFIÁVEIS) ---',
    ...batch.rights.map(
      (r, i) =>
        `${i}: país "${r.country}" | plataforma_id "${r.broadcasterId}" | acesso "${promptAccess(r)}"`,
    ),
    '--- LISTA DE CANAIS DO CLIENTE INDEXADA ---',
    ...batch.channels.map((c) => `${c.facts.idx}: ${JSON.stringify(c.facts.name)}`),
    '--- PAÍSES EXIGIDOS ---',
    JSON.stringify([batch.country]),
    'Processe o julgamento de casamento semântico e retorne estritamente o JSON restringindo-se aos índices fornecidos.',
  ].join('\n');
}

/**
 * Validador depois da IA: todo direito volta exatamente uma vez, índice dentro da lista, canal de
 * outro país só como `feed_generico`, streaming nunca `exato` com canal linear, VOD nunca casa e o
 * canal não pode ser, pelo dicionário, de outra emissora. Violação → `sem_canal_na_lista` com nota.
 */
export function validateAiMatches(
  batch: AiBatch,
  output: unknown,
  dict: ChannelDictionary,
): { matches: RightMatch[]; violations: string[] } {
  const violations: string[] = [];
  const items = Array.isArray((output as ChannelMatchOutput | null)?.transmissores)
    ? (output as ChannelMatchOutput).transmissores
    : [];
  if (!items.length) violations.push('saída sem a lista "transmissores"');
  const byRight = new Map<number, ChannelMatchOutput['transmissores']>();
  for (const it of items) {
    const i = it?.direito_idx;
    if (!Number.isInteger(i) || i < 0 || i >= batch.rights.length) {
      violations.push(`direito_idx fora da lista: ${JSON.stringify(i)}`);
      continue;
    }
    byRight.set(i, [...(byRight.get(i) ?? []), it]);
  }
  const channels = new Map(batch.channels.map((c) => [c.facts.idx, c]));

  const matches = batch.rights.map((r, i): RightMatch => {
    const fail = (why: string): RightMatch => {
      violations.push(`direito ${i} (${r.country} ${r.broadcasterId}): ${why}`);
      return {
        ...matchBase(r),
        match: 'sem_canal_na_lista',
        channels: [],
        origin: 'ia',
        note: `Validador: ${why}.`,
      };
    };
    const got = byRight.get(i) ?? [];
    if (got.length !== 1) return fail(got.length ? `voltou ${got.length} vezes` : 'não voltou');
    const it = got[0]!;
    if (!(CHANNEL_MATCH_KINDS as readonly string[]).includes(it.casamento))
      return fail(`casamento fora do enum (${JSON.stringify(it.casamento).slice(0, 40)})`);
    if (it.casamento === 'sem_canal_na_lista') {
      if (it.canal_cliente_idx !== null && it.canal_cliente_idx !== undefined)
        return fail('sem_canal_na_lista com canal');
      return { ...matchBase(r), match: it.casamento, channels: [], origin: 'ia', note: null };
    }
    const idx = it.canal_cliente_idx;
    const ch = typeof idx === 'number' ? channels.get(idx) : undefined;
    if (!ch) return fail(`canal_cliente_idx fora da lista (${JSON.stringify(idx)})`);
    if (ch.facts.vod) return fail(`canal ${idx} é VOD, não é transmissão ao vivo`);
    if (ch.country !== null && ch.country !== r.country && it.casamento !== 'feed_generico')
      return fail(`canal ${idx} é de ${ch.country}: só casaria como feed_generico`);
    if (r.access === 'streaming' && it.casamento === 'exato')
      return fail(`direito só de streaming não casa exato com o canal linear ${idx}`);
    const other =
      dict.resolve(r.country, ch.facts) ?? (ch.country ? dict.resolve(ch.country, ch.facts) : null);
    if (other && other !== r.broadcasterId) return fail(`canal ${idx} é de outra emissora (${other})`);
    // nota só em feed_generico e nome_divergente (como no schema validado); na divergência, obrigatória
    const given =
      typeof it.nota_auditoria === 'string' && it.nota_auditoria.trim()
        ? it.nota_auditoria.replace(/\s+/g, ' ').trim().slice(0, AI_NOTE_MAX)
        : null;
    const note =
      it.casamento === 'nome_divergente'
        ? (given ?? 'Nome divergente (IA).')
        : it.casamento === 'feed_generico'
          ? given
          : null;
    return { ...matchBase(r), match: it.casamento, channels: [idx!], origin: 'ia', note };
  });
  return { matches, violations };
}
