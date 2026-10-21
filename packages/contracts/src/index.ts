/** Versão estável da API canônica. Contratos Zod → OpenAPI chegam na issue de OpenAPI. */
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
