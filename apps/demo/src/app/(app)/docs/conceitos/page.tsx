import { SUPPORTED_LOCALES } from '@galaxie/contracts';
import type { Metadata } from 'next';
import Link from 'next/link';

import { CodeTabs } from '@/components/docs/code-tabs';
import { Bullets, C, Callout, DocPage, DocSection, DocTable, P } from '@/components/docs/doc-blocks';
import { DOC_REQUESTS, SAMPLE } from '@/lib/docs';
import { API_KEY_PLACEHOLDER, PUBLIC_API_URL, requestSnippets, type CodeExample } from '@/lib/galaxie/request';

export const metadata: Metadata = { title: 'Conceitos · Documentação' };

const TEAM_URL = `${PUBLIC_API_URL}/v1/teams/${SAMPLE.team}`;

const ETAG: CodeExample[] = [
  {
    label: 'curl',
    language: 'bash',
    code: `# 1ª chamada: guarde o ETag
curl -i "${TEAM_URL}" -H "x-galaxie-key: ${API_KEY_PLACEHOLDER}"
# etag: "HdIdTHJ-ofqmCdMUs7R48Kcgx9o"
# cache-control: public, max-age=300, s-maxage=86400, stale-while-revalidate=60

# Revalidação: 304 sem corpo enquanto nada mudou
curl -i "${TEAM_URL}" -H "x-galaxie-key: ${API_KEY_PLACEHOLDER}" \\
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
  if (res.status === 304 && hit) return hit.body; // nada mudou: reaproveita
  const body = await res.json();
  const etag = res.headers.get('etag');
  if (etag) cache.set(url, { etag, body });
  return body;
}

const team = await getCached('${TEAM_URL}', process.env.GALAXIE_KEY ?? '${API_KEY_PLACEHOLDER}');`,
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
        return cache[url][1]  # nada mudou: reaproveita
    resp.raise_for_status()
    body = resp.json()
    if "ETag" in resp.headers:
        cache[url] = (resp.headers["ETag"], body)
    return body


team = get_cached("${TEAM_URL}", os.environ.get("GALAXIE_KEY", "${API_KEY_PLACEHOLDER}"))`,
  },
];

const PAGINATION: CodeExample[] = [
  {
    label: 'curl',
    language: 'bash',
    code: `# 1ª página
curl "${PUBLIC_API_URL}/v1/competitions?sport=football&country=BR&limit=50" \\
  -H "x-galaxie-key: ${API_KEY_PLACEHOLDER}"
# { "data": [ … ], "next_cursor": "eyJ0Ijox…" }

# Próxima: repita a mesma query com o cursor recebido
curl "${PUBLIC_API_URL}/v1/competitions?sport=football&country=BR&limit=50&cursor=eyJ0Ijox…" \\
  -H "x-galaxie-key: ${API_KEY_PLACEHOLDER}"`,
  },
  {
    label: 'TypeScript',
    language: 'typescript',
    code: `/** Percorre todas as páginas de uma lista paginada por cursor. */
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

for await (const competition of paginate('/v1/competitions', { sport: 'football', country: 'BR', limit: '200' }, process.env.GALAXIE_KEY ?? '${API_KEY_PLACEHOLDER}')) {
  console.log(competition);
}`,
  },
  {
    label: 'Python',
    language: 'python',
    code: `import os

import requests


def paginate(path: str, params: dict, key: str):
    """Percorre todas as páginas de uma lista paginada por cursor."""
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


key = os.environ.get("GALAXIE_KEY", "${API_KEY_PLACEHOLDER}")
for competition in paginate("/v1/competitions", {"sport": "football", "country": "BR", "limit": 200}, key):
    print(competition["slug"])`,
  },
];

const ERRORS: CodeExample[] = [
  {
    label: 'TypeScript',
    language: 'typescript',
    code: `const res = await fetch(url, { headers: { 'x-galaxie-key': key } });
if (!res.ok) {
  const problem = await res.json(); // application/problem+json
  switch (problem.code) {
    case 'NOT_FOUND':
      return null; // a entidade não existe (ou saiu do catálogo)
    case 'MODULE_NOT_IN_PLAN':
    case 'MARKET_NOT_IN_PLAN':
      throw new Error(\`fora do contrato: \${problem.title}\`);
    case 'RATE_LIMITED':
      // espere retry-after segundos e tente de novo
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
        return None  # a entidade não existe (ou saiu do catálogo)
    if problem["code"] in ("MODULE_NOT_IN_PLAN", "MARKET_NOT_IN_PLAN"):
        raise PermissionError(f"fora do contrato: {problem['title']}")
    if problem["code"] == "INVALID_PARAMS":
        print(problem.get("errors"))  # [{"path": ..., "message": ...}]
    raise RuntimeError(f"{problem['status']} {problem['code']}: {problem['title']}")`,
  },
];

export default function ConceptsPage() {
  return (
    <DocPage
      href="/docs/conceitos"
      title="Conceitos"
      lead="O que vale para todas as rotas: identificadores, idioma e fuso, cache, paginação, erros e versionamento."
    >
      <DocSection id="ids" title="IDs canônicos">
        <P>
          Toda entidade (competição, temporada, time, pessoa, evento, local) tem um ID próprio da Galaxie, um UUID
          estável: ele não muda quando a fonte de dados muda e é o mesmo em todos os locales. Use-o como chave
          no seu banco.
        </P>
        <Bullets
          items={[
            <>
              Competições aceitam o UUID ou o slug: <C>/v1/competitions/{SAMPLE.competition}</C>.
            </>,
            <>
              Clássicos usam o slug: <C>/v1/derbies/{SAMPLE.derby}</C>. As rotas de semântica do time aceitam o
              UUID ou o slug do perfil (<C>/v1/teams/palmeiras/semantic</C>).
            </>,
            <>
              <C>external_ids</C> (times, competições, pessoas) traz os IDs da fonte de origem, para cruzar com
              uma base que você já tenha.
            </>,
            <>
              As respostas se ligam pelos IDs: <C>participants[].id</C> do evento abre o time,{' '}
              <C>venue.id</C> abre o local, <C>competition.slug</C> abre a competição.
            </>,
          ]}
        />
      </DocSection>

      <DocSection id="locales" title="Locales e fuso horário">
        <P>
          Nomes, apelidos, fases e textos saem no idioma do mercado. Informe <C>?locale=</C> (tem precedência) ou o
          header <C>Accept-Language</C>; sem nenhum dos dois, vale <C>pt-BR</C>. A resposta traz{' '}
          <C>Content-Language</C>. Datas e horas saem em ISO 8601 no fuso de <C>?tz=</C> (qualquer fuso IANA;
          padrão UTC).
        </P>
        <DocTable
          head={['Locale', 'Mercado']}
          rows={SUPPORTED_LOCALES.map((l) => [
            l,
            {
              'pt-BR': 'Brasil',
              'es-AR': 'Argentina',
              'es-MX': 'México',
              'es-CO': 'Colômbia',
              'es-CL': 'Chile',
              'es-PE': 'Peru',
              'es-UY': 'Uruguai',
              'es-EC': 'Equador',
            }[l],
          ])}
        />
        <P>A mesma competição para o público argentino, com horários de Buenos Aires:</P>
        <CodeTabs examples={requestSnippets(DOC_REQUESTS.competitionEs)} />
        <Callout title="Fallback de idioma">
          Sem texto no locale pedido, a API tenta o idioma (<C>es-AR → es</C>) e depois o inglês; por fim, o nome
          oficial. Locale fora da lista responde <C>400 INVALID_PARAMS</C>.
        </Callout>
      </DocSection>

      <DocSection id="cache" title="Cache e ETag">
        <P>
          Toda resposta <C>200</C> traz <C>ETag</C> e <C>Cache-Control</C>. Reenvie o ETag em{' '}
          <C>If-None-Match</C>: se nada mudou, a resposta é <C>304</C> sem corpo. O TTL depende do tipo de dado:
        </P>
        <DocTable
          head={['Recurso', 'TTL na CDN']}
          mono={false}
          rows={[
            ['Países, competições, times, locais, navegação', '24 h'],
            ['Elencos e tabelas', '1 h'],
            ['Agenda do dia', '5 min'],
            ['Evento ao vivo', '5–15 s'],
            ['Onde assistir', '60 s'],
            ['Cenário e resumo de IA', '1 h'],
            ['Semântica (clássicos, perfis, glossário)', '24 h (retrospecto do clássico: 1 h)'],
            ['Imagens (logos, bandeiras, fotos)', '30 dias, imutáveis (nova versão = nova URL)'],
          ]}
        />
        <CodeTabs examples={ETAG} />
        <P>
          Mudanças importantes (placar, status, onde assistir) também purgam o cache na hora e chegam por{' '}
          <Link href="/docs/tempo-real" className="text-primary hover:underline">
            tempo real
          </Link>
          .
        </P>
      </DocSection>

      <DocSection id="paginacao" title="Paginação por cursor">
        <P>
          Listas longas (<C>/v1/events</C>, <C>/v1/competitions</C>, <C>/v1/teams</C>, jogos do time…) respondem{' '}
          <C>{'{ "data": [...], "next_cursor": "..." }'}</C>. Repita a mesma query com <C>?cursor=</C> até{' '}
          <C>next_cursor</C> vir <C>null</C>. <C>limit</C> vai de 1 a 200 (padrão 50). Listas curtas (
          <C>/v1/sports</C>, <C>/v1/countries</C>) vêm inteiras em <C>{'{ "data": [...] }'}</C>.
        </P>
        <CodeTabs examples={PAGINATION} />
        <Callout title="O cursor é opaco">
          Não monte nem altere o cursor: ele codifica a posição na ordenação pedida. Mudou um filtro, comece da
          primeira página.
        </Callout>
      </DocSection>

      <DocSection id="erros" title="Erros">
        <P>
          Erros seguem a RFC 9457 (<C>application/problem+json</C>), com um <C>code</C> estável para tratar no
          código. Respostas de erro nunca são cacheadas.
        </P>
        <CodeTabs
          title="404 Not Found"
          examples={[
            {
              label: 'JSON',
              language: 'json',
              code: `{
  "type": "https://docs.galaxie.sports/errors/not-found",
  "title": "Evento não encontrado",
  "status": 404,
  "code": "NOT_FOUND",
  "instance": "/v1/events/01a163b8-0000-7000-8000-000000000000"
}`,
            },
          ]}
        />
        <DocTable
          head={['Status e código', 'Quando']}
          rows={[
            ['400 INVALID_PARAMS', 'Parâmetro inválido; errors traz [{ path, message }].'],
            ['401 INVALID_KEY', 'Chave ausente, inválida, expirada ou revogada.'],
            ['403 MODULE_NOT_IN_PLAN', 'A rota (ou o esporte) não está no seu contrato.'],
            ['403 MARKET_NOT_IN_PLAN', 'O país pedido não está nos seus mercados.'],
            ['404 NOT_FOUND', 'Entidade ou rota inexistente.'],
            ['429 RATE_LIMITED', 'Limite da janela atingido; veja retry-after.'],
            ['503 DEGRADED', 'Raro: fonte indisponível e nenhum dado anterior válido.'],
            ['500 INTERNAL_ERROR', 'Erro inesperado (registrado do nosso lado).'],
          ]}
        />
        <CodeTabs examples={ERRORS} />
      </DocSection>

      <DocSection id="versionamento" title="Versionamento">
        <Bullets
          items={[
            <>
              <C>/v1</C> é estável: mudanças incompatíveis vão para <C>/v2</C>, com 6 meses de convivência.
            </>,
            <>Campos novos podem aparecer a qualquer momento: ignore os que você não conhece.</>,
            <>
              Dados que a fonte ainda não entregou vêm como <C>null</C> ou lista vazia, nunca como erro (ex.:
              escalação com <C>available: false</C>).
            </>,
          ]}
        />
      </DocSection>
    </DocPage>
  );
}
