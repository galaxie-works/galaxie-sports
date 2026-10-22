import type { Metadata } from 'next';
import Link from 'next/link';

import { CodeTabs } from '@/components/docs/code-tabs';
import {
  Bullets,
  C,
  Callout,
  docLink,
  docMetadata,
  DocPage,
  DocSection,
  DocTable,
  docText,
  Endpoint,
  P,
} from '@/components/docs/doc-blocks';
import { docRequests, SAMPLE } from '@/lib/docs';
import { PUBLIC_API_URL, requestSnippets, type ApiRequest } from '@/lib/galaxie/request';
import { getI18n } from '@/lib/i18n/server';

export function generateMetadata(): Promise<Metadata> {
  return docMetadata('start');
}

/** Resposta real de `/v1/teams/{id}/overview` (Palmeiras), resumida. */
const OVERVIEW_SAMPLE = `{
  "team": {
    "id": "${SAMPLE.team}",
    "sport": "football",
    "name": "Palmeiras",
    "code": "PAL",
    "nicknames": ["Verdão", "Alviverde", "Palestra"],
    "country_ref": { "code": "BR", "name": "Brasil" },
    "founded": 1914,
    "venue": { "id": "${SAMPLE.venue}", "name": "Nubank Parque", "city": "São Paulo, São Paulo" }
  },
  "standings": [
    {
      "competition": { "slug": "brasileirao-serie-a", "name": "Brasileirão Série A" },
      "season": { "year": 2026, "label": "2026" },
      "rank": 2,
      "points": 66,
      "form": "WWWDW"
    }
  ],
  "form": [{ "event_id": "01a163b8-7ca2-71e8-a92e-8dc201d5d83a", "result": "L", "score": "0-1" }],
  "last_events": ["…"],
  "live_event": null,
  "next_event": { "id": "…", "starts_at": "…", "participants": ["…"] }
}`;

/** Áreas do mapa da API (o texto de cada uma fica em `t.docs.start.map[área]`). */
const MAP = [
  ['catalog', 'GET /v1/sports'],
  ['navigation', 'GET /v1/navigation'],
  ['events', 'GET /v1/events'],
  ['teams', 'GET /v1/teams/{id}/overview'],
  ['whereToWatch', 'GET /v1/events/{id}/where-to-watch'],
  ['semantic', 'GET /v1/derbies/{slug}'],
  ['multisport', 'GET /v1/multisport/games'],
  ['realtime', 'GET /v1/stream'],
  ['account', 'GET /v1/account'],
] as const;

export default async function GettingStartedPage() {
  const i18n = await getI18n();
  const { locale, t } = i18n;
  const text = t.docs.start;
  const requests = docRequests(i18n);
  const snippets = (req: ApiRequest) => requestSnippets(req, PUBLIC_API_URL, locale);

  return (
    <DocPage href="/docs" title={t.code.docsNav.start.label} lead={text.lead}>
      <DocSection id="url-base" title={text.baseUrl.title}>
        <P>{docText(text.baseUrl.body, {}, { apiUrl: PUBLIC_API_URL, mirror: '/mirror/{sport}/{endpoint}' })}</P>
        <DocTable
          head={[text.baseUrl.headResource, text.baseUrl.headWhere]}
          rows={[
            ['OpenAPI 3.1', <C key="o">{PUBLIC_API_URL}/openapi.json</C>],
            [text.baseUrl.interactive, <C key="d">{PUBLIC_API_URL}/docs</C>],
            [
              text.baseUrl.routes,
              <Link key="r" href="/docs/referencia" className="text-primary hover:underline">
                {t.code.docsNav.reference.label}
              </Link>,
            ],
          ]}
        />
      </DocSection>

      <DocSection id="primeira-chamada" title={text.firstCall.title}>
        <P>{docText(text.firstCall.body, { auth: docLink('/docs/autenticacao') })}</P>
        <CodeTabs examples={snippets(requests.overview)} />
        <P>{text.firstCall.response}</P>
        <CodeTabs examples={[{ label: 'JSON', language: 'json', code: OVERVIEW_SAMPLE }]} title="200 OK" />
      </DocSection>

      <DocSection id="navegar" title={text.navigate.title}>
        <P>{docText(text.navigate.body)}</P>
        <CodeTabs examples={snippets(requests.teamEvents)} />
        <P>{text.navigate.openEvent}</P>
        <CodeTabs examples={snippets(requests.event)} />
        <Callout title={text.navigate.calloutTitle}>{docText(text.navigate.callout, {}, { icon: '</>' })}</Callout>
      </DocSection>

      <DocSection id="mapa" title={text.map.title}>
        <DocTable
          head={[text.map.headArea, text.map.headRoute, text.map.headWhat]}
          mono={false}
          rows={MAP.map(([area, route]) => {
            const [method, path] = route.split(' ');
            return [
              text.map[area].area,
              <Endpoint key={route} method={method!} route={path!} />,
              text.map[area].what,
            ];
          })}
        />
      </DocSection>

      <DocSection id="proximos-passos" title={text.next.title}>
        <Bullets
          items={[
            docText(text.next.concepts, { a: docLink('/docs/conceitos') }),
            docText(text.next.modules, { a: docLink('/docs/modulos-e-planos') }),
            docText(text.next.realtime, { a: docLink('/docs/tempo-real') }),
          ]}
        />
      </DocSection>
    </DocPage>
  );
}
