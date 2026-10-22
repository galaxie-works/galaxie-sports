import type { Metadata } from 'next';
import Link from 'next/link';

import { CodeTabs } from '@/components/docs/code-tabs';
import { Bullets, C, Callout, DocPage, DocSection, DocTable, Endpoint, P } from '@/components/docs/doc-blocks';
import { DOC_REQUESTS, SAMPLE } from '@/lib/docs';
import { PUBLIC_API_URL, requestSnippets } from '@/lib/galaxie/request';

export const metadata: Metadata = { title: 'Começando · Documentação' };

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

const MAP: [string, string, React.ReactNode][] = [
  ['Catálogo', 'GET /v1/sports', 'Esportes, países, competições, tabelas e locais.'],
  ['Navegação', 'GET /v1/navigation', 'Menu pronto: esportes e países com bandeira e confederação.'],
  ['Eventos', 'GET /v1/events', 'Agenda multiesporte, ao vivo, detalhe, timeline, escalações, estatísticas, h2h.'],
  ['Times e pessoas', 'GET /v1/teams/{id}/overview', 'Times, elencos, jogadores e técnicos.'],
  ['Onde assistir', 'GET /v1/events/{id}/where-to-watch', 'Opções de transmissão por evento e país.'],
  ['Semântica', 'GET /v1/derbies/{slug}', 'Apelidos, clássicos, rivais, glossário e microcopy por mercado.'],
  ['Multiesporte', 'GET /v1/multisport/games', 'Olimpíadas e Pan-Americano: edições, quadro de medalhas, agenda.'],
  ['Tempo real', 'GET /v1/stream', 'Mudanças por SSE; webhooks assinados com HMAC.'],
  ['Conta', 'GET /v1/account', 'Plano, chaves e uso do seu contrato.'],
];

export default function GettingStartedPage() {
  return (
    <DocPage
      href="/docs"
      title="Começando"
      lead={
        <>
          A Galaxie Sports API entrega metadados esportivos da América Latina e do mundo: catálogo, agenda,
          times, pessoas, onde assistir e contexto editorial, em 8 locales. Este guia leva da chave à primeira
          resposta.
        </>
      }
    >
      <DocSection id="url-base" title="URL base e especificação">
        <P>
          Todas as rotas ficam sob <C>{PUBLIC_API_URL}</C>. A API canônica é versionada em <C>/v1</C> e
          orientada a evento: o mesmo formato serve a todos os esportes. Há também um espelho compatível
          (<C>/mirror/{'{sport}'}/{'{endpoint}'}</C>) para quem já consome o formato do fornecedor de origem.
        </P>
        <DocTable
          head={['Recurso', 'Onde']}
          rows={[
            ['OpenAPI 3.1', <C key="o">{PUBLIC_API_URL}/openapi.json</C>],
            ['Referência interativa', <C key="d">{PUBLIC_API_URL}/docs</C>],
            ['Lista de rotas nesta demo', <Link key="r" href="/docs/referencia" className="text-primary hover:underline">Referência da API</Link>],
          ]}
        />
      </DocSection>

      <DocSection id="primeira-chamada" title="1. Primeira chamada">
        <P>
          Envie a chave no header <C>x-galaxie-key</C> (veja <Link href="/docs/autenticacao" className="text-primary hover:underline">Autenticação</Link>).
          O card de um time traz, numa chamada só, a posição dele em cada competição, a forma recente, os
          últimos jogos e o próximo — aqui, o Palmeiras:
        </P>
        <CodeTabs examples={requestSnippets(DOC_REQUESTS.overview)} />
        <P>Resposta (resumida):</P>
        <CodeTabs examples={[{ label: 'JSON', language: 'json', code: OVERVIEW_SAMPLE }]} title="200 OK" />
      </DocSection>

      <DocSection id="navegar" title="2. Navegue pelos IDs">
        <P>
          Toda entidade tem um ID canônico (UUID) que liga as respostas entre si: o <C>event_id</C> da forma
          recente abre o evento, o <C>venue.id</C> abre o estádio, o <C>competition.slug</C> abre a competição.
          Para listar os jogos do time a partir de uma data:
        </P>
        <CodeTabs examples={requestSnippets(DOC_REQUESTS.teamEvents)} />
        <P>E para abrir um desses jogos, com placar, fase, clássico e o que está em jogo:</P>
        <CodeTabs examples={requestSnippets(DOC_REQUESTS.event)} />
        <Callout title="Veja o código de qualquer tela">
          Nas páginas da demo, o botão <strong>Ver código</strong> (ícone {'</>'}) no cabeçalho e em cada seção
          mostra a requisição exata que gerou aqueles dados, com os IDs da página.
        </Callout>
      </DocSection>

      <DocSection id="mapa" title="Mapa da API">
        <DocTable
          head={['Área', 'Rota de entrada', 'O que tem']}
          mono={false}
          rows={MAP.map(([area, route, what]) => {
            const [method, path] = route.split(' ');
            return [area, <Endpoint key={route} method={method!} route={path!} />, what];
          })}
        />
      </DocSection>

      <DocSection id="proximos-passos" title="Próximos passos">
        <Bullets
          items={[
            <>
              <Link href="/docs/conceitos" className="text-primary hover:underline">Conceitos</Link>: locales e
              fuso, cache com ETag, paginação por cursor e o formato dos erros.
            </>,
            <>
              <Link href="/docs/modulos-e-planos" className="text-primary hover:underline">Módulos e planos</Link>:
              o que o seu contrato libera.
            </>,
            <>
              <Link href="/docs/tempo-real" className="text-primary hover:underline">Tempo real</Link>: placar e
              status sem polling, por SSE ou webhook.
            </>,
          ]}
        />
      </DocSection>
    </DocPage>
  );
}
