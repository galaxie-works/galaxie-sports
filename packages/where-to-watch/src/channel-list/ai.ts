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

/** Canais por pedido (os de fora ficam para o próximo processamento, com nota). */
export const AI_MAX_CHANNELS = 400;
export const AI_NOTE_MAX = 200;

/** Um pedido à IA: as sobras de um país. */
export interface AiBatch {
  country: WtwCountry;
  /** `direito_idx` = posição aqui. */
  rights: ChannelRight[];
  /** `canal_cliente_idx` = índice do canal na lista do cliente. */
  channels: ResolvedChannel[];
  /** Canais do país que ficaram de fora pelo limite. */
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
 * País sem par possível não vai para a IA.
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
    const pairedRights = countryRights.filter((r) => open.some((c) => shares(r, c)));
    const candidates = open.filter((c) => pairedRights.some((r) => shares(r, c)));
    if (!pairedRights.length || !candidates.length) continue;
    out.push({
      country,
      rights: pairedRights,
      channels: candidates.slice(0, AI_MAX_CHANNELS),
      omittedChannels: Math.max(0, candidates.length - AI_MAX_CHANNELS),
    });
  }
  return out;
}

export const CHANNEL_MATCH_SCHEMA_NAME = 'casamento_canais_cliente';

/** Schema da saída: só índices (em enum, do próprio pedido) e o tipo de casamento. */
export function channelMatchSchema(batch: AiBatch): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['casamentos'],
    properties: {
      casamentos: {
        type: 'array',
        description: 'Exatamente um item por direito da entrada, na ordem de direito_idx.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['direito_idx', 'canal_cliente_idx', 'casamento', 'nota_auditoria'],
          properties: {
            direito_idx: { type: 'integer', enum: batch.rights.map((_, i) => i) },
            canal_cliente_idx: {
              type: ['integer', 'null'],
              enum: [...batch.channels.map((c) => c.facts.idx), null],
              description: 'Índice do canal do cliente; null quando casamento = sem_canal_na_lista.',
            },
            casamento: { type: 'string', enum: [...CHANNEL_MATCH_KINDS] },
            nota_auditoria: {
              type: ['string', 'null'],
              description: 'Só em nome_divergente: por que o nome diverge (até 200 caracteres). Senão, null.',
            },
          },
        },
      },
    },
  };
}

export interface ChannelMatchOutput {
  casamentos: {
    direito_idx: number;
    canal_cliente_idx: number | null;
    casamento: ChannelMatchKind;
    nota_auditoria: string | null;
  }[];
}

export const CHANNEL_MATCH_SYSTEM = [
  'Você casa direitos de transmissão de futebol com os canais da lista de uma operadora de TV.',
  'Responda só com índices e enums do schema: nunca escreva nome de plataforma, de canal ou de plano.',
  'Cada direito da entrada volta exatamente uma vez, com o seu direito_idx.',
  'Tipos de casamento:',
  '- exato: o canal é a emissora do direito no mesmo país. Marca de praça ou afiliada (SP, RJ, |SP|) não muda nada: é exato.',
  '- feed_generico: canal pan-regional ou de outro país da mesma emissora, sem o feed do país na lista.',
  '- nome_divergente: mesma marca com sufixo diferente (ex.: "CHILEVISION SPORTS" para o sinal aberto Chilevisión). Explique em nota_auditoria. Marca de praça não conta como sufixo.',
  '- sem_canal_na_lista: nenhum canal da lista é a emissora do direito (canal_cliente_idx = null).',
  'Regras:',
  '- Direito com acesso "streaming" nunca casa exato com canal linear.',
  '- Canal com "VOD" não é transmissão ao vivo: nunca casa.',
  '- Canal de outro país só casa como feed_generico.',
  '- Na dúvida, sem_canal_na_lista.',
].join('\n');

/** Mensagem do usuário: direitos e canais numerados (o país e o acesso vêm do dicionário, nunca da IA). */
export function channelMatchInput(batch: AiBatch): string {
  return JSON.stringify({
    pais: batch.country,
    direitos: batch.rights.map((r, i) => ({
      direito_idx: i,
      pais: r.country,
      plataforma_id: r.broadcasterId,
      nome: r.name,
      acesso: r.access,
    })),
    canais_cliente: batch.channels.map((c) => ({
      canal_cliente_idx: c.facts.idx,
      nome: c.facts.name,
      pais: c.country,
    })),
  });
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
  const items = Array.isArray((output as ChannelMatchOutput | null)?.casamentos)
    ? (output as ChannelMatchOutput).casamentos
    : [];
  if (!items.length) violations.push('saída sem a lista "casamentos"');
  const byRight = new Map<number, ChannelMatchOutput['casamentos']>();
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
    const note =
      it.casamento === 'nome_divergente'
        ? typeof it.nota_auditoria === 'string' && it.nota_auditoria.trim()
          ? it.nota_auditoria.replace(/\s+/g, ' ').trim().slice(0, AI_NOTE_MAX)
          : 'Nome divergente (IA).'
        : null;
    return { ...matchBase(r), match: it.casamento, channels: [idx!], origin: 'ia', note };
  });
  return { matches, violations };
}
