import type { Metadata } from 'next';

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
import { Badge } from '@/components/reui/badge';
import { docRequests } from '@/lib/docs';
import { PUBLIC_API_URL, requestSnippets, type ApiRequest } from '@/lib/galaxie/request';
import { getI18n } from '@/lib/i18n/server';

export function generateMetadata(): Promise<Metadata> {
  return docMetadata('modules');
}

/** Módulos e as rotas de cada um (nome e descrição em `t.docs.modules.list[text]`). */
const MODULES = [
  {
    id: 'core_data',
    text: 'coreData',
    routes: [
      'GET /v1/sports',
      'GET /v1/navigation',
      'GET /v1/competitions/{id}',
      'GET /v1/competitions/{id}/context',
      'GET /v1/events',
      'GET /v1/events/{id}',
      'GET /v1/teams/{id}/overview',
      'GET /v1/people/{id}',
      'GET /v1/people/{id}/overview',
      'GET /v1/stream',
      'GET /mirror/{sport}/{endpoint}',
    ],
  },
  { id: 'where_to_watch', text: 'whereToWatch', routes: ['GET /v1/events/{id}/where-to-watch'] },
  {
    id: 'semantic',
    text: 'semantic',
    routes: [
      'GET /v1/teams/{id}/semantic',
      'GET /v1/teams/{id}/rivals',
      'GET /v1/teams/{id}/editorial',
      'GET /v1/derbies',
      'GET /v1/derbies/{slug}',
      'GET /v1/glossary',
      'GET /v1/copy',
    ],
  },
  { id: 'live_intelligence', text: 'liveIntelligence', routes: ['GET /v1/events/{id}/context'] },
  {
    id: 'multisport',
    text: 'multisport',
    routes: [
      'GET /v1/multisport/games',
      'GET /v1/multisport/games/{slug}/medals',
      'GET /v1/multisport/history/medals',
    ],
  },
] as const;

/** Planos: nome, identificador e módulos (`null` = todos, descrito no dicionário). */
const PLANS: [string, string, string[] | null][] = [
  ['Trial', 'trial', ['core_data']],
  ['Core Data', 'core_data', ['core_data']],
  ['Fan Experience', 'fan_experience', ['core_data', 'where_to_watch', 'semantic']],
  [
    'Live Intelligence',
    'live_intelligence',
    ['core_data', 'where_to_watch', 'semantic', 'live_intelligence', 'multisport'],
  ],
  ['Enterprise', 'enterprise', null],
];

const FORBIDDEN_SAMPLE = `{
  "type": "https://docs.galaxie.sports/errors/module-not-in-plan",
  "title": "Plano não inclui o módulo where_to_watch",
  "status": 403,
  "code": "MODULE_NOT_IN_PLAN"
}`;

function Modules({ list }: { list: string[] }) {
  return (
    <span className="flex flex-wrap gap-1">
      {list.map((m) => (
        <Badge key={m} variant="outline" size="sm" className="font-mono">
          {m}
        </Badge>
      ))}
    </span>
  );
}

export default async function ModulesPage() {
  const i18n = await getI18n();
  const { locale, t } = i18n;
  const text = t.docs.modules;
  const requests = docRequests(i18n);
  const snippets = (req: ApiRequest) => requestSnippets(req, PUBLIC_API_URL, locale);

  return (
    <DocPage href="/docs/modulos-e-planos" title={t.code.docsNav.modules.label} lead={text.lead}>
      <DocSection id="planos" title={text.plans.title}>
        <DocTable
          head={[text.plans.headPlan, text.plans.headId, text.plans.headModules]}
          mono={false}
          rows={PLANS.map(([name, id, modules]) => [
            name,
            <C key={id}>{id}</C>,
            <Modules key={`${id}-m`} list={modules ?? [text.plans.enterprise]} />,
          ])}
        />
        <P>{docText(text.plans.body)}</P>
      </DocSection>

      <DocSection id="modulos" title={text.list.title}>
        <div className="flex flex-col gap-4">
          {MODULES.map((m) => (
            <div key={m.id} className="flex flex-col gap-2 rounded-lg border p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{text.list[m.text].name}</span>
                <Badge variant="primary-light" size="sm" className="font-mono">
                  {m.id}
                </Badge>
              </div>
              <P>{text.list[m.text].what}</P>
              <div className="flex flex-col gap-1.5">
                {m.routes.map((r) => {
                  const [method, route] = r.split(' ');
                  return <Endpoint key={r} method={method!} route={route!} />;
                })}
              </div>
            </div>
          ))}
        </div>
        <P>{docText(text.list.account, { a: docLink('/docs/referencia') })}</P>
      </DocSection>

      <DocSection id="fora-do-plano" title={text.outside.title}>
        <DocTable
          head={[text.outside.headSituation, text.outside.headResponse]}
          mono={false}
          rows={[
            [text.outside.module, <C key="1">403 MODULE_NOT_IN_PLAN</C>],
            [text.outside.sport, <C key="2">403 MODULE_NOT_IN_PLAN</C>],
            [text.outside.market, <C key="3">403 MARKET_NOT_IN_PLAN</C>],
            [text.outside.topic, <C key="4">403 MODULE_NOT_IN_PLAN</C>],
          ]}
        />
        <P>{docText(text.outside.example)}</P>
        <CodeTabs examples={snippets(requests.whereToWatch)} />
        <CodeTabs title="403 Forbidden" examples={[{ label: 'JSON', language: 'json', code: FORBIDDEN_SAMPLE }]} />
        <Callout title={text.outside.calloutTitle}>{docText(text.outside.callout)}</Callout>
      </DocSection>

      <DocSection id="conferir" title={text.check.title}>
        <Bullets items={[docText(text.check.account), text.check.scoped]} />
        <CodeTabs examples={snippets(requests.account)} />
      </DocSection>
    </DocPage>
  );
}
