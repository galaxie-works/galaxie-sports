import { SUPPORTED_LOCALES } from '@galaxie/contracts';
import type { Metadata } from 'next';

import { CodeTabs } from '@/components/docs/code-tabs';
import {
  Bullets,
  Callout,
  docLink,
  docMetadata,
  DocPage,
  DocSection,
  DocTable,
  docText,
  P,
} from '@/components/docs/doc-blocks';
import { docRequests, SAMPLE } from '@/lib/docs';
import {
  apiKeyPlaceholder,
  PUBLIC_API_URL,
  requestSnippets,
  type ApiRequest,
  type CodeExample,
} from '@/lib/galaxie/request';
import type { Locale } from '@/lib/i18n/config';
import type { Dictionary } from '@/lib/i18n/dictionary';
import { getI18n } from '@/lib/i18n/server';

export function generateMetadata(): Promise<Metadata> {
  return docMetadata('concepts');
}

type Text = Dictionary['docs']['concepts'];

const TEAM_URL = `${PUBLIC_API_URL}/v1/teams/${SAMPLE.team}`;

function etagExamples(key: string, c: Text['cache']['code']): CodeExample[] {
  return [
    {
      label: 'curl',
      language: 'bash',
      code: `# ${c.first}
curl -i "${TEAM_URL}" -H "x-galaxie-key: ${key}"
# etag: "HdIdTHJ-ofqmCdMUs7R48Kcgx9o"
# cache-control: public, max-age=300, s-maxage=86400, stale-while-revalidate=60

# ${c.revalidate}
curl -i "${TEAM_URL}" -H "x-galaxie-key: ${key}" \\
  -H 'If-None-Match: "HdIdTHJ-ofqmCdMUs7R48Kcgx9o"'`,
    },
    {
      label: 'TypeScript',
      language: 'typescript',
      code: `const cache = new Map<string, { etag: string; body: unknown }>();

async function getCached(url: string, key: string) {
  const hit = cache.get(url);
  const res = await fetch(url, {
    headers: { 'x-galaxie-key': key, ...(hit ? { 'if-none-match': hit.etag } : {}) },
  });
  if (res.status === 304 && hit) return hit.body; // ${c.unchanged}
  const body = await res.json();
  const etag = res.headers.get('etag');
  if (etag) cache.set(url, { etag, body });
  return body;
}

const team = await getCached('${TEAM_URL}', process.env.GALAXIE_KEY ?? '${key}');`,
    },
    {
      label: 'Python',
      language: 'python',
      code: `import os

import requests

cache: dict[str, tuple[str, dict]] = {}


def get_cached(url: str, key: str) -> dict:
    headers = {"x-galaxie-key": key}
    if url in cache:
        headers["If-None-Match"] = cache[url][0]
    resp = requests.get(url, headers=headers, timeout=10)
    if resp.status_code == 304:
        return cache[url][1]  # ${c.unchanged}
    resp.raise_for_status()
    body = resp.json()
    if "ETag" in resp.headers:
        cache[url] = (resp.headers["ETag"], body)
    return body


team = get_cached("${TEAM_URL}", os.environ.get("GALAXIE_KEY", "${key}"))`,
    },
  ];
}

function paginationExamples(key: string, c: Text['pagination']['code']): CodeExample[] {
  return [
    {
      label: 'curl',
      language: 'bash',
      code: `# ${c.first}
curl "${PUBLIC_API_URL}/v1/competitions?sport=football&country=BR&limit=50" \\
  -H "x-galaxie-key: ${key}"
# { "data": [ … ], "next_cursor": "eyJ0Ijox…" }

# ${c.next}
curl "${PUBLIC_API_URL}/v1/competitions?sport=football&country=BR&limit=50&cursor=eyJ0Ijox…" \\
  -H "x-galaxie-key: ${key}"`,
    },
    {
      label: 'TypeScript',
      language: 'typescript',
      code: `/** ${c.paginate} */
async function* paginate<T>(path: string, query: Record<string, string>, key: string) {
  let cursor: string | null = null;
  do {
    const url = new URL(path, '${PUBLIC_API_URL}');
    url.search = new URLSearchParams({ ...query, ...(cursor ? { cursor } : {}) }).toString();
    const res = await fetch(url, { headers: { 'x-galaxie-key': key } });
    if (!res.ok) throw new Error(\`HTTP \${res.status}\`);
    const page: { data: T[]; next_cursor: string | null } = await res.json();
    yield* page.data;
    cursor = page.next_cursor;
  } while (cursor);
}

for await (const competition of paginate('/v1/competitions', { sport: 'football', country: 'BR', limit: '200' }, process.env.GALAXIE_KEY ?? '${key}')) {
  console.log(competition);
}`,
    },
    {
      label: 'Python',
      language: 'python',
      code: `import os

import requests


def paginate(path: str, params: dict, key: str):
    """${c.paginate}"""
    cursor = None
    while True:
        resp = requests.get(
            f"${PUBLIC_API_URL}{path}",
            params={**params, **({"cursor": cursor} if cursor else {})},
            headers={"x-galaxie-key": key},
            timeout=10,
        )
        resp.raise_for_status()
        page = resp.json()
        yield from page["data"]
        cursor = page["next_cursor"]
        if not cursor:
            break


key = os.environ.get("GALAXIE_KEY", "${key}")
for competition in paginate("/v1/competitions", {"sport": "football", "country": "BR", "limit": 200}, key):
    print(competition["slug"])`,
    },
  ];
}

function errorExamples(c: Text['errors']['code']): CodeExample[] {
  return [
    {
      label: 'TypeScript',
      language: 'typescript',
      code: `const res = await fetch(url, { headers: { 'x-galaxie-key': key } });
if (!res.ok) {
  const problem = await res.json(); // application/problem+json
  switch (problem.code) {
    case 'NOT_FOUND':
      return null; // ${c.notFound}
    case 'MODULE_NOT_IN_PLAN':
    case 'MARKET_NOT_IN_PLAN':
      throw new Error(\`${c.outsidePlan}: \${problem.title}\`);
    case 'RATE_LIMITED':
      // ${c.retry}
      break;
    case 'INVALID_PARAMS':
      console.error(problem.errors); // [{ path, message }]
      break;
  }
  throw new Error(\`\${problem.status} \${problem.code}: \${problem.title}\`);
}`,
    },
    {
      label: 'Python',
      language: 'python',
      code: `resp = requests.get(url, headers={"x-galaxie-key": key}, timeout=10)
if not resp.ok:
    problem = resp.json()  # application/problem+json
    if problem["code"] == "NOT_FOUND":
        return None  # ${c.notFound}
    if problem["code"] in ("MODULE_NOT_IN_PLAN", "MARKET_NOT_IN_PLAN"):
        raise PermissionError(f"${c.outsidePlan}: {problem['title']}")
    if problem["code"] == "INVALID_PARAMS":
        print(problem.get("errors"))  # [{"path": ..., "message": ...}]
    raise RuntimeError(f"{problem['status']} {problem['code']}: {problem['title']}")`,
    },
  ];
}

const NOT_FOUND_SAMPLE = `{
  "type": "https://docs.galaxie.sports/errors/not-found",
  "title": "Evento não encontrado",
  "status": 404,
  "code": "NOT_FOUND",
  "instance": "/v1/events/01a163b8-0000-7000-8000-000000000000"
}`;

/** TTL por tipo de dado (os nomes ficam em `t.docs.concepts.cache[tipo]`). */
const CACHE_ROWS = ['catalog', 'squads', 'today', 'live', 'whereToWatch', 'ai', 'semantic', 'images'] as const;

const ERROR_ROWS = [
  ['400 INVALID_PARAMS', 'invalidParams'],
  ['401 INVALID_KEY', 'invalidKey'],
  ['403 MODULE_NOT_IN_PLAN', 'moduleNotInPlan'],
  ['403 MARKET_NOT_IN_PLAN', 'marketNotInPlan'],
  ['404 NOT_FOUND', 'notFound'],
  ['429 RATE_LIMITED', 'rateLimited'],
  ['503 DEGRADED', 'degraded'],
  ['503 MAINTENANCE', 'maintenance'],
  ['500 INTERNAL_ERROR', 'internal'],
] as const;

/** País do mercado de um locale, no idioma da tela (`es-MX` → "México" / "Mexico"). */
function marketName(apiLocale: string, locale: Locale): string {
  const region = apiLocale.split('-')[1];
  return (region && new Intl.DisplayNames([locale], { type: 'region' }).of(region)) || apiLocale;
}

export default async function ConceptsPage() {
  const i18n = await getI18n();
  const { locale, t } = i18n;
  const text = t.docs.concepts;
  const key = apiKeyPlaceholder(locale);
  const requests = docRequests(i18n);
  const snippets = (req: ApiRequest) => requestSnippets(req, PUBLIC_API_URL, locale);

  return (
    <DocPage href="/docs/conceitos" title={t.code.docsNav.concepts.label} lead={text.lead}>
      <DocSection id="ids" title={text.ids.title}>
        <P>{text.ids.body}</P>
        <Bullets
          items={[
            docText(text.ids.competitions, {}, { path: `/v1/competitions/${SAMPLE.competition}` }),
            docText(text.ids.derbies, {}, { path: `/v1/derbies/${SAMPLE.derby}` }),
            docText(text.ids.externalIds),
            docText(text.ids.links),
          ]}
        />
      </DocSection>

      <DocSection id="locales" title={text.locales.title}>
        <P>{docText(text.locales.body)}</P>
        <DocTable
          head={[text.locales.headLocale, text.locales.headMarket]}
          rows={SUPPORTED_LOCALES.map((l) => [l, marketName(l, locale)])}
        />
        <P>{text.locales.argentina}</P>
        <CodeTabs examples={snippets(requests.competitionEs)} />
        <Callout title={text.locales.fallbackTitle}>{docText(text.locales.fallback)}</Callout>
      </DocSection>

      <DocSection id="cache" title={text.cache.title}>
        <P>{docText(text.cache.body)}</P>
        <DocTable
          head={[text.cache.headResource, text.cache.headTtl]}
          mono={false}
          rows={CACHE_ROWS.map((row) => [text.cache[row].name, text.cache[row].ttl])}
        />
        <CodeTabs examples={etagExamples(key, text.cache.code)} />
        <P>{docText(text.cache.purge, { a: docLink('/docs/tempo-real') })}</P>
      </DocSection>

      <DocSection id="paginacao" title={text.pagination.title}>
        <P>
          {docText(
            text.pagination.body,
            {},
            { page: '{ "data": [...], "next_cursor": "..." }', list: '{ "data": [...] }' },
          )}
        </P>
        <CodeTabs examples={paginationExamples(key, text.pagination.code)} />
        <Callout title={text.pagination.calloutTitle}>{text.pagination.callout}</Callout>
      </DocSection>

      <DocSection id="erros" title={text.errors.title}>
        <P>{docText(text.errors.body)}</P>
        <CodeTabs title="404 Not Found" examples={[{ label: 'JSON', language: 'json', code: NOT_FOUND_SAMPLE }]} />
        <DocTable
          head={[text.errors.headStatus, text.errors.headWhen]}
          rows={ERROR_ROWS.map(([status, row]) => [status, text.errors[row]])}
        />
        <CodeTabs examples={errorExamples(text.errors.code)} />
      </DocSection>

      <DocSection id="versionamento" title={text.versioning.title}>
        <Bullets
          items={[docText(text.versioning.stable), text.versioning.newFields, docText(text.versioning.missing)]}
        />
      </DocSection>
    </DocPage>
  );
}
