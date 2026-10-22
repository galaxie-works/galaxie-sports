/**
 * Descrição de uma chamada à API pública e os exemplos de código gerados a partir dela (curl,
 * TypeScript e Python). Módulo puro: serve tanto às páginas (servidor) quanto ao botão "Ver código"
 * (navegador). Os descritores das páginas ficam ao lado dos fetchers, em `api.ts`.
 */
import { DEFAULT_LOCALE, type Locale } from '../i18n/config';

export type ApiQueryValue = string | number | boolean;

export interface ApiRequest {
  method: 'GET';
  /** Rota como está no OpenAPI, com os parâmetros entre chaves (ex.: `/v1/teams/{id}/overview`). */
  route: string;
  /** Valores dos parâmetros de caminho (`{id}` → `params.id`). */
  params?: Record<string, string | number>;
  /** Query string, na ordem em que deve aparecer nos exemplos. */
  query?: Record<string, ApiQueryValue | undefined>;
  /** O que a chamada devolve (uma frase). */
  description: string;
  /** Observação de uso (paginação, módulo exigido…). */
  note?: string;
}

/** Um exemplo de código numa aba (curl, TypeScript, Python, JSON…). */
export interface CodeExample {
  /** Rótulo da aba. */
  label: string;
  /** Linguagem do realce (`bash`, `typescript`, `python`, `json`…). */
  language: string;
  code: string;
}

/**
 * URL base da API pública mostrada na documentação e nos exemplos. Embutida no build (NEXT_PUBLIC_*);
 * o padrão é a API de produção.
 */
export const PUBLIC_API_URL = (
  process.env.NEXT_PUBLIC_GALAXIE_DOCS_API_URL || 'https://api.sports.galaxie.works'
).replace(/\/+$/, '');

/**
 * Textos dentro dos exemplos gerados (a chave de exemplo e os comentários), no idioma da tela. Ficam
 * aqui, e não no dicionário, para o módulo seguir puro e leve no navegador.
 */
const SNIPPET_TEXT: Record<Locale, { key: string; problem: string; raise: string }> = {
  'pt-BR': {
    key: 'SUA_CHAVE',
    problem: 'Erros seguem a RFC 9457 (application/problem+json)',
    raise: '4xx/5xx: corpo em application/problem+json',
  },
  en: {
    key: 'YOUR_KEY',
    problem: 'Errors follow RFC 9457 (application/problem+json)',
    raise: '4xx/5xx: body in application/problem+json',
  },
  'es-AR': {
    key: 'TU_CLAVE',
    problem: 'Los errores siguen la RFC 9457 (application/problem+json)',
    raise: '4xx/5xx: cuerpo en application/problem+json',
  },
};

/** Nunca uma chave real nos exemplos: um marcador no idioma da tela (`SUA_CHAVE`, `YOUR_KEY`, `TU_CLAVE`). */
export function apiKeyPlaceholder(locale: Locale = DEFAULT_LOCALE): string {
  return SNIPPET_TEXT[locale].key;
}

/** Marcador da chave em pt-BR (use `apiKeyPlaceholder(locale)` nas telas). */
export const API_KEY_PLACEHOLDER = apiKeyPlaceholder();

/** Caminho com os parâmetros preenchidos (e codificados). */
export function requestPath(req: Pick<ApiRequest, 'route' | 'params'>): string {
  return req.route.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = req.params?.[name];
    return value === undefined ? match : encodeURIComponent(String(value));
  });
}

/** Pares da query string, sem os valores ausentes. */
export function requestQuery(req: Pick<ApiRequest, 'query'>): [string, string][] {
  return Object.entries(req.query ?? {})
    .filter((entry): entry is [string, ApiQueryValue] => entry[1] !== undefined && entry[1] !== '')
    .map(([k, v]) => [k, String(v)]);
}

/** `?a=1&b=2` (vazio sem query). */
export function requestSearch(req: Pick<ApiRequest, 'query'>): string {
  const qs = new URLSearchParams(requestQuery(req)).toString();
  return qs ? `?${qs}` : '';
}

export function requestUrl(
  req: Pick<ApiRequest, 'route' | 'params' | 'query'>,
  base = PUBLIC_API_URL,
): string {
  return `${base}${requestPath(req)}${requestSearch(req)}`;
}

/** Âncora da operação na página de referência (ex.: `get-v1-teams-id-overview`). */
export function operationAnchor(method: string, route: string): string {
  return `${method}-${route}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

const pyString = (s: string) => JSON.stringify(s);
const tsString = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

/**
 * Os três exemplos da chamada: curl, TypeScript (`fetch`) e Python (`requests`), com a chave de
 * exemplo e os comentários no idioma da tela (`locale`; sem ele, pt-BR).
 */
export function requestSnippets(
  req: ApiRequest,
  base = PUBLIC_API_URL,
  locale: Locale = DEFAULT_LOCALE,
): CodeExample[] {
  const path = requestPath(req);
  const query = requestQuery(req);
  const text = SNIPPET_TEXT[locale];

  const curl = [`curl "${requestUrl(req, base)}" \\`, `  -H "x-galaxie-key: ${text.key}"`].join('\n');

  const tsQuery = query.length
    ? [
        `url.search = new URLSearchParams({`,
        ...query.map(([k, v]) => `  ${/^[a-z_]\w*$/i.test(k) ? k : tsString(k)}: ${tsString(v)},`),
        `}).toString();`,
      ]
    : [];
  const typescript = [
    `const GALAXIE_KEY = process.env.GALAXIE_KEY ?? ${tsString(text.key)};`,
    ``,
    `const url = new URL(${tsString(path)}, ${tsString(base)});`,
    ...tsQuery,
    ``,
    `const res = await fetch(url, { headers: { 'x-galaxie-key': GALAXIE_KEY } });`,
    `if (!res.ok) {`,
    `  // ${text.problem}`,
    `  const problem = await res.json();`,
    '  throw new Error(`${problem.status} ${problem.code}: ${problem.title}`);',
    `}`,
    `const data = await res.json();`,
  ].join('\n');

  const python = [
    `import os`,
    ``,
    `import requests`,
    ``,
    `GALAXIE_KEY = os.environ.get("GALAXIE_KEY", ${pyString(text.key)})`,
    ``,
    `resp = requests.get(`,
    `    ${pyString(`${base}${path}`)},`,
    ...(query.length
      ? [`    params={`, ...query.map(([k, v]) => `        ${pyString(k)}: ${pyString(v)},`), `    },`]
      : []),
    `    headers={"x-galaxie-key": GALAXIE_KEY},`,
    `    timeout=10,`,
    `)`,
    `resp.raise_for_status()  # ${text.raise}`,
    `data = resp.json()`,
  ].join('\n');

  return [
    { label: 'curl', language: 'bash', code: curl },
    { label: 'TypeScript', language: 'typescript', code: typescript },
    { label: 'Python', language: 'python', code: python },
  ];
}
