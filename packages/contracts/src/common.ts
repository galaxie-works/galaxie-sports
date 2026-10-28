import 'zod-openapi';
import * as z from 'zod';

/** Versão estável da API canônica. */
export const API_VERSION = 'v1' as const;

/** Locales suportados pela API (docs/05 §1). */
export const SUPPORTED_LOCALES = [
  'pt-BR',
  'es-AR',
  'es-MX',
  'es-CO',
  'es-CL',
  'es-PE',
  'es-UY',
  'es-EC',
] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

/** Locale usado quando o cliente não informa `?locale` nem `Accept-Language` compatível. */
export const DEFAULT_LOCALE: SupportedLocale = 'pt-BR';

/** Códigos de erro (docs/05 §6). */
export const ERROR_CODES = [
  'INVALID_PARAMS',
  'INVALID_KEY',
  'MODULE_NOT_IN_PLAN',
  'MARKET_NOT_IN_PLAN',
  /** Chave publicável usada de uma origem fora de `allowed_origins` (ou sem Origin/Referer). */
  'ORIGIN_NOT_ALLOWED',
  /** Chave publicável em rota que ela não alcança (escrita, conta, admin, SSE, espelho). */
  'PUBLISHABLE_KEY_NOT_ALLOWED',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  /** Cota diária do plano passou de 110% (volta na virada do dia UTC). */
  'QUOTA_EXCEEDED',
  'DEGRADED',
  /** Stack em atualização (deploy ou reinício): resposta do serviço de manutenção, não da API. */
  'MAINTENANCE',
  'INTERNAL_ERROR',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

/** Erro no formato RFC 9457 (`application/problem+json`). */
export const Problem = z
  .object({
    type: z.string().meta({ example: 'https://docs.galaxie.sports/errors/invalid-key' }),
    title: z.string().meta({ example: 'Chave de API ausente ou inválida' }),
    status: z.number().int(),
    code: z.enum(ERROR_CODES),
    detail: z.string().optional(),
    instance: z.string().optional(),
    /** Detalhes de validação (INVALID_PARAMS). */
    errors: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  })
  .meta({ id: 'Problem', description: 'Erro RFC 9457 (application/problem+json)' });
export type Problem = z.infer<typeof Problem>;

const isTimeZone = (tz: string) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

/** Parâmetros aceitos por todas as rotas /v1. */
export const LocaleQuery = z.object({
  locale: z
    .enum(SUPPORTED_LOCALES)
    .optional()
    .meta({ description: 'Locale da resposta (tem precedência sobre Accept-Language).', example: 'es-AR' }),
  tz: z.string().refine(isTimeZone, 'fuso horário IANA inválido').optional().meta({
    description: 'Fuso IANA para datas/horas da resposta (padrão UTC).',
    example: 'America/Sao_Paulo',
  }),
});
export type LocaleQuery = z.infer<typeof LocaleQuery>;

export const PaginationQuery = z.object({
  cursor: z.string().max(512).optional().meta({ description: 'Cursor opaco devolvido em `next_cursor`.' }),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(200)
    .default(50)
    .meta({ description: 'Itens por página (1–200).' }),
});

/** Lista paginada por cursor: `{ data, next_cursor }`. */
export const page = <T extends z.ZodType>(item: T) =>
  z.object({
    data: z.array(item),
    next_cursor: z.string().nullable().meta({ description: 'null quando não há mais páginas.' }),
  });

/** Lista completa (sem paginação). */
export const list = <T extends z.ZodType>(item: T) => z.object({ data: z.array(item) });

export const AssetUrl = z
  .url()
  .nullable()
  .meta({ description: 'URL no nosso storage quando o asset já foi espelhado; senão, a URL de origem.' });

export const LogoSource = z.enum(['provider', 'acervo', 'commons']).nullable().meta({
  id: 'LogoSource',
  description:
    'De onde vem o `logo`: `provider` = o fornecedor de dados; `acervo` = acervo customizado de logos em alta (ligado pela operação); `commons` = arquivo de licença livre da Wikimedia Commons, quando o fornecedor não tem logo (crédito em `logo_credit`). null quando não há logo.',
});
export type LogoSource = z.infer<typeof LogoSource>;

/** Crédito de um logo vindo da Wikimedia Commons (arquivo de licença livre): plataformas e competições. */
export const LogoCredit = z
  .object({
    source: z.literal('Wikimedia Commons'),
    title: z.string().meta({ example: 'File:Logo de exemplo.svg' }),
    page_url: z.url().meta({ description: 'Página do arquivo na Commons (autor, licença e histórico).' }),
    author: z.string().nullable(),
    license: z.string().meta({ example: 'Public domain' }),
    license_url: z.url().nullable(),
    attribution_required: z.boolean().meta({
      description: 'A licença exige o crédito junto do logo (CC BY, CC BY-SA); domínio público não exige.',
    }),
    attribution: z
      .string()
      .nullable()
      .meta({
        description:
          'Atribuição pedida pelo autor (campo `Attribution` da Commons, sem HTML), quando o arquivo pede: é a linha ' +
          'que a licença manda exibir, e o `text` já a usa. null quando não há.',
        example: 'Fulano / Exemplo FC',
      }),
    text: z.string().meta({
      description:
        'Atribuição pronta para exibir (ou para o `title` do logo, quando não é exigida): com `attribution`, ' +
        '"Logo: <attribution> · <licença>"; sem ela, autor, Wikimedia Commons e licença.',
      example: 'Logo: Wikimedia Commons · Public domain',
    }),
  })
  .meta({ id: 'LogoCredit' });
export type LogoCredit = z.infer<typeof LogoCredit>;

export const CountryRef = z
  .object({ code: z.string().meta({ example: 'BR' }), name: z.string().meta({ example: 'Brasil' }) })
  .meta({ id: 'CountryRef' });

/** Nome de exibição de um time no idioma da resposta (mesma regra em todas as rotas). */
export const TeamDisplayName = z.string().meta({
  description:
    'Nome de exibição no idioma da resposta: o rótulo da base semântica (ou o nome curto curado) quando o time tem perfil; senão o nome do fornecedor, com os acentos corrigidos por uma lista fixa nos países de língua portuguesa e espanhola.',
  example: 'São Paulo',
});

/** Nome do time como o fornecedor manda, sem a curadoria nem o corretor de acentos. */
export const ProviderName = z
  .string()
  .optional()
  .meta({ description: 'Nome do time como o fornecedor manda (sem curadoria).', example: 'Sao Paulo' });
