import type { Metadata } from 'next';
import Link from 'next/link';

import { CodeTabs } from '@/components/docs/code-tabs';
import { Bullets, C, Callout, DocPage, DocSection, DocTable, Endpoint, P } from '@/components/docs/doc-blocks';
import { Badge } from '@/components/reui/badge';
import { DOC_REQUESTS } from '@/lib/docs';
import { requestSnippets } from '@/lib/galaxie/request';

export const metadata: Metadata = { title: 'Módulos e planos · Documentação' };

const MODULES: { id: string; name: string; what: string; routes: string[] }[] = [
  {
    id: 'core_data',
    name: 'Core Data',
    what: 'Catálogo, agenda, eventos, times, pessoas, locais, contexto da competição, tempo real de placar/status/lances e o espelho compatível.',
    routes: [
      'GET /v1/sports',
      'GET /v1/navigation',
      'GET /v1/competitions/{id}',
      'GET /v1/competitions/{id}/context',
      'GET /v1/events',
      'GET /v1/events/{id}',
      'GET /v1/teams/{id}/overview',
      'GET /v1/people/{id}',
      'GET /v1/stream',
      'GET /mirror/{sport}/{endpoint}',
    ],
  },
  {
    id: 'where_to_watch',
    name: 'Onde assistir',
    what: 'Opções de transmissão confirmadas por evento e país, e o tópico where_to_watch.changed.',
    routes: ['GET /v1/events/{id}/where-to-watch'],
  },
  {
    id: 'semantic',
    name: 'Semântica',
    what: 'Identidade dos times (apelidos, torcida, gritos), clássicos com retrospecto, rivais, glossário e microcopy por mercado.',
    routes: [
      'GET /v1/teams/{id}/semantic',
      'GET /v1/teams/{id}/rivals',
      'GET /v1/derbies',
      'GET /v1/derbies/{slug}',
      'GET /v1/glossary',
      'GET /v1/copy',
    ],
  },
  {
    id: 'live_intelligence',
    name: 'Live Intelligence',
    what: 'Cenário pré-jogo e resumo pós-jogo gerados a partir dos fatos (com fontes), também no detalhe do evento, e o tópico event.context_published.',
    routes: ['GET /v1/events/{id}/context'],
  },
  {
    id: 'multisport',
    name: 'Multiesporte',
    what: 'Olimpíadas e Pan-Americano: edições, quadro de medalhas, agenda, provas, delegações e histórico.',
    routes: [
      'GET /v1/multisport/games',
      'GET /v1/multisport/games/{slug}/medals',
      'GET /v1/multisport/history/medals',
    ],
  },
];

const PLANS: [string, string, string[]][] = [
  ['Core Data', 'core_data', ['core_data']],
  ['Fan Experience', 'fan_experience', ['core_data', 'where_to_watch', 'semantic']],
  [
    'Live Intelligence',
    'live_intelligence',
    ['core_data', 'where_to_watch', 'semantic', 'live_intelligence', 'multisport'],
  ],
  ['Enterprise', 'enterprise', ['todos os módulos, limites sob medida']],
];

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

export default function ModulesPage() {
  return (
    <DocPage
      href="/docs/modulos-e-planos"
      title="Módulos e planos"
      lead="O contrato define módulos (grupos de rotas), mercados (países) e esportes. A mesma chave acessa tudo o que o plano inclui."
    >
      <DocSection id="planos" title="Planos">
        <DocTable
          head={['Plano', 'Identificador', 'Módulos incluídos']}
          mono={false}
          rows={PLANS.map(([name, id, modules]) => [name, <C key={id}>{id}</C>, <Modules key={`${id}-m`} list={modules} />])}
        />
        <P>
          Além dos módulos, cada contrato pode restringir <strong>mercados</strong> (países, para as rotas por país
          como onde assistir) e <strong>esportes</strong>. O limite por minuto e a cota diária também variam por
          plano.
        </P>
      </DocSection>

      <DocSection id="modulos" title="Módulos e rotas">
        <div className="flex flex-col gap-4">
          {MODULES.map((m) => (
            <div key={m.id} className="flex flex-col gap-2 rounded-lg border p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{m.name}</span>
                <Badge variant="primary-light" size="sm" className="font-mono">
                  {m.id}
                </Badge>
              </div>
              <P>{m.what}</P>
              <div className="flex flex-col gap-1.5">
                {m.routes.map((r) => {
                  const [method, route] = r.split(' ');
                  return <Endpoint key={r} method={method!} route={route!} />;
                })}
              </div>
            </div>
          ))}
        </div>
        <P>
          As rotas de conta (<C>/v1/account/*</C>) não exigem módulo: todo contrato consulta o próprio plano, as
          chaves e o uso. A lista completa por módulo está na{' '}
          <Link href="/docs/referencia" className="text-primary hover:underline">
            referência
          </Link>
          .
        </P>
      </DocSection>

      <DocSection id="fora-do-plano" title="Fora do contrato">
        <DocTable
          head={['Situação', 'Resposta']}
          mono={false}
          rows={[
            ['Rota de um módulo não contratado', <C key="1">403 MODULE_NOT_IN_PLAN</C>],
            ['Esporte fora do contrato (agenda, espelho, stream)', <C key="2">403 MODULE_NOT_IN_PLAN</C>],
            ['País fora dos mercados (ex.: onde assistir)', <C key="3">403 MARKET_NOT_IN_PLAN</C>],
            ['Tópico de tempo real de módulo não contratado', <C key="4">403 MODULE_NOT_IN_PLAN</C>],
          ]}
        />
        <P>Exemplo: o onde assistir exige o módulo <C>where_to_watch</C> e o país nos mercados.</P>
        <CodeTabs examples={requestSnippets(DOC_REQUESTS.whereToWatch)} />
        <CodeTabs
          title="403 Forbidden"
          examples={[
            {
              label: 'JSON',
              language: 'json',
              code: `{
  "type": "https://docs.galaxie.sports/errors/module-not-in-plan",
  "title": "Plano não inclui o módulo where_to_watch",
  "status": 403,
  "code": "MODULE_NOT_IN_PLAN"
}`,
            },
          ]}
        />
        <Callout title="Sem informação também é resposta">
          Com o módulo contratado e nenhuma opção confiável para o jogo, o onde assistir responde{' '}
          <C>200</C> com <C>status: &quot;unknown&quot;</C>, <C>options: []</C> e uma <C>message</C> localizada — o
          evento continua existindo.
        </Callout>
      </DocSection>

      <DocSection id="conferir" title="Conferir o que a chave libera">
        <Bullets
          items={[
            <>
              <C>GET /v1/account</C> responde <C>tenant.modules</C>, <C>tenant.markets</C>, <C>tenant.sports</C> e{' '}
              <C>key.effectiveModules</C> (o que a chave em uso libera de fato).
            </>,
            <>Uma chave com escopo menor que o contrato recebe 403 nas rotas dos módulos de fora.</>,
          ]}
        />
        <CodeTabs examples={requestSnippets(DOC_REQUESTS.account)} />
      </DocSection>
    </DocPage>
  );
}
