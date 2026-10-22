import 'zod-openapi';
import * as z from 'zod';
import { ParticipantRef } from './catalog.js';
import { AssetUrl, LocaleQuery } from './common.js';
import { EVENT_STATUSES } from './events.js';

// ─── busca global (docs/05 §3.6) ─────────────────────────────────────────────────────────────────

// Pares acentuado → sem acento, nas duas caixas (a API usa os mesmos no `translate` do Postgres).
export const SEARCH_ACCENTED = 'áàâãäåāéèêëēíìîïīóòôõöøōúùûüūçñýÁÀÂÃÄÅĀÉÈÊËĒÍÌÎÏĪÓÒÔÕÖØŌÚÙÛÜŪÇÑÝ';
export const SEARCH_PLAIN = 'aaaaaaaeeeeeiiiiiooooooouuuuucnyAAAAAAAEEEEEIIIIIOOOOOOOUUUUUCNY';

/**
 * Texto como a busca compara: sem acento, em minúsculas e com os espaços normalizados ("  São
 * Paulo" → "sao paulo"). Clientes podem usar a mesma regra para filtrar listas locais.
 */
export function foldSearchText(value: string): string {
  let out = '';
  for (const ch of value) {
    const i = SEARCH_ACCENTED.indexOf(ch);
    out += i >= 0 ? SEARCH_PLAIN[i] : ch;
  }
  return out.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Tipos de resultado da busca, na ordem de exibição sugerida quando o placar empata. */
export const SEARCH_TYPES = ['team', 'competition', 'event', 'person', 'venue', 'country'] as const;
export type SearchType = (typeof SEARCH_TYPES)[number];

/** Como o termo casou: nome inteiro, começo do nome (ou de uma palavra) ou trecho. */
export const SEARCH_MATCHES = ['exact', 'prefix', 'contains'] as const;
export type SearchMatch = (typeof SEARCH_MATCHES)[number];

const typeList = z
  .string()
  .max(120)
  .transform((v, ctx) => {
    const items = [
      ...new Set(
        v
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      ),
    ];
    for (const s of items) {
      if (!(SEARCH_TYPES as readonly string[]).includes(s)) {
        ctx.addIssue({ code: 'custom', message: `tipo desconhecido: ${s}` });
        return z.NEVER;
      }
    }
    return items as SearchType[];
  })
  .meta({
    description: `Tipos separados por vírgula (padrão: todos): ${SEARCH_TYPES.join(', ')}.`,
    example: 'team,competition',
  });

export const SearchQuery = LocaleQuery.extend({
  q: z.string().trim().min(2).max(80).meta({
    description:
      'Termo (≥ 2 caracteres), sem diferença de caixa nem de acento: nome, apelido, sigla ou nome anterior.',
    example: 'verdao',
  }),
  types: typeList.optional(),
  sport: z.string().max(40).optional().meta({ description: 'Só times, competições e jogos deste esporte.' }),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(20)
    .default(5)
    .meta({ description: 'Máximo de resultados por tipo (1–20, padrão 5).' }),
});
export type SearchQuery = z.input<typeof SearchQuery>;

export const SearchResult = z
  .object({
    type: z.enum(SEARCH_TYPES),
    id: z.string().meta({
      description: 'UUID da entidade; código do país em `country` (ex.: `BR`).',
      example: '01a15fba-ec17-7d8b-90d7-47b3ccbe967e',
    }),
    slug: z.string().nullable().meta({ description: 'Slug da competição; null nos outros tipos.' }),
    name: z.string().meta({ description: 'Nome para exibição, no locale pedido.', example: 'Palmeiras' }),
    matched: z.string().nullable().meta({
      description: 'Apelido, sigla ou nome anterior que casou com o termo; null quando foi o próprio nome.',
      example: 'Verdão',
    }),
    match: z.enum(SEARCH_MATCHES),
    sport: z.string().nullable().meta({ example: 'football' }),
    country: z.string().nullable().meta({ description: 'Código do país da entidade.', example: 'BR' }),
    image: AssetUrl.meta({ description: 'Escudo, logo, foto, imagem do estádio ou bandeira.' }),
    detail: z.string().nullable().meta({
      description:
        'Contexto curto: país do time, time atual da pessoa, cidade do estádio, competição do jogo…',
      example: 'Brasil',
    }),
    event: z
      .object({
        starts_at: z.iso.datetime({ offset: true }),
        status: z.enum(EVENT_STATUSES),
        live: z.boolean().meta({ description: 'Em andamento agora (mesma regra de `/v1/events/live`).' }),
        competition: z.string().nullable(),
        participants: z.array(ParticipantRef),
      })
      .nullable()
      .meta({
        description: 'Só nos resultados `event`: jogos ao vivo e dos próximos 14 dias dos times encontrados.',
      }),
  })
  .meta({ id: 'SearchResult' });
export type SearchResult = z.infer<typeof SearchResult>;

export const SearchResponse = z
  .object({
    q: z.string().meta({ description: 'Termo como foi buscado (sem espaços nas pontas).' }),
    data: z.array(SearchResult).meta({
      description:
        'Resultados de todos os tipos numa lista só, do melhor casamento para o pior (exato, começo, trecho); ' +
        'no empate, a ordem de `types` e a relevância de cada tipo.',
    }),
  })
  .meta({ id: 'SearchResponse' });
export type SearchResponse = z.infer<typeof SearchResponse>;
