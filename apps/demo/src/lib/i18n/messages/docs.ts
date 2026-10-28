/**
 * Guias da documentação da API (/docs): textos das páginas, comentários dos exemplos de código e as
 * descrições das chamadas de exemplo. Rotas, campos, headers, códigos de erro e nomes de módulos ficam
 * como na API; trechos de código vão em `<c>…</c>`, negrito em `<b>…</b>` e links em tags próprias.
 * Rótulos dos guias (sidebar, trilha, anterior/próximo) ficam em `code.docsNav`.
 */
import { defineMessages } from '../define';

export default defineMessages(
  {
    meta: {
      title: '{page} · Documentação',
    },
    badge: 'Documentação da API',
    pager: {
      label: 'Outros guias',
      previous: 'Anterior',
      next: 'Próximo',
    },
    requests: {
      overview: 'Card do time: posição nas competições, forma, últimos jogos e próximo jogo.',
      teamEvents: 'Jogos do time a partir de uma data.',
      event: 'Evento completo.',
      account: 'Plano, módulos, mercados e a chave em uso.',
      usage: 'Requisições por dia e rota.',
      competitionEs: 'A mesma competição com nomes e horários para a Argentina.',
      competitions: 'Competições de futebol do Brasil (primeira página).',
      whereToWatch: 'Onde assistir o jogo no Brasil.',
      semantic: 'Cartão de identidade do time.',
      live: 'Eventos ao vivo (polling com ETag).',
    },
    start: {
      lead: 'A Galaxie Sports API entrega metadados esportivos da América Latina e do mundo: catálogo, agenda, times, pessoas, onde assistir e contexto editorial, em 8 locales. Este guia leva da chave à primeira resposta.',
      baseUrl: {
        title: 'URL base e especificação',
        body: 'Todas as rotas ficam sob <c>{apiUrl}</c>. A API canônica é versionada em <c>/v1</c> e orientada a evento: o mesmo formato serve a todos os esportes. Há também um espelho compatível (<c>{mirror}</c>) para quem já consome o formato do fornecedor de origem.',
        headResource: 'Recurso',
        headWhere: 'Onde',
        interactive: 'Referência interativa',
        routes: 'Lista de rotas nesta demo',
      },
      firstCall: {
        title: '1. Primeira chamada',
        body: 'Envie a chave no header <c>x-galaxie-key</c> (veja <auth>Autenticação</auth>). O card de um time traz, numa chamada só, a posição dele em cada competição, a forma recente, os últimos jogos e o próximo — aqui, o Palmeiras:',
        response: 'Resposta (resumida):',
      },
      navigate: {
        title: '2. Navegue pelos IDs',
        body: 'Toda entidade tem um ID canônico (UUID) que liga as respostas entre si: o <c>event_id</c> da forma recente abre o evento, o <c>venue.id</c> abre o estádio, o <c>competition.slug</c> abre a competição. Para listar os jogos do time a partir de uma data:',
        openEvent: 'E para abrir um desses jogos, com placar, fase, clássico e o que está em jogo:',
        calloutTitle: 'Veja o código de qualquer tela',
        callout:
          'Nas páginas da demo, o botão <b>Ver código</b> (ícone {icon}) no cabeçalho e em cada seção mostra a requisição exata que gerou aqueles dados, com os IDs da página.',
      },
      map: {
        title: 'Mapa da API',
        headArea: 'Área',
        headRoute: 'Rota de entrada',
        headWhat: 'O que tem',
        catalog: { area: 'Catálogo', what: 'Esportes, países, competições, tabelas e locais.' },
        navigation: {
          area: 'Navegação',
          what: 'Menu pronto: esportes e países com bandeira e confederação.',
        },
        events: {
          area: 'Eventos',
          what: 'Agenda multiesporte, ao vivo, detalhe, timeline, escalações, estatísticas, h2h.',
        },
        teams: { area: 'Times e pessoas', what: 'Times, elencos, jogadores e técnicos.' },
        whereToWatch: { area: 'Onde assistir', what: 'Opções de transmissão por evento e país.' },
        semantic: {
          area: 'Semântica',
          what: 'Apelidos, clássicos, rivais, glossário e microcopy por mercado.',
        },
        multisport: {
          area: 'Multiesporte',
          what: 'Olimpíadas e Pan-Americano: edições, quadro de medalhas, agenda.',
        },
        realtime: { area: 'Tempo real', what: 'Mudanças por SSE; webhooks assinados com HMAC.' },
        account: { area: 'Conta', what: 'Plano, chaves e uso do seu contrato.' },
      },
      next: {
        title: 'Próximos passos',
        concepts:
          '<a>Conceitos</a>: locales e fuso, cache com ETag, paginação por cursor e o formato dos erros.',
        modules: '<a>Módulos e planos</a>: o que o seu contrato libera.',
        realtime: '<a>Tempo real</a>: placar e status sem polling, por SSE ou webhook.',
      },
    },
    auth: {
      lead: 'Cada requisição leva a chave do seu contrato no header x-galaxie-key. A chave define o plano, os módulos, os mercados e o limite de uso.',
      key: {
        title: 'A chave no header',
        body: 'Envie <c>x-galaxie-key: {key}</c> em todas as rotas <c>/v1</c> e <c>/mirror</c>. Só o <c>/openapi.json</c> e a referência <c>/docs</c> são públicos. Sem chave, ou com chave inválida, a resposta é <c>401 INVALID_KEY</c>.',
        headItem: 'Item',
        headHow: 'Como funciona',
        format: {
          name: 'Formato',
          value:
            '<c>gs_live_…</c> (produção) ou <c>gs_test_…</c> (testes: mesmo dado, 60 req/min por rota e uso à parte), com um prefixo público de 12 caracteres e um checksum no fim',
        },
        display: {
          name: 'Exibição',
          value:
            'A chave completa aparece uma única vez, na criação ou na rotação. A Galaxie guarda só o hash.',
        },
        scopes: {
          name: 'Escopos',
          value:
            'Uma chave pode ser restrita a alguns módulos do contrato (ex.: uma chave só de core_data para o navegador).',
        },
        revocation: {
          name: 'Revogação',
          value: 'Revogação, suspensão e mudança de plano valem em até 60 segundos.',
        },
        calloutTitle: 'A chave fica no servidor',
        callout:
          'Não coloque a chave em apps, páginas ou repositórios. Chame a API do seu backend (esta demo faz assim: o navegador fala com um proxy do servidor, que injeta a chave). Nos exemplos, troque <c>{key}</c> pela variável de ambiente com a sua chave.',
      },
      account: {
        title: 'Confira o seu contrato',
        body: '<c>GET /v1/account</c> não exige módulo: responde o plano, os módulos contratados, os mercados (países), os esportes, o limite por minuto e os dados da chave em uso — <c>effectiveModules</c> é o que ela realmente libera (módulos do contrato ∩ escopos da chave).',
        sampleTitle: '200 OK (exemplo)',
        selfService:
          'Também em autoatendimento: <c>GET /v1/account/keys</c> lista as chaves (só metadados, nunca o segredo) e <c>GET /v1/account/usage</c> traz as requisições por dia e rota (até 92 dias):',
      },
      rotation: {
        title: 'Rotação sem downtime',
        body: '<c>POST /v1/account/keys/rotate</c> cria uma chave nova (mesmo rótulo, escopos, ambiente e validade) e mantém a atual válida por <c>graceSeconds</c> (padrão 86400 = 24 h; 0 revoga já; máximo 7 dias). Publique a nova chave nos seus servidores dentro desse prazo. Cada chave só é rotacionada uma vez: rotacionar de novo a antiga, já no período de graça, responde 409 <c>CONFLICT</c> — rotacione a nova.',
        code: {
          grace: 'a chave atual vale mais 24 h',
          failed: 'rotação falhou',
          newKey:
            'key.key é a chave nova completa: aparece só nesta resposta, guarde no cofre de segredos agora',
          newKeyPy: 'rotated["key"]["key"] é a chave nova completa: aparece só nesta resposta',
        },
      },
      limits: {
        title: 'Limites de uso',
        body: 'O limite é por contrato e por rota, numa janela de 60 segundos. Toda resposta autenticada traz:',
        headHeader: 'Header',
        headMeaning: 'Significado',
        limit: 'Requisições permitidas na janela (por rota).',
        remaining: 'Quantas ainda cabem na janela atual.',
        reset: 'Segundos até a janela reiniciar.',
        retryAfter: 'Só no 429 RATE_LIMITED: quanto esperar antes de tentar de novo.',
        cache:
          'Respeite o cache (<c>ETag</c> e <c>Cache-Control</c>): uma resposta 304 é mais rápida e o seu CDN pode servir sem chamar a API.',
        realtime: 'Para placar ao vivo, prefira o tempo real (SSE ou webhook) a polling curto.',
        code: {
          headers: '-i mostra os headers da resposta',
          retry: 'GET com uma nova tentativa quando o limite estoura (429 traz retry-after em segundos).',
        },
      },
    },
    concepts: {
      lead: 'O que vale para todas as rotas: identificadores, idioma e fuso, cache, paginação, erros e versionamento.',
      ids: {
        title: 'IDs canônicos',
        body: 'Toda entidade (competição, temporada, time, pessoa, evento, local) tem um ID próprio da Galaxie, um UUID estável: ele não muda quando a fonte de dados muda e é o mesmo em todos os locales. Use-o como chave no seu banco.',
        competitions: 'Competições aceitam o UUID ou o slug: <c>{path}</c>.',
        derbies:
          'Clássicos usam o slug: <c>{path}</c>. As rotas de semântica do time aceitam o UUID ou o slug do perfil (<c>/v1/teams/palmeiras/semantic</c>).',
        externalIds:
          '<c>external_ids</c> (times, competições, pessoas) traz os IDs da fonte de origem, para cruzar com uma base que você já tenha.',
        links:
          'As respostas se ligam pelos IDs: <c>participants[].id</c> do evento abre o time, <c>venue.id</c> abre o local, <c>competition.slug</c> abre a competição.',
      },
      locales: {
        title: 'Locales e fuso horário',
        body: 'Nomes, apelidos, fases e textos saem no idioma do mercado. Informe <c>?locale=</c> (tem precedência) ou o header <c>Accept-Language</c>; sem nenhum dos dois, vale <c>pt-BR</c>. A resposta traz <c>Content-Language</c>. Datas e horas saem em ISO 8601 no fuso de <c>?tz=</c> (qualquer fuso IANA; padrão UTC).',
        headLocale: 'Locale',
        headMarket: 'Mercado',
        argentina: 'A mesma competição para o público argentino, com horários de Buenos Aires:',
        fallbackTitle: 'Fallback de idioma',
        fallback:
          'Sem texto no locale pedido, a API tenta o idioma (<c>es-AR → es</c>) e depois o inglês; por fim, o nome oficial. Locale fora da lista responde <c>400 INVALID_PARAMS</c>.',
      },
      cache: {
        title: 'Cache e ETag',
        body: 'Toda resposta <c>200</c> traz <c>ETag</c> e <c>Cache-Control</c>. Reenvie o ETag em <c>If-None-Match</c>: se nada mudou, a resposta é <c>304</c> sem corpo. O TTL depende do tipo de dado:',
        headResource: 'Recurso',
        headTtl: 'TTL na CDN',
        catalog: { name: 'Países, competições, times, locais, navegação', ttl: '24 h' },
        squads: { name: 'Elencos e tabelas', ttl: '1 h' },
        today: { name: 'Agenda do dia', ttl: '5 min' },
        live: { name: 'Evento ao vivo', ttl: '5–15 s' },
        whereToWatch: { name: 'Onde assistir', ttl: '60 s' },
        ai: { name: 'Cenário e resumo de IA', ttl: '1 h' },
        semantic: {
          name: 'Semântica (clássicos, perfis, glossário)',
          ttl: '24 h (retrospecto do clássico: 1 h)',
        },
        images: {
          name: 'Imagens (logos, bandeiras, fotos)',
          ttl: '30 dias, imutáveis (nova versão = nova URL)',
        },
        purge:
          'Mudanças importantes (placar, status, onde assistir) também purgam o cache na hora e chegam por <a>tempo real</a>.',
        code: {
          first: '1ª chamada: guarde o ETag',
          revalidate: 'Revalidação: 304 sem corpo enquanto nada mudou',
          unchanged: 'nada mudou: reaproveita',
        },
      },
      pagination: {
        title: 'Paginação por cursor',
        body: 'Listas longas (<c>/v1/events</c>, <c>/v1/competitions</c>, <c>/v1/teams</c>, jogos do time…) respondem <c>{page}</c>. Repita a mesma query com <c>?cursor=</c> até <c>next_cursor</c> vir <c>null</c>. <c>limit</c> vai de 1 a 200 (padrão 50). Listas curtas (<c>/v1/sports</c>, <c>/v1/countries</c>) vêm inteiras em <c>{list}</c>.',
        calloutTitle: 'O cursor é opaco',
        callout:
          'Não monte nem altere o cursor: ele codifica a posição na ordenação pedida. Mudou um filtro, comece da primeira página.',
        code: {
          first: '1ª página',
          next: 'Próxima: repita a mesma query com o cursor recebido',
          paginate: 'Percorre todas as páginas de uma lista paginada por cursor.',
        },
      },
      errors: {
        title: 'Erros',
        body: 'Erros seguem a RFC 9457 (<c>application/problem+json</c>), com um <c>code</c> estável para tratar no código. Respostas de erro nunca são cacheadas.',
        headStatus: 'Status e código',
        headWhen: 'Quando',
        invalidParams: 'Parâmetro inválido; errors traz [{ path, message }].',
        invalidKey: 'Chave ausente, inválida, expirada ou revogada.',
        moduleNotInPlan: 'A rota (ou o esporte) não está no seu contrato.',
        marketNotInPlan: 'O país pedido não está nos seus mercados.',
        notFound: 'Entidade ou rota inexistente.',
        rateLimited: 'Limite da janela atingido; veja retry-after.',
        quotaExceeded:
          'Cota diária do plano passou de 110%; volta na virada do dia (UTC). A partir de 80%, as respostas trazem x-galaxie-quota-warning.',
        degraded: 'Raro: fonte indisponível e nenhum dado anterior válido.',
        maintenance:
          'Atualização da plataforma em andamento (segundos); tente de novo depois de retry-after.',
        internal: 'Erro inesperado (registrado do nosso lado).',
        code: {
          notFound: 'a entidade não existe (ou saiu do catálogo)',
          outsidePlan: 'fora do contrato',
          retry: 'espere retry-after segundos e tente de novo',
        },
      },
      versioning: {
        title: 'Versionamento',
        stable:
          '<c>/v1</c> é estável: mudanças incompatíveis vão para <c>/v2</c>, com 6 meses de convivência.',
        newFields: 'Campos novos podem aparecer a qualquer momento: ignore os que você não conhece.',
        missing:
          'Dados que a fonte ainda não entregou vêm como <c>null</c> ou lista vazia, nunca como erro (ex.: escalação com <c>available: false</c>).',
      },
    },
    modules: {
      lead: 'O contrato define módulos (grupos de rotas), mercados (países) e esportes. A mesma chave acessa tudo o que o plano inclui.',
      plans: {
        title: 'Planos',
        headPlan: 'Plano',
        headId: 'Identificador',
        headModules: 'Módulos incluídos',
        enterprise: 'todos os módulos, limites sob medida',
        body: 'Além dos módulos, cada contrato pode restringir <b>mercados</b> (países, para as rotas por país como onde assistir) e <b>esportes</b>. O limite por minuto e a cota diária também variam por plano.',
      },
      list: {
        title: 'Módulos e rotas',
        coreData: {
          name: 'Core Data',
          what: 'Catálogo, agenda, eventos, times, pessoas, locais, contexto da competição, tempo real de placar/status/lances e o espelho compatível.',
        },
        whereToWatch: {
          name: 'Onde assistir',
          what: 'Opções de transmissão confirmadas por evento e país, e o tópico where_to_watch.changed.',
        },
        semantic: {
          name: 'Semântica',
          what: 'Identidade dos times (apelidos, torcida, gritos), clássicos com retrospecto, rivais, glossário e microcopy por mercado.',
        },
        liveIntelligence: {
          name: 'Live Intelligence',
          what: 'Cenário pré-jogo e resumo pós-jogo gerados a partir dos fatos (com fontes), também no detalhe do evento, e o tópico event.context_published.',
        },
        multisport: {
          name: 'Multiesporte',
          what: 'Olimpíadas e Pan-Americano: edições, quadro de medalhas, agenda, provas, delegações e histórico.',
        },
        account:
          'As rotas de conta (<c>/v1/account/*</c>) não exigem módulo: todo contrato consulta o próprio plano, as chaves e o uso. A lista completa por módulo está na <a>referência</a>.',
      },
      outside: {
        title: 'Fora do contrato',
        headSituation: 'Situação',
        headResponse: 'Resposta',
        module: 'Rota de um módulo não contratado',
        sport: 'Esporte fora do contrato (agenda, espelho, stream)',
        market: 'País fora dos mercados (ex.: onde assistir)',
        topic: 'Tópico de tempo real de módulo não contratado',
        example: 'Exemplo: o onde assistir exige o módulo <c>where_to_watch</c> e o país nos mercados.',
        calloutTitle: 'Sem informação também é resposta',
        callout:
          'Com o módulo contratado e nenhuma opção confiável para o jogo, o onde assistir responde <c>200</c> com <c>status: "unknown"</c>, <c>options: []</c> e uma <c>message</c> localizada — o evento continua existindo.',
      },
      check: {
        title: 'Conferir o que a chave libera',
        account:
          '<c>GET /v1/account</c> responde <c>tenant.modules</c>, <c>tenant.markets</c>, <c>tenant.sports</c> e <c>key.effectiveModules</c> (o que a chave em uso libera de fato).',
        scoped: 'Uma chave com escopo menor que o contrato recebe 403 nas rotas dos módulos de fora.',
      },
    },
    realtime: {
      lead: 'Placar, status, lances, onde assistir e contexto de IA mudam o tempo todo. Em vez de consultar de novo, receba só o que mudou: por SSE (conexão aberta) ou webhook (POST assinado no seu servidor).',
      feed: {
        title: 'Change feed',
        body: 'Toda mudança visível ao cliente entra num change feed ordenado, com um <c>id</c> crescente. O mesmo registro sai pelo SSE e pelos webhooks — e também purga o cache da API e da CDN, então a próxima leitura REST já vem atualizada. A mensagem é compacta (o tópico, os campos que mudaram e os valores novos); para o estado completo, leia a rota REST do evento.',
        headShort: 'Curto (?topics=)',
        headTopic: 'Tópico',
        headWhen: 'Quando',
        headModule: 'Módulo',
        status: 'Mudou status, status_detail ou o relógio',
        score: 'Mudou o placar',
        incidents: 'Lance novo na timeline (gol, cartão, VAR…)',
        whereToWatch: 'Opção de transmissão incluída, corrigida ou removida',
        context: 'Cenário/resumo de IA publicado ou revisado',
        sampleTitle: 'RealtimeChange (data: do SSE e corpo do webhook)',
        data: '<c>data</c> por tópico: <c>status</c>/<c>status_detail</c>/<c>clock</c> (com <c>previous.status</c>); <c>score</c>; <c>incidents</c> (os lances novos); <c>countries</c> (países afetados do onde assistir); <c>contexts</c> (locale e tipo publicados).',
      },
      sse: {
        title: 'SSE — GET /v1/stream',
        headParam: 'Parâmetro',
        headRule: 'Regra',
        events: 'Até 200 IDs de evento, separados por vírgula. Vazio = todos os eventos do contrato.',
        filters: 'Filtros adicionais (até 50 competições, 20 esportes).',
        topics: 'Nomes curtos ou completos; padrão: todos os do plano.',
        resume: 'Retoma: reenvia em ordem as mudanças depois desse id.',
        token:
          'Token curto (5 min) para o EventSource do navegador, que não envia headers: peça em POST /v1/stream/token, no seu backend.',
        key: 'Obsoleto: aceito até 27/12/2026, com os headers Deprecation e Sunset. Use ?token= no navegador ou o header.',
        body: 'Cada mensagem tem <c>id:</c>, <c>event:</c> (o tópico) e <c>data:</c> (JSON). O stream começa com <c>retry: 3000</c>, envia <c>event: ready</c> depois da retomada e um comentário de heartbeat a cada 15 s.',
        atLeastOnce:
          'Entrega pelo menos uma vez, em ordem de id: trate as mudanças como idempotentes pelo <c>id</c>.',
        replay:
          'Retomada guarda até 5000 mudanças; acima disso chega <c>event: replay_truncated</c> e o cliente deve recarregar o estado pela REST.',
        connections:
          'Há um limite de conexões simultâneas por contrato; acima dele, <c>429 RATE_LIMITED</c> com <c>retry-after</c>.',
        code: {
          browserTab: 'Navegador',
          noBuffer: '-N: sem buffer, mostra as mensagens conforme chegam',
          resumeAfter: 'opcional: retoma depois desta mudança',
          server: 'Servidor (Node 20+): fetch com a chave no header e leitura do stream.',
          keepId: 'guarde para retomar depois de uma queda',
          dropped: 'conexão caiu: chame listen() de novo (retoma pelo lastEventId)',
          heartbeat: 'heartbeat a cada 15 s',
          control: 'retry/ready: controle do stream',
          readTimeout: 'leitura > heartbeat de 15 s',
          heartbeatShort: 'heartbeat',
          endOfMessage: 'fim da mensagem',
          browserKey1:
            'EventSource não envia headers: a rota /stream-token do SEU backend chama POST /v1/stream/token com',
          browserKey2: 'a chave no header e devolve um token de 5 min. A chave nunca vai ao navegador.',
          updateScore: 'atualizarPlacar',
          reconnect:
            'Queda ou token vencido: feche, peça outro token e reabra com &last_event_id= (o último e.lastEventId).',
        },
      },
      webhooks: {
        title: 'Webhooks',
        body: 'A Galaxie faz um <c>POST</c> com o <c>RealtimeChange</c> no corpo para a URL HTTPS que você cadastrar no onboarding, com os mesmos filtros do SSE (tópicos, eventos, competições, esportes). O segredo de assinatura (<c>whsec_…</c>) é entregue uma única vez.',
        headHeader: 'Header',
        headValue: 'Valor',
        signature: 't=<unix segundos>,v1=<hex de HMAC-SHA256(segredo, "<t>.<corpo bruto>")>',
        event: 'Tópico (ex.: event.score_changed)',
        delivery: 'ID da entrega',
        attempt: 'Tentativa (1, 2, …)',
        idempotency: 'Igual em todas as tentativas: descarte duplicatas por ela',
        retriesTitle: 'Retentativas',
        retries:
          'Qualquer resposta fora de 2xx (inclusive redirecionamento) ou demora acima de 10 s conta como falha. A Galaxie tenta de novo com espera exponencial (10 s, 20 s, 40 s…, até 1 h) por até 10 tentativas; depois, a entrega fica numa fila de reprocessamento. Responda rápido e processe de forma assíncrona.',
        code: {
          verify: 'Verifica x-galaxie-signature sobre o corpo BRUTO (antes do JSON.parse).',
          verifyPy: 'Verifica x-galaxie-signature sobre o corpo BRUTO (antes do json.loads).',
          replay: 'proteção contra replay',
          dedupe: 'descarte duplicatas pelo header idempotency-key',
          respondFast: 'responda rápido; processe de forma assíncrona',
        },
      },
      polling: {
        title: 'Polling (clientes simples)',
        body: 'Sem SSE nem webhook, consulte <c>GET /v1/events/live</c> com <c>If-None-Match</c>: enquanto nada muda, a resposta é <c>304</c> sem corpo. O TTL dessa rota é de 10 s.',
      },
    },
    reference: {
      lead: 'As {total} operações da especificação OpenAPI 3.1 (versão {version}), geradas dos mesmos schemas que a API valida. Para testar chamadas, use a referência interativa.',
      interactive: 'Referência interativa',
      external:
        'A referência interativa (Scalar) abre em outra aba: a API não permite ser exibida dentro de outras páginas (proteção contra clickjacking). Importe o <c>openapi.json</c> no Postman, Insomnia ou num gerador de cliente.',
      common:
        'Rotas marcadas com <c>locale · tz</c> aceitam <c>?locale=</c> (ou <c>Accept-Language</c>) e <c>?tz=</c> (veja <a>Conceitos</a>). Os códigos depois do tipo de resposta são os erros possíveis, sempre em <c>application/problem+json</c>; <c>304</c> é a revalidação por ETag.',
      specLanguage:
        'Resumos, descrições e parâmetros de cada operação vêm direto da especificação OpenAPI, como a API publica.',
      sections: 'Seções da referência',
      path: 'caminho',
      required: 'obrigatório',
      default: 'padrão {value}',
      example: 'ex.: {value}',
      body: 'Corpo (JSON):',
      errors: 'Erros em application/problem+json',
      tags: {
        catalog: { name: 'Catálogo', description: 'Esportes, países, competições, tabelas e locais.' },
        search: {
          name: 'Busca',
          description: 'Busca global em times, competições, jogos, pessoas, estádios e países.',
        },
        events: {
          name: 'Eventos',
          description: 'Agenda, ao vivo, detalhe, timeline, escalações e estatísticas.',
        },
        teams: { name: 'Times e pessoas', description: 'Times, elencos e pessoas.' },
        semantic: {
          name: 'Semântica',
          description: 'Identidade dos times, clássicos, rivais, glossário e microcopy por mercado.',
        },
        whereToWatch: { name: 'Onde assistir', description: 'Opções de transmissão por evento e país.' },
        related: {
          name: 'Conteúdo relacionado',
          description: 'Vídeos diretos por evento, classificados por tipo e formato.',
        },
        multisport: {
          name: 'Multiesporte',
          description: 'Olimpíadas e Pan-Americano: edições, medalhas, agenda e histórico.',
        },
        realtime: { name: 'Tempo real', description: 'SSE e webhooks assinados.' },
        mirror: { name: 'Espelho', description: 'Espelho compatível com o formato do fornecedor de origem.' },
        account: { name: 'Conta', description: 'Autoatendimento do contrato: plano, chaves e uso.' },
        other: { name: 'Outros', description: 'Outras operações.' },
      },
    },
  },
  {
    en: {
      meta: {
        title: '{page} · Documentation',
      },
      badge: 'API documentation',
      pager: {
        label: 'Other guides',
        previous: 'Previous',
        next: 'Next',
      },
      requests: {
        overview: 'Team card: position in each competition, form, recent matches and next match.',
        teamEvents: "The team's matches from a given date.",
        event: 'Full event.',
        account: 'Plan, modules, markets and the key in use.',
        usage: 'Requests per day and route.',
        competitionEs: 'The same competition with names and kickoff times for Argentina.',
        competitions: "Brazil's football competitions (first page).",
        whereToWatch: 'Where to watch the match in Brazil.',
        semantic: "The team's identity card.",
        live: 'Live events (polling with ETag).',
      },
      start: {
        lead: 'The Galaxie Sports API delivers sports metadata for Latin America and the world: catalog, schedule, teams, people, where to watch and editorial context, in 8 locales. This guide takes you from your key to your first response.',
        baseUrl: {
          title: 'Base URL and spec',
          body: 'Every route lives under <c>{apiUrl}</c>. The canonical API is versioned under <c>/v1</c> and event-oriented: the same shape covers every sport. There is also a compatible mirror (<c>{mirror}</c>) for teams already consuming the upstream provider format.',
          headResource: 'Resource',
          headWhere: 'Where',
          interactive: 'Interactive reference',
          routes: 'Route list in this demo',
        },
        firstCall: {
          title: '1. Your first call',
          body: 'Send your key in the <c>x-galaxie-key</c> header (see <auth>Authentication</auth>). A team card returns, in a single call, its position in each competition, recent form, last matches and next match — here, Palmeiras:',
          response: 'Response (trimmed):',
        },
        navigate: {
          title: '2. Follow the IDs',
          body: 'Every entity has a canonical ID (UUID) that links responses together: the <c>event_id</c> in recent form opens the event, <c>venue.id</c> opens the stadium, <c>competition.slug</c> opens the competition. To list the team’s matches from a given date:',
          openEvent: 'And to open one of those matches, with score, stage, derby and what is at stake:',
          calloutTitle: 'See the code behind any screen',
          callout:
            'On the demo pages, the <b>View code</b> button ({icon} icon) in the header and in each section shows the exact request that produced that data, with the page’s IDs.',
        },
        map: {
          title: 'API map',
          headArea: 'Area',
          headRoute: 'Entry route',
          headWhat: 'What it covers',
          catalog: { area: 'Catalog', what: 'Sports, countries, competitions, standings and venues.' },
          navigation: {
            area: 'Navigation',
            what: 'Ready-made menu: sports and countries with flag and confederation.',
          },
          events: {
            area: 'Events',
            what: 'Multi-sport schedule, live, detail, timeline, lineups, stats, h2h.',
          },
          teams: { area: 'Teams and people', what: 'Teams, squads, players and coaches.' },
          whereToWatch: { area: 'Where to watch', what: 'Broadcast options per event and country.' },
          semantic: {
            area: 'Semantic',
            what: 'Nicknames, derbies, rivals, glossary and microcopy per market.',
          },
          multisport: {
            area: 'Multi-sport',
            what: 'Olympics and Pan American Games: editions, medal table, schedule.',
          },
          realtime: { area: 'Real time', what: 'Changes over SSE; webhooks signed with HMAC.' },
          account: { area: 'Account', what: 'Your contract’s plan, keys and usage.' },
        },
        next: {
          title: 'Next steps',
          concepts:
            '<a>Concepts</a>: locales and time zones, ETag caching, cursor pagination and the error format.',
          modules: '<a>Modules and plans</a>: what your contract unlocks.',
          realtime: '<a>Real time</a>: score and status without polling, over SSE or webhooks.',
        },
      },
      auth: {
        lead: 'Every request carries your contract’s key in the x-galaxie-key header. The key determines your plan, modules, markets and rate limit.',
        key: {
          title: 'The key in the header',
          body: 'Send <c>x-galaxie-key: {key}</c> on every <c>/v1</c> and <c>/mirror</c> route. Only <c>/openapi.json</c> and the <c>/docs</c> reference are public. With no key, or an invalid one, the response is <c>401 INVALID_KEY</c>.',
          headItem: 'Item',
          headHow: 'How it works',
          format: {
            name: 'Format',
            value:
              '<c>gs_live_…</c> (production) or <c>gs_test_…</c> (testing: same data, 60 req/min per route and separate usage), with a 12-character public prefix and a checksum at the end',
          },
          display: {
            name: 'Visibility',
            value:
              'The full key is shown only once, when it is created or rotated. Galaxie stores only its hash.',
          },
          scopes: {
            name: 'Scopes',
            value:
              'A key can be restricted to some of the contract’s modules (e.g. a core_data-only key for the browser).',
          },
          revocation: {
            name: 'Revocation',
            value: 'Revocations, suspensions and plan changes take effect within 60 seconds.',
          },
          calloutTitle: 'Keep the key on the server',
          callout:
            'Never put the key in apps, web pages or repositories. Call the API from your backend (this demo does exactly that: the browser talks to a server-side proxy that injects the key). In the examples, replace <c>{key}</c> with the environment variable holding your key.',
        },
        account: {
          title: 'Check your contract',
          body: '<c>GET /v1/account</c> requires no module: it returns your plan, licensed modules, markets (countries), sports, per-minute limit and details of the key in use — <c>effectiveModules</c> is what that key actually unlocks (contract modules ∩ key scopes).',
          sampleTitle: '200 OK (example)',
          selfService:
            'Also self-service: <c>GET /v1/account/keys</c> lists your keys (metadata only, never the secret) and <c>GET /v1/account/usage</c> returns requests per day and route (up to 92 days):',
        },
        rotation: {
          title: 'Zero-downtime rotation',
          body: '<c>POST /v1/account/keys/rotate</c> creates a new key (same label, scopes, environment and expiry) and keeps the current one valid for <c>graceSeconds</c> (default 86400 = 24 h; 0 revokes it immediately; 7 days max). Roll the new key out to your servers within that window. Each key can be rotated only once: rotating the old one again, while in its grace period, returns 409 <c>CONFLICT</c> — rotate the new one.',
          code: {
            grace: 'the current key stays valid for another 24 h',
            failed: 'rotation failed',
            newKey:
              'key.key is the full new key: it only appears in this response, store it in your secrets vault now',
            newKeyPy: 'rotated["key"]["key"] is the full new key: it only appears in this response',
          },
        },
        limits: {
          title: 'Rate limits',
          body: 'Limits apply per contract and per route, over a 60-second window. Every authenticated response includes:',
          headHeader: 'Header',
          headMeaning: 'Meaning',
          limit: 'Requests allowed in the window (per route).',
          remaining: 'How many requests are left in the current window.',
          reset: 'Seconds until the window resets.',
          retryAfter: 'Only on 429 RATE_LIMITED: how long to wait before retrying.',
          cache:
            'Honor caching (<c>ETag</c> and <c>Cache-Control</c>): a 304 response is faster, and your CDN can serve it without calling the API.',
          realtime: 'For live scores, prefer real time (SSE or webhooks) over short polling.',
          code: {
            headers: '-i prints the response headers',
            retry: 'GET with one retry when the limit is exceeded (429 includes retry-after in seconds).',
          },
        },
      },
      concepts: {
        lead: 'What applies to every route: identifiers, language and time zone, caching, pagination, errors and versioning.',
        ids: {
          title: 'Canonical IDs',
          body: 'Every entity (competition, season, team, person, event, venue) has its own Galaxie ID, a stable UUID: it doesn’t change when the data source changes and it’s the same across all locales. Use it as the key in your database.',
          competitions: 'Competitions accept either the UUID or the slug: <c>{path}</c>.',
          derbies:
            'Derbies use the slug: <c>{path}</c>. Team semantic routes accept the UUID or the profile slug (<c>/v1/teams/palmeiras/semantic</c>).',
          externalIds:
            '<c>external_ids</c> (teams, competitions, people) carries the upstream source IDs, so you can match them against a database you already have.',
          links:
            'Responses link to each other through IDs: the event’s <c>participants[].id</c> opens the team, <c>venue.id</c> opens the venue, <c>competition.slug</c> opens the competition.',
        },
        locales: {
          title: 'Locales and time zones',
          body: 'Names, nicknames, stages and copy come back in the market’s language. Pass <c>?locale=</c> (takes precedence) or the <c>Accept-Language</c> header; with neither, <c>pt-BR</c> applies. The response includes <c>Content-Language</c>. Dates and times are returned in ISO 8601 in the <c>?tz=</c> time zone (any IANA zone; UTC by default).',
          headLocale: 'Locale',
          headMarket: 'Market',
          argentina: 'The same competition for an Argentine audience, with Buenos Aires times:',
          fallbackTitle: 'Language fallback',
          fallback:
            'When there’s no text in the requested locale, the API tries the language (<c>es-AR → es</c>), then English, and finally the official name. A locale outside the list returns <c>400 INVALID_PARAMS</c>.',
        },
        cache: {
          title: 'Caching and ETag',
          body: 'Every <c>200</c> response includes <c>ETag</c> and <c>Cache-Control</c>. Send the ETag back in <c>If-None-Match</c>: if nothing changed, the response is a <c>304</c> with no body. The TTL depends on the kind of data:',
          headResource: 'Resource',
          headTtl: 'CDN TTL',
          catalog: { name: 'Countries, competitions, teams, venues, navigation', ttl: '24 h' },
          squads: { name: 'Squads and standings', ttl: '1 h' },
          today: { name: 'Today’s schedule', ttl: '5 min' },
          live: { name: 'Live event', ttl: '5–15 s' },
          whereToWatch: { name: 'Where to watch', ttl: '60 s' },
          ai: { name: 'AI preview and recap', ttl: '1 h' },
          semantic: { name: 'Semantic (derbies, profiles, glossary)', ttl: '24 h (derby head-to-head: 1 h)' },
          images: {
            name: 'Images (logos, flags, photos)',
            ttl: '30 days, immutable (new version = new URL)',
          },
          purge:
            'Important changes (score, status, where to watch) also purge the cache immediately and are delivered in <a>real time</a>.',
          code: {
            first: '1st call: store the ETag',
            revalidate: 'Revalidation: 304 with no body while nothing has changed',
            unchanged: 'nothing changed: reuse it',
          },
        },
        pagination: {
          title: 'Cursor pagination',
          body: 'Long lists (<c>/v1/events</c>, <c>/v1/competitions</c>, <c>/v1/teams</c>, team matches…) return <c>{page}</c>. Repeat the same query with <c>?cursor=</c> until <c>next_cursor</c> is <c>null</c>. <c>limit</c> ranges from 1 to 200 (default 50). Short lists (<c>/v1/sports</c>, <c>/v1/countries</c>) come back whole in <c>{list}</c>.',
          calloutTitle: 'The cursor is opaque',
          callout:
            'Don’t build or modify the cursor: it encodes the position in the requested sort order. If you change a filter, start again from the first page.',
          code: {
            first: '1st page',
            next: 'Next: repeat the same query with the cursor you received',
            paginate: 'Walks through every page of a cursor-paginated list.',
          },
        },
        errors: {
          title: 'Errors',
          body: 'Errors follow RFC 9457 (<c>application/problem+json</c>), with a stable <c>code</c> to handle in your code. Error responses are never cached.',
          headStatus: 'Status and code',
          headWhen: 'When',
          invalidParams: 'Invalid parameter; errors contains [{ path, message }].',
          invalidKey: 'Missing, invalid, expired or revoked key.',
          moduleNotInPlan: 'The route (or the sport) is not in your contract.',
          marketNotInPlan: 'The requested country is not among your markets.',
          notFound: 'Entity or route does not exist.',
          rateLimited: 'Window limit reached; see retry-after.',
          quotaExceeded:
            'The plan daily quota went over 110%; it resets at the turn of the day (UTC). From 80%, responses carry x-galaxie-quota-warning.',
          degraded: 'Rare: source unavailable and no valid previous data.',
          maintenance: 'Platform update in progress (seconds); try again after retry-after.',
          internal: 'Unexpected error (logged on our side).',
          code: {
            notFound: 'the entity does not exist (or was removed from the catalog)',
            outsidePlan: 'outside your contract',
            retry: 'wait retry-after seconds and try again',
          },
        },
        versioning: {
          title: 'Versioning',
          stable: '<c>/v1</c> is stable: breaking changes go to <c>/v2</c>, with 6 months of overlap.',
          newFields: 'New fields may appear at any time: ignore the ones you don’t recognize.',
          missing:
            'Data the source hasn’t delivered yet comes back as <c>null</c> or an empty list, never as an error (e.g. a lineup with <c>available: false</c>).',
        },
      },
      modules: {
        lead: 'Your contract defines modules (groups of routes), markets (countries) and sports. The same key accesses everything your plan includes.',
        plans: {
          title: 'Plans',
          headPlan: 'Plan',
          headId: 'Identifier',
          headModules: 'Included modules',
          enterprise: 'all modules, custom limits',
          body: 'Beyond modules, each contract can restrict <b>markets</b> (countries, for per-country routes such as where to watch) and <b>sports</b>. The per-minute limit and daily quota also vary by plan.',
        },
        list: {
          title: 'Modules and routes',
          coreData: {
            name: 'Core Data',
            what: 'Catalog, schedule, events, teams, people, venues, competition context, real-time score/status/incidents and the compatible mirror.',
          },
          whereToWatch: {
            name: 'Where to watch',
            what: 'Confirmed broadcast options per event and country, plus the where_to_watch.changed topic.',
          },
          semantic: {
            name: 'Semantic',
            what: 'Team identity (nicknames, fan base, chants), derbies with head-to-head records, rivals, glossary and microcopy per market.',
          },
          liveIntelligence: {
            name: 'Live Intelligence',
            what: 'Pre-match preview and post-match recap generated from the facts (with sources), also in the event detail, plus the event.context_published topic.',
          },
          multisport: {
            name: 'Multi-sport',
            what: 'Olympics and Pan American Games: editions, medal table, schedule, events, delegations and history.',
          },
          account:
            'Account routes (<c>/v1/account/*</c>) require no module: every contract can check its own plan, keys and usage. The full list per module is in the <a>reference</a>.',
        },
        outside: {
          title: 'Outside your contract',
          headSituation: 'Situation',
          headResponse: 'Response',
          module: 'Route from a module you haven’t licensed',
          sport: 'Sport outside your contract (schedule, mirror, stream)',
          market: 'Country outside your markets (e.g. where to watch)',
          topic: 'Real-time topic from a module you haven’t licensed',
          example:
            'Example: where to watch requires the <c>where_to_watch</c> module and the country among your markets.',
          calloutTitle: 'No information is still a response',
          callout:
            'With the module licensed and no reliable option for the match, where to watch returns <c>200</c> with <c>status: "unknown"</c>, <c>options: []</c> and a localized <c>message</c> — the event still exists.',
        },
        check: {
          title: 'Check what your key unlocks',
          account:
            '<c>GET /v1/account</c> returns <c>tenant.modules</c>, <c>tenant.markets</c>, <c>tenant.sports</c> and <c>key.effectiveModules</c> (what the key in use actually unlocks).',
          scoped:
            'A key scoped more narrowly than the contract gets a 403 on routes from the modules left out.',
        },
      },
      realtime: {
        lead: 'Score, status, incidents, where to watch and AI context change all the time. Instead of polling again, receive only what changed: over SSE (an open connection) or webhooks (a signed POST to your server).',
        feed: {
          title: 'Change feed',
          body: 'Every client-visible change goes into an ordered change feed with an increasing <c>id</c>. The same record goes out over SSE and webhooks — and it also purges the API and CDN cache, so the next REST read is already up to date. The message is compact (the topic, the fields that changed and their new values); for the full state, read the event’s REST route.',
          headShort: 'Short (?topics=)',
          headTopic: 'Topic',
          headWhen: 'When',
          headModule: 'Module',
          status: 'status, status_detail or the clock changed',
          score: 'The score changed',
          incidents: 'New incident on the timeline (goal, card, VAR…)',
          whereToWatch: 'Broadcast option added, corrected or removed',
          context: 'AI preview/recap published or revised',
          sampleTitle: 'RealtimeChange (SSE data: and webhook body)',
          data: '<c>data</c> per topic: <c>status</c>/<c>status_detail</c>/<c>clock</c> (with <c>previous.status</c>); <c>score</c>; <c>incidents</c> (the new incidents); <c>countries</c> (where-to-watch countries affected); <c>contexts</c> (locale and type published).',
        },
        sse: {
          title: 'SSE — GET /v1/stream',
          headParam: 'Parameter',
          headRule: 'Rule',
          events: 'Up to 200 event IDs, comma-separated. Empty = every event in your contract.',
          filters: 'Additional filters (up to 50 competitions, 20 sports).',
          topics: 'Short or full names; default: every topic in your plan.',
          resume: 'Resume: replays, in order, the changes after that id.',
          token:
            'Short-lived token (5 min) for the browser’s EventSource, which can’t send headers: request it with POST /v1/stream/token from your backend.',
          key: 'Deprecated: accepted until 2026-12-27, with the Deprecation and Sunset headers. Use ?token= in the browser or the header.',
          body: 'Each message has <c>id:</c>, <c>event:</c> (the topic) and <c>data:</c> (JSON). The stream starts with <c>retry: 3000</c>, sends <c>event: ready</c> after replaying and a heartbeat comment every 15 s.',
          atLeastOnce: 'At-least-once delivery, in id order: treat changes as idempotent by their <c>id</c>.',
          replay:
            'Resuming keeps up to 5000 changes; beyond that you get <c>event: replay_truncated</c> and the client should reload state from REST.',
          connections:
            'There is a limit on concurrent connections per contract; above it, <c>429 RATE_LIMITED</c> with <c>retry-after</c>.',
          code: {
            browserTab: 'Browser',
            noBuffer: '-N: no buffering, prints messages as they arrive',
            resumeAfter: 'optional: resume after this change',
            server: 'Server (Node 20+): fetch with the key in the header and read the stream.',
            keepId: 'keep it to resume after a disconnect',
            dropped: 'connection dropped: call listen() again (resumes from lastEventId)',
            heartbeat: 'heartbeat every 15 s',
            control: 'retry/ready: stream control',
            readTimeout: 'read > 15 s heartbeat',
            heartbeatShort: 'heartbeat',
            endOfMessage: 'end of message',
            browserKey1: 'EventSource can’t send headers: the /stream-token route of YOUR backend calls',
            browserKey2:
              'POST /v1/stream/token with the key in the header and returns a 5-min token. The key never reaches the browser.',
            updateScore: 'updateScore',
            reconnect:
              'Dropped or expired token: close, request a new token and reopen with &last_event_id= (the last e.lastEventId).',
          },
        },
        webhooks: {
          title: 'Webhooks',
          body: 'Galaxie sends a <c>POST</c> with the <c>RealtimeChange</c> in the body to the HTTPS URL you register during onboarding, with the same filters as SSE (topics, events, competitions, sports). The signing secret (<c>whsec_…</c>) is delivered only once.',
          headHeader: 'Header',
          headValue: 'Value',
          signature: 't=<unix seconds>,v1=<hex of HMAC-SHA256(secret, "<t>.<raw body>")>',
          event: 'Topic (e.g. event.score_changed)',
          delivery: 'Delivery ID',
          attempt: 'Attempt (1, 2, …)',
          idempotency: 'Same across all attempts: use it to drop duplicates',
          retriesTitle: 'Retries',
          retries:
            'Any response outside 2xx (redirects included) or taking longer than 10 s counts as a failure. Galaxie retries with exponential backoff (10 s, 20 s, 40 s…, up to 1 h) for up to 10 attempts; after that, the delivery goes to a reprocessing queue. Respond quickly and process asynchronously.',
          code: {
            verify: 'Verifies x-galaxie-signature over the RAW body (before JSON.parse).',
            verifyPy: 'Verifies x-galaxie-signature over the RAW body (before json.loads).',
            replay: 'replay protection',
            dedupe: 'drop duplicates using the idempotency-key header',
            respondFast: 'respond quickly; process asynchronously',
          },
        },
        polling: {
          title: 'Polling (simple clients)',
          body: 'Without SSE or webhooks, query <c>GET /v1/events/live</c> with <c>If-None-Match</c>: while nothing changes, the response is a <c>304</c> with no body. This route’s TTL is 10 s.',
        },
      },
      reference: {
        lead: 'All {total} operations in the OpenAPI 3.1 spec (version {version}), generated from the same schemas the API validates against. To try out calls, use the interactive reference.',
        interactive: 'Interactive reference',
        external:
          'The interactive reference (Scalar) opens in a new tab: the API can’t be embedded in other pages (clickjacking protection). Import <c>openapi.json</c> into Postman, Insomnia or a client generator.',
        common:
          'Routes tagged <c>locale · tz</c> accept <c>?locale=</c> (or <c>Accept-Language</c>) and <c>?tz=</c> (see <a>Concepts</a>). The codes after the response type are the possible errors, always as <c>application/problem+json</c>; <c>304</c> is ETag revalidation.',
        specLanguage:
          'Operation summaries, descriptions and parameters come straight from the OpenAPI spec, which is written in Portuguese.',
        sections: 'Reference sections',
        path: 'path',
        required: 'required',
        default: 'default {value}',
        example: 'e.g. {value}',
        body: 'Body (JSON):',
        errors: 'Errors as application/problem+json',
        tags: {
          catalog: { name: 'Catalog', description: 'Sports, countries, competitions, standings and venues.' },
          search: {
            name: 'Search',
            description: 'Global search across teams, competitions, matches, people, stadiums and countries.',
          },
          events: {
            name: 'Events',
            description: 'Schedule, live, detail, timeline, lineups and stats.',
          },
          teams: { name: 'Teams and people', description: 'Teams, squads and people.' },
          semantic: {
            name: 'Semantic',
            description: 'Team identity, derbies, rivals, glossary and microcopy per market.',
          },
          whereToWatch: { name: 'Where to watch', description: 'Broadcast options per event and country.' },
          related: {
            name: 'Related content',
            description: 'Direct videos per event, classified by type and format.',
          },
          multisport: {
            name: 'Multi-sport',
            description: 'Olympics and Pan American Games: editions, medals, schedule and history.',
          },
          realtime: { name: 'Real time', description: 'SSE and signed webhooks.' },
          mirror: { name: 'Mirror', description: 'Mirror compatible with the upstream provider format.' },
          account: { name: 'Account', description: 'Contract self-service: plan, keys and usage.' },
          other: { name: 'Other', description: 'Other operations.' },
        },
      },
    },
    'es-AR': {
      meta: {
        title: '{page} · Documentación',
      },
      badge: 'Documentación de la API',
      pager: {
        label: 'Otras guías',
        previous: 'Anterior',
        next: 'Siguiente',
      },
      requests: {
        overview:
          'Ficha del equipo: posición en las competencias, racha, últimos partidos y próximo partido.',
        teamEvents: 'Partidos del equipo a partir de una fecha.',
        event: 'Evento completo.',
        account: 'Plan, módulos, mercados y la clave en uso.',
        usage: 'Solicitudes por día y ruta.',
        competitionEs: 'La misma competencia con nombres y horarios para Argentina.',
        competitions: 'Competencias de fútbol de Brasil (primera página).',
        whereToWatch: 'Dónde ver el partido en Brasil.',
        semantic: 'Tarjeta de identidad del equipo.',
        live: 'Eventos en vivo (polling con ETag).',
      },
      start: {
        lead: 'La API de Galaxie Sports entrega metadatos deportivos de América Latina y del mundo: catálogo, agenda, equipos, personas, dónde ver y contexto editorial, en 8 locales. Esta guía te lleva de la clave a la primera respuesta.',
        baseUrl: {
          title: 'URL base y especificación',
          body: 'Todas las rutas están bajo <c>{apiUrl}</c>. La API canónica está versionada en <c>/v1</c> y orientada a eventos: el mismo formato sirve para todos los deportes. También hay un espejo compatible (<c>{mirror}</c>) para quienes ya consumen el formato del proveedor de origen.',
          headResource: 'Recurso',
          headWhere: 'Dónde',
          interactive: 'Referencia interactiva',
          routes: 'Lista de rutas en esta demo',
        },
        firstCall: {
          title: '1. Primera llamada',
          body: 'Mandá la clave en el header <c>x-galaxie-key</c> (mirá <auth>Autenticación</auth>). La ficha de un equipo trae, en una sola llamada, su posición en cada competencia, la racha reciente, los últimos partidos y el próximo — acá, Palmeiras:',
          response: 'Respuesta (resumida):',
        },
        navigate: {
          title: '2. Navegá por los IDs',
          body: 'Toda entidad tiene un ID canónico (UUID) que conecta las respuestas entre sí: el <c>event_id</c> de la racha abre el evento, el <c>venue.id</c> abre el estadio, el <c>competition.slug</c> abre la competencia. Para listar los partidos del equipo a partir de una fecha:',
          openEvent:
            'Y para abrir uno de esos partidos, con resultado, fase, clásico y lo que está en juego:',
          calloutTitle: 'Mirá el código de cualquier pantalla',
          callout:
            'En las páginas de la demo, el botón <b>Ver código</b> (ícono {icon}) en el encabezado y en cada sección muestra la solicitud exacta que generó esos datos, con los IDs de la página.',
        },
        map: {
          title: 'Mapa de la API',
          headArea: 'Área',
          headRoute: 'Ruta de entrada',
          headWhat: 'Qué tiene',
          catalog: { area: 'Catálogo', what: 'Deportes, países, competencias, tablas y estadios.' },
          navigation: {
            area: 'Navegación',
            what: 'Menú listo: deportes y países con bandera y confederación.',
          },
          events: {
            area: 'Eventos',
            what: 'Agenda multideporte, en vivo, detalle, timeline, formaciones, estadísticas, h2h.',
          },
          teams: { area: 'Equipos y personas', what: 'Equipos, planteles, jugadores y técnicos.' },
          whereToWatch: { area: 'Dónde ver', what: 'Opciones de transmisión por evento y país.' },
          semantic: {
            area: 'Semántica',
            what: 'Apodos, clásicos, rivales, glosario y microcopy por mercado.',
          },
          multisport: {
            area: 'Multideporte',
            what: 'Juegos Olímpicos y Panamericanos: ediciones, medallero, agenda.',
          },
          realtime: { area: 'Tiempo real', what: 'Cambios por SSE; webhooks firmados con HMAC.' },
          account: { area: 'Cuenta', what: 'Plan, claves y uso de tu contrato.' },
        },
        next: {
          title: 'Próximos pasos',
          concepts:
            '<a>Conceptos</a>: locales y huso horario, caché con ETag, paginación por cursor y el formato de los errores.',
          modules: '<a>Módulos y planes</a>: qué habilita tu contrato.',
          realtime: '<a>Tiempo real</a>: resultado y estado sin polling, por SSE o webhook.',
        },
      },
      auth: {
        lead: 'Cada solicitud lleva la clave de tu contrato en el header x-galaxie-key. La clave define el plan, los módulos, los mercados y el límite de uso.',
        key: {
          title: 'La clave en el header',
          body: 'Mandá <c>x-galaxie-key: {key}</c> en todas las rutas <c>/v1</c> y <c>/mirror</c>. Solo <c>/openapi.json</c> y la referencia <c>/docs</c> son públicos. Sin clave, o con una clave inválida, la respuesta es <c>401 INVALID_KEY</c>.',
          headItem: 'Ítem',
          headHow: 'Cómo funciona',
          format: {
            name: 'Formato',
            value:
              '<c>gs_live_…</c> (producción) o <c>gs_test_…</c> (pruebas: mismos datos, 60 req/min por ruta y uso aparte), con un prefijo público de 12 caracteres y un checksum al final',
          },
          display: {
            name: 'Visualización',
            value:
              'La clave completa aparece una sola vez, al crearla o rotarla. Galaxie guarda solo el hash.',
          },
          scopes: {
            name: 'Alcances',
            value:
              'Una clave puede limitarse a algunos módulos del contrato (por ej.: una clave solo de core_data para el navegador).',
          },
          revocation: {
            name: 'Revocación',
            value: 'La revocación, la suspensión y el cambio de plan se aplican en hasta 60 segundos.',
          },
          calloutTitle: 'La clave queda en el servidor',
          callout:
            'No pongas la clave en apps, páginas ni repositorios. Llamá a la API desde tu backend (esta demo lo hace así: el navegador habla con un proxy del servidor, que inyecta la clave). En los ejemplos, reemplazá <c>{key}</c> por la variable de entorno con tu clave.',
        },
        account: {
          title: 'Revisá tu contrato',
          body: '<c>GET /v1/account</c> no requiere módulo: devuelve el plan, los módulos contratados, los mercados (países), los deportes, el límite por minuto y los datos de la clave en uso — <c>effectiveModules</c> es lo que esa clave realmente habilita (módulos del contrato ∩ alcances de la clave).',
          sampleTitle: '200 OK (ejemplo)',
          selfService:
            'También en autogestión: <c>GET /v1/account/keys</c> lista las claves (solo metadatos, nunca el secreto) y <c>GET /v1/account/usage</c> trae las solicitudes por día y ruta (hasta 92 días):',
        },
        rotation: {
          title: 'Rotación sin downtime',
          body: '<c>POST /v1/account/keys/rotate</c> crea una clave nueva (mismo rótulo, alcances, entorno y vencimiento) y mantiene la actual válida durante <c>graceSeconds</c> (por defecto 86400 = 24 h; 0 la revoca ya; máximo 7 días). Publicá la nueva clave en tus servidores dentro de ese plazo. Cada clave se rota una sola vez: rotar de nuevo la anterior, ya en su período de gracia, responde 409 <c>CONFLICT</c>; rotá la nueva.',
          code: {
            grace: 'la clave actual sigue valiendo 24 h más',
            failed: 'la rotación falló',
            newKey:
              'key.key es la clave nueva completa: aparece solo en esta respuesta, guardala ya en tu bóveda de secretos',
            newKeyPy: 'rotated["key"]["key"] es la clave nueva completa: aparece solo en esta respuesta',
          },
        },
        limits: {
          title: 'Límites de uso',
          body: 'El límite es por contrato y por ruta, en una ventana de 60 segundos. Toda respuesta autenticada trae:',
          headHeader: 'Header',
          headMeaning: 'Significado',
          limit: 'Solicitudes permitidas en la ventana (por ruta).',
          remaining: 'Cuántas quedan en la ventana actual.',
          reset: 'Segundos hasta que la ventana se reinicie.',
          retryAfter: 'Solo en el 429 RATE_LIMITED: cuánto esperar antes de reintentar.',
          cache:
            'Respetá la caché (<c>ETag</c> y <c>Cache-Control</c>): una respuesta 304 es más rápida y tu CDN la puede servir sin llamar a la API.',
          realtime:
            'Para resultados en vivo, preferí el tiempo real (SSE o webhook) antes que un polling corto.',
          code: {
            headers: '-i muestra los headers de la respuesta',
            retry: 'GET con un reintento cuando se supera el límite (el 429 trae retry-after en segundos).',
          },
        },
      },
      concepts: {
        lead: 'Lo que vale para todas las rutas: identificadores, idioma y huso horario, caché, paginación, errores y versionado.',
        ids: {
          title: 'IDs canónicos',
          body: 'Toda entidad (competencia, temporada, equipo, persona, evento, estadio) tiene un ID propio de Galaxie, un UUID estable: no cambia cuando cambia la fuente de datos y es el mismo en todos los locales. Usalo como clave en tu base.',
          competitions: 'Las competencias aceptan el UUID o el slug: <c>{path}</c>.',
          derbies:
            'Los clásicos usan el slug: <c>{path}</c>. Las rutas de semántica del equipo aceptan el UUID o el slug del perfil (<c>/v1/teams/palmeiras/semantic</c>).',
          externalIds:
            '<c>external_ids</c> (equipos, competencias, personas) trae los IDs de la fuente de origen, para cruzarlos con una base que ya tengas.',
          links:
            'Las respuestas se conectan por los IDs: el <c>participants[].id</c> del evento abre el equipo, <c>venue.id</c> abre el estadio, <c>competition.slug</c> abre la competencia.',
        },
        locales: {
          title: 'Locales y huso horario',
          body: 'Nombres, apodos, fases y textos salen en el idioma del mercado. Indicá <c>?locale=</c> (tiene prioridad) o el header <c>Accept-Language</c>; sin ninguno de los dos, vale <c>pt-BR</c>. La respuesta trae <c>Content-Language</c>. Fechas y horas salen en ISO 8601 en el huso de <c>?tz=</c> (cualquier huso IANA; por defecto UTC).',
          headLocale: 'Locale',
          headMarket: 'Mercado',
          argentina: 'La misma competencia para el público argentino, con horarios de Buenos Aires:',
          fallbackTitle: 'Fallback de idioma',
          fallback:
            'Si no hay texto en el locale pedido, la API prueba con el idioma (<c>es-AR → es</c>) y después con el inglés; por último, el nombre oficial. Un locale fuera de la lista responde <c>400 INVALID_PARAMS</c>.',
        },
        cache: {
          title: 'Caché y ETag',
          body: 'Toda respuesta <c>200</c> trae <c>ETag</c> y <c>Cache-Control</c>. Reenviá el ETag en <c>If-None-Match</c>: si nada cambió, la respuesta es <c>304</c> sin cuerpo. El TTL depende del tipo de dato:',
          headResource: 'Recurso',
          headTtl: 'TTL en la CDN',
          catalog: { name: 'Países, competencias, equipos, estadios, navegación', ttl: '24 h' },
          squads: { name: 'Planteles y tablas', ttl: '1 h' },
          today: { name: 'Agenda del día', ttl: '5 min' },
          live: { name: 'Evento en vivo', ttl: '5–15 s' },
          whereToWatch: { name: 'Dónde ver', ttl: '60 s' },
          ai: { name: 'Previa y resumen de IA', ttl: '1 h' },
          semantic: {
            name: 'Semántica (clásicos, perfiles, glosario)',
            ttl: '24 h (historial del clásico: 1 h)',
          },
          images: {
            name: 'Imágenes (escudos, banderas, fotos)',
            ttl: '30 días, inmutables (nueva versión = nueva URL)',
          },
          purge:
            'Los cambios importantes (resultado, estado, dónde ver) también purgan la caché en el momento y llegan por <a>tiempo real</a>.',
          code: {
            first: '1.ª llamada: guardá el ETag',
            revalidate: 'Revalidación: 304 sin cuerpo mientras nada cambie',
            unchanged: 'nada cambió: reutilizá',
          },
        },
        pagination: {
          title: 'Paginación por cursor',
          body: 'Las listas largas (<c>/v1/events</c>, <c>/v1/competitions</c>, <c>/v1/teams</c>, partidos del equipo…) responden <c>{page}</c>. Repetí la misma query con <c>?cursor=</c> hasta que <c>next_cursor</c> venga <c>null</c>. <c>limit</c> va de 1 a 200 (por defecto 50). Las listas cortas (<c>/v1/sports</c>, <c>/v1/countries</c>) vienen enteras en <c>{list}</c>.',
          calloutTitle: 'El cursor es opaco',
          callout:
            'No armes ni modifiques el cursor: codifica la posición en el orden pedido. Si cambiaste un filtro, empezá de nuevo desde la primera página.',
          code: {
            first: '1.ª página',
            next: 'Siguiente: repetí la misma query con el cursor recibido',
            paginate: 'Recorre todas las páginas de una lista paginada por cursor.',
          },
        },
        errors: {
          title: 'Errores',
          body: 'Los errores siguen la RFC 9457 (<c>application/problem+json</c>), con un <c>code</c> estable para manejar en el código. Las respuestas de error nunca se cachean.',
          headStatus: 'Estado y código',
          headWhen: 'Cuándo',
          invalidParams: 'Parámetro inválido; errors trae [{ path, message }].',
          invalidKey: 'Clave ausente, inválida, vencida o revocada.',
          moduleNotInPlan: 'La ruta (o el deporte) no está en tu contrato.',
          marketNotInPlan: 'El país pedido no está en tus mercados.',
          notFound: 'Entidad o ruta inexistente.',
          rateLimited: 'Se alcanzó el límite de la ventana; mirá retry-after.',
          quotaExceeded:
            'La cuota diaria del plan pasó del 110%; vuelve con el cambio de día (UTC). Desde el 80%, las respuestas traen x-galaxie-quota-warning.',
          degraded: 'Poco común: fuente no disponible y ningún dato anterior válido.',
          maintenance:
            'Actualización de la plataforma en curso (segundos); probá de nuevo después de retry-after.',
          internal: 'Error inesperado (registrado de nuestro lado).',
          code: {
            notFound: 'la entidad no existe (o salió del catálogo)',
            outsidePlan: 'fuera del contrato',
            retry: 'esperá retry-after segundos y volvé a intentar',
          },
        },
        versioning: {
          title: 'Versionado',
          stable:
            '<c>/v1</c> es estable: los cambios incompatibles van a <c>/v2</c>, con 6 meses de convivencia.',
          newFields: 'Pueden aparecer campos nuevos en cualquier momento: ignorá los que no conozcas.',
          missing:
            'Los datos que la fuente todavía no entregó vienen como <c>null</c> o lista vacía, nunca como error (por ej.: formación con <c>available: false</c>).',
        },
      },
      modules: {
        lead: 'El contrato define módulos (grupos de rutas), mercados (países) y deportes. La misma clave accede a todo lo que incluye el plan.',
        plans: {
          title: 'Planes',
          headPlan: 'Plan',
          headId: 'Identificador',
          headModules: 'Módulos incluidos',
          enterprise: 'todos los módulos, límites a medida',
          body: 'Además de los módulos, cada contrato puede restringir <b>mercados</b> (países, para las rutas por país como dónde ver) y <b>deportes</b>. El límite por minuto y la cuota diaria también varían según el plan.',
        },
        list: {
          title: 'Módulos y rutas',
          coreData: {
            name: 'Core Data',
            what: 'Catálogo, agenda, eventos, equipos, personas, estadios, contexto de la competencia, tiempo real de resultado/estado/jugadas y el espejo compatible.',
          },
          whereToWatch: {
            name: 'Dónde ver',
            what: 'Opciones de transmisión confirmadas por evento y país, y el tópico where_to_watch.changed.',
          },
          semantic: {
            name: 'Semántica',
            what: 'Identidad de los equipos (apodos, hinchada, cantitos), clásicos con historial, rivales, glosario y microcopy por mercado.',
          },
          liveIntelligence: {
            name: 'Live Intelligence',
            what: 'Previa y resumen del partido generados a partir de los hechos (con fuentes), también en el detalle del evento, y el tópico event.context_published.',
          },
          multisport: {
            name: 'Multideporte',
            what: 'Juegos Olímpicos y Panamericanos: ediciones, medallero, agenda, pruebas, delegaciones e historial.',
          },
          account:
            'Las rutas de cuenta (<c>/v1/account/*</c>) no requieren módulo: todo contrato consulta su propio plan, sus claves y su uso. La lista completa por módulo está en la <a>referencia</a>.',
        },
        outside: {
          title: 'Fuera del contrato',
          headSituation: 'Situación',
          headResponse: 'Respuesta',
          module: 'Ruta de un módulo no contratado',
          sport: 'Deporte fuera del contrato (agenda, espejo, stream)',
          market: 'País fuera de los mercados (por ej.: dónde ver)',
          topic: 'Tópico de tiempo real de un módulo no contratado',
          example:
            'Ejemplo: dónde ver requiere el módulo <c>where_to_watch</c> y el país dentro de los mercados.',
          calloutTitle: 'Sin información también es una respuesta',
          callout:
            'Con el módulo contratado y ninguna opción confiable para el partido, dónde ver responde <c>200</c> con <c>status: "unknown"</c>, <c>options: []</c> y un <c>message</c> localizado — el evento sigue existiendo.',
        },
        check: {
          title: 'Revisar qué habilita la clave',
          account:
            '<c>GET /v1/account</c> responde <c>tenant.modules</c>, <c>tenant.markets</c>, <c>tenant.sports</c> y <c>key.effectiveModules</c> (lo que la clave en uso habilita de verdad).',
          scoped:
            'Una clave con un alcance menor que el contrato recibe 403 en las rutas de los módulos que quedan afuera.',
        },
      },
      realtime: {
        lead: 'Resultado, estado, jugadas, dónde ver y contexto de IA cambian todo el tiempo. En vez de volver a consultar, recibí solo lo que cambió: por SSE (conexión abierta) o webhook (POST firmado en tu servidor).',
        feed: {
          title: 'Change feed',
          body: 'Todo cambio visible para el cliente entra en un change feed ordenado, con un <c>id</c> creciente. El mismo registro sale por SSE y por los webhooks — y además purga la caché de la API y de la CDN, así que la próxima lectura REST ya viene actualizada. El mensaje es compacto (el tópico, los campos que cambiaron y los valores nuevos); para el estado completo, leé la ruta REST del evento.',
          headShort: 'Corto (?topics=)',
          headTopic: 'Tópico',
          headWhen: 'Cuándo',
          headModule: 'Módulo',
          status: 'Cambió status, status_detail o el reloj',
          score: 'Cambió el resultado',
          incidents: 'Jugada nueva en la timeline (gol, tarjeta, VAR…)',
          whereToWatch: 'Opción de transmisión agregada, corregida o eliminada',
          context: 'Previa/resumen de IA publicado o revisado',
          sampleTitle: 'RealtimeChange (data: del SSE y cuerpo del webhook)',
          data: '<c>data</c> por tópico: <c>status</c>/<c>status_detail</c>/<c>clock</c> (con <c>previous.status</c>); <c>score</c>; <c>incidents</c> (las jugadas nuevas); <c>countries</c> (países afectados de dónde ver); <c>contexts</c> (locale y tipo publicados).',
        },
        sse: {
          title: 'SSE — GET /v1/stream',
          headParam: 'Parámetro',
          headRule: 'Regla',
          events: 'Hasta 200 IDs de evento, separados por coma. Vacío = todos los eventos del contrato.',
          filters: 'Filtros adicionales (hasta 50 competencias, 20 deportes).',
          topics: 'Nombres cortos o completos; por defecto: todos los del plan.',
          resume: 'Retoma: reenvía en orden los cambios posteriores a ese id.',
          token:
            'Token corto (5 min) para el EventSource del navegador, que no manda headers: pedilo con POST /v1/stream/token desde tu backend.',
          key: 'Obsoleto: se acepta hasta el 27/12/2026, con los headers Deprecation y Sunset. Usá ?token= en el navegador o el header.',
          body: 'Cada mensaje tiene <c>id:</c>, <c>event:</c> (el tópico) y <c>data:</c> (JSON). El stream arranca con <c>retry: 3000</c>, manda <c>event: ready</c> después de la retoma y un comentario de heartbeat cada 15 s.',
          atLeastOnce:
            'Entrega al menos una vez, en orden de id: tratá los cambios como idempotentes por su <c>id</c>.',
          replay:
            'La retoma guarda hasta 5000 cambios; por encima de eso llega <c>event: replay_truncated</c> y el cliente tiene que recargar el estado por REST.',
          connections:
            'Hay un límite de conexiones simultáneas por contrato; por encima, <c>429 RATE_LIMITED</c> con <c>retry-after</c>.',
          code: {
            browserTab: 'Navegador',
            noBuffer: '-N: sin buffer, muestra los mensajes a medida que llegan',
            resumeAfter: 'opcional: retoma después de este cambio',
            server: 'Servidor (Node 20+): fetch con la clave en el header y lectura del stream.',
            keepId: 'guardalo para retomar después de una caída',
            dropped: 'se cayó la conexión: llamá a listen() de nuevo (retoma desde lastEventId)',
            heartbeat: 'heartbeat cada 15 s',
            control: 'retry/ready: control del stream',
            readTimeout: 'lectura > heartbeat de 15 s',
            heartbeatShort: 'heartbeat',
            endOfMessage: 'fin del mensaje',
            browserKey1:
              'EventSource no manda headers: la ruta /stream-token de TU backend llama a POST /v1/stream/token con',
            browserKey2:
              'la clave en el header y devuelve un token de 5 min. La clave nunca llega al navegador.',
            updateScore: 'actualizarResultado',
            reconnect:
              'Caída o token vencido: cerrá, pedí otro token y reabrí con &last_event_id= (el último e.lastEventId).',
          },
        },
        webhooks: {
          title: 'Webhooks',
          body: 'Galaxie hace un <c>POST</c> con el <c>RealtimeChange</c> en el cuerpo a la URL HTTPS que registres en el onboarding, con los mismos filtros del SSE (tópicos, eventos, competencias, deportes). El secreto de firma (<c>whsec_…</c>) se entrega una sola vez.',
          headHeader: 'Header',
          headValue: 'Valor',
          signature: 't=<segundos unix>,v1=<hex de HMAC-SHA256(secreto, "<t>.<cuerpo crudo>")>',
          event: 'Tópico (por ej.: event.score_changed)',
          delivery: 'ID de la entrega',
          attempt: 'Intento (1, 2, …)',
          idempotency: 'Igual en todos los intentos: descartá duplicados con él',
          retriesTitle: 'Reintentos',
          retries:
            'Cualquier respuesta fuera de 2xx (incluso redirecciones) o una demora de más de 10 s cuenta como falla. Galaxie reintenta con espera exponencial (10 s, 20 s, 40 s…, hasta 1 h) durante hasta 10 intentos; después, la entrega queda en una cola de reprocesamiento. Respondé rápido y procesá de forma asíncrona.',
          code: {
            verify: 'Verifica x-galaxie-signature sobre el cuerpo CRUDO (antes del JSON.parse).',
            verifyPy: 'Verifica x-galaxie-signature sobre el cuerpo CRUDO (antes del json.loads).',
            replay: 'protección contra replay',
            dedupe: 'descartá duplicados con el header idempotency-key',
            respondFast: 'respondé rápido; procesá de forma asíncrona',
          },
        },
        polling: {
          title: 'Polling (clientes simples)',
          body: 'Sin SSE ni webhook, consultá <c>GET /v1/events/live</c> con <c>If-None-Match</c>: mientras nada cambie, la respuesta es <c>304</c> sin cuerpo. El TTL de esta ruta es de 10 s.',
        },
      },
      reference: {
        lead: 'Las {total} operaciones de la especificación OpenAPI 3.1 (versión {version}), generadas a partir de los mismos schemas que valida la API. Para probar llamadas, usá la referencia interactiva.',
        interactive: 'Referencia interactiva',
        external:
          'La referencia interactiva (Scalar) se abre en otra pestaña: la API no permite mostrarse dentro de otras páginas (protección contra clickjacking). Importá el <c>openapi.json</c> en Postman, Insomnia o en un generador de clientes.',
        common:
          'Las rutas marcadas con <c>locale · tz</c> aceptan <c>?locale=</c> (o <c>Accept-Language</c>) y <c>?tz=</c> (mirá <a>Conceptos</a>). Los códigos después del tipo de respuesta son los errores posibles, siempre en <c>application/problem+json</c>; <c>304</c> es la revalidación por ETag.',
        specLanguage:
          'Los resúmenes, las descripciones y los parámetros de cada operación vienen tal cual de la especificación OpenAPI, que está escrita en portugués.',
        sections: 'Secciones de la referencia',
        path: 'ruta',
        required: 'obligatorio',
        default: 'por defecto {value}',
        example: 'ej.: {value}',
        body: 'Cuerpo (JSON):',
        errors: 'Errores en application/problem+json',
        tags: {
          catalog: { name: 'Catálogo', description: 'Deportes, países, competencias, tablas y estadios.' },
          search: {
            name: 'Búsqueda',
            description: 'Búsqueda global en equipos, competencias, partidos, personas, estadios y países.',
          },
          events: {
            name: 'Eventos',
            description: 'Agenda, en vivo, detalle, timeline, formaciones y estadísticas.',
          },
          teams: { name: 'Equipos y personas', description: 'Equipos, planteles y personas.' },
          semantic: {
            name: 'Semántica',
            description: 'Identidad de los equipos, clásicos, rivales, glosario y microcopy por mercado.',
          },
          whereToWatch: { name: 'Dónde ver', description: 'Opciones de transmisión por evento y país.' },
          related: {
            name: 'Contenido relacionado',
            description: 'Videos directos por evento, clasificados por tipo y formato.',
          },
          multisport: {
            name: 'Multideporte',
            description: 'Juegos Olímpicos y Panamericanos: ediciones, medallas, agenda e historial.',
          },
          realtime: { name: 'Tiempo real', description: 'SSE y webhooks firmados.' },
          mirror: {
            name: 'Espejo',
            description: 'Espejo compatible con el formato del proveedor de origen.',
          },
          account: { name: 'Cuenta', description: 'Autogestión del contrato: plan, claves y uso.' },
          other: { name: 'Otros', description: 'Otras operaciones.' },
        },
      },
    },
  },
);
