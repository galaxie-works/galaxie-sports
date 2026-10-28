/**
 * Painel de Operação (Ajustes → Operação): flags da operação, agenda dos jobs, status ao vivo e histórico.
 * Os rótulos e descrições das flags ficam aqui, em linguagem de negócio; a chave técnica aparece ao lado.
 */
import { defineMessages } from '../define';

interface SettingText {
  label: string;
  /** Credenciais só têm rótulo. */
  description?: string;
  unit?: string;
}

export default defineMessages(
  {
    meta: { title: 'Sistema' },
    page: {
      title: 'Sistema',
      description:
        'Saúde da operação, ao vivo, agenda dos jobs, IA, fornecedor e logos. O que você muda aqui sobrescreve o .env da VPS sem reiniciar os contêineres.',
      generatedAt: 'Atualizado {when}',
      refresh: 'Atualizar',
    },
    nav: {
      users: 'Usuários',
      system: 'Sistema',
      features: 'Esportes e features',
      review: 'Revisão',
      lineup: 'Grades e ofertas',
      label: 'Seções dos ajustes',
    },
    tabs: {
      status: 'Status',
      quality: 'Qualidade dos dados',
      live: 'Ao vivo',
      schedule: 'Agenda dos jobs',
      ai: 'IA e orçamento',
      wtw: 'Onde Assistir',
      related: 'Conteúdo relacionado',
      provider: 'Fornecedor',
      assets: 'Logos',
      history: 'Histórico',
      sports: 'Esportes',
    },
    features: {
      title: 'Esportes e features',
      description:
        'O que cada esporte usa do fornecedor e as regras de cada feature: vídeos relacionados (com o controle dos canais) e onde assistir. Vale o mesmo do Sistema: muda sem reiniciar os contêineres.',
    },
    sections: {
      live: {
        title: 'Ao vivo',
        description: 'Como o ao vivo acompanha os jogos em andamento e quanto da cota ele usa.',
      },
      schedule: {
        title: 'Agenda dos jobs',
        description:
          'Quando cada job roda (cron de 5 campos, em UTC). O agendador relê a agenda a cada 30 segundos.',
      },
      ai: { title: 'IA e orçamento', description: 'Provedor, modelos e teto diário dos agentes de IA.' },
      wtw: {
        title: 'Onde Assistir',
        description: 'Mercados pesquisados e limites de gasto do Onde Assistir.',
      },
      related: {
        title: 'Conteúdo relacionado',
        description: 'Cota do YouTube e frequência das buscas de vídeos.',
      },
      provider: {
        title: 'Fornecedor (plano e cota)',
        description:
          'Plano padrão da api-sports e a reserva da cota diária. O plano de cada esporte fica em Esportes e features.',
      },
      sports: {
        title: 'Plano de cada esporte',
        description:
          'Plano contratado da API de cada esporte na api-sports. Vazio = herda o plano padrão do Sistema.',
      },
      assets: {
        title: 'Acervo customizado de logos',
        description:
          'Escudos de alta qualidade importados de um acervo próprio (assets:acervo), por cima dos logos do fornecedor.',
      },
      credentials: {
        title: 'Credenciais e infraestrutura',
        description: 'Só mostramos se estão configuradas. Para trocar, edite o .env da VPS.',
      },
    },
    source: {
      db: 'Painel',
      env: 'Env do contêiner',
      default: 'Padrão do código',
      label: 'Origem do valor',
    },
    sourceDetail: {
      db: 'Alterado por {by} {when}.',
      env: 'Vem do .env da VPS.',
      default: 'Nem o painel nem o .env definem: vale o padrão do código.',
      envBehind: 'No .env: {value}',
      noEnv: 'Sem valor no .env',
      defaultIs: 'Padrão: {value}',
      invalidOverride: 'O valor gravado no painel ({value}) não é mais aceito e está sendo ignorado.',
      notReported: 'O contêiner ainda não relatou o próprio env.',
    },
    apply: {
      refresh: 'Vale em até 1 minuto',
      'next-run': 'Vale na próxima execução',
      restart: 'Vale ao reiniciar: {service}',
    },
    services: {
      ingestor: 'Ingestor',
      agents: 'Agentes de IA',
      api: 'API',
      demo: 'Demo',
    },
    values: {
      empty: 'vazio',
      unlimited: 'Sem limite',
      inherit: 'Herdar o padrão ({plan})',
      providerDefault: 'Padrão do provedor: {model}',
      tenantsMarkets: 'Nenhum marcado: mercados dos clientes com o módulo',
      off: 'Desligado',
      auto: 'Automático',
      on: 'Ligado',
      priorities: { high: 'Só alta', medium: 'Média e alta', low: 'Baixa, média e alta' },
      plans: {
        free: 'Free · 100/dia',
        pro: 'Pro · 7.500/dia',
        ultra: 'Ultra · 75.000/dia',
        mega: 'Mega · 150.000/dia',
      },
    },
    actions: {
      save: 'Salvar',
      cancel: 'Cancelar',
      reset: 'Voltar ao padrão',
      resetTitle: 'Voltar {name} ao padrão?',
      resetBody: 'A sobrescrita do painel é apagada e volta a valer {value}.',
      confirmTitle: 'Confirmar mudança em {name}?',
      confirmBody: 'De {from} para {to}. Esta flag afeta custo ou cobertura da operação.',
      confirm: 'Confirmar',
      runNow: 'Rodar agora',
      runNowTitle: 'Rodar {name} agora?',
      runNowBody:
        'O pedido entra na fila do agendador ({service}), que o executa em até 30 segundos. A execução fica registrada como as demais.',
      checkCredit: 'Verificar agora',
      unlimited: 'Sem limite',
      turnOff: 'Desligar',
      turnOn: 'Ligar',
    },
    feedback: {
      saved: 'Configuração salva.',
      reset: 'Voltou ao padrão.',
      queued: 'Pedido na fila do agendador.',
      serviceOffline:
        'Gravado, mas o agendador desse contêiner não relata há alguns minutos: pode estar parado.',
      failed: 'Não foi possível concluir.',
    },
    errors: {
      unknown: 'Flag desconhecida.',
      readonly: 'Credenciais não são editáveis pelo painel.',
      required: 'Informe um valor.',
      enum: 'Use um destes valores: {values}.',
      integer: 'Use um número inteiro.',
      number: 'Use um número.',
      range: 'Use um valor entre {min} e {max}.',
      min: 'Use um valor a partir de {min}.',
      max: 'Use um valor até {max}.',
      cron: 'Agenda inválida: use 5 campos (minuto hora dia mês dia-da-semana) ou "off".',
      markets: 'Mercados não suportados: {values}.',
      format: 'Formato inválido.',
      zero: '0 não é um valor válido: para desligar a IA use AI_STATUS=off (ou AI_AGENT_STATUS para um agente); para tirar o teto, "Sem limite" (unlimited).',
      providerKeyMissing: 'A chave desse provedor não está configurada no contêiner dos agentes.',
      alreadyQueued: 'Já existe um pedido para este job na fila.',
      notRunnable: 'Este job não pode ser disparado pelo painel.',
    },
    cron: {
      next: 'Próximas execuções',
      none: 'Sem próximas execuções',
      off: 'Desligado',
      placeholder: 'ex.: */15 * * * *',
      utc: 'Horários no seu fuso; o cron é em UTC.',
    },
    status: {
      services: 'Agendadores e serviços',
      alive: 'No ar',
      offline: 'Sem sinal',
      never: 'Nunca relatou',
      reported: 'Último sinal {when}',
      startedAt: 'Partida {when}',
      quota: 'Cota da api-sports hoje',
      quotaDay: 'Dia de cota {day} (UTC)',
      quotaUsed: '{used} de {limit} chamadas',
      quotaProvider: 'Contador do fornecedor: {used}/{limit}',
      quotaNoLimit: '{used} chamadas',
      priorities: { BOOTSTRAP: 'Bootstrap', DAILY: 'Diário', LIVE: 'Ao vivo', ADHOC: 'Avulsas' },
      planned: 'planejado {n}',
      noQuota: 'Nenhuma chamada hoje.',
      llm: 'Gasto de IA hoje',
      llmTokens: '{used} de {budget} tokens',
      llmTokensUnlimited: '{used} tokens (sem limite)',
      llmTokenPool: '{agent}: {used} de {budget} tokens (pool próprio, fora do teto global)',
      llmTokenPoolUnlimited: '{agent}: {used} tokens (pool próprio, sem limite)',
      llmErrors: { one: '{count} erro', other: '{count} erros' },
      llmNone: 'Nenhuma chamada de IA hoje.',
      llmUsd: 'US$ {used} de US$ {budget}',
      llmUsdUnlimited: 'US$ {used} (sem limite)',
      llmCalls: '{calls} chamadas · {searches} buscas',
      llmOverSearchCap: {
        one: '{count} chamada passou de {max} buscas',
        other: '{count} chamadas passaram de {max} buscas',
      },
      llmAgentCapped: 'no teto',
      llmAgentDefaultCap: 'teto padrão',
      llmCapOrigin: { db: 'painel', env: 'env', code: 'código' },
      aiState: 'IA: {state}',
      aiOn: 'ligado',
      aiOff: 'desligado',
      aiLimited: 'limitado',
      aiUnlimited: 'sem limite',
      aiUsdPerDay: 'US$ {value}/dia',
      aiTokensPerDay: '{value} tokens/dia',
      aiInvalid: 'Configuração inválida: {keys}. Os agentes ficam sem IA até corrigir.',
      aiInvalidState: 'configuração inválida · sem IA (os agentes seguem só com texto determinístico)',
      aiAgentOnIgnored: '{agents}: on sem efeito, a IA está desligada (AI_STATUS=off é a chave geral).',
      searchesColumn: 'Buscas',
      agent: 'Agente',
      tokensColumn: 'Tokens',
      costColumn: 'US$',
      credit: 'Conta de IA',
      creditPass: 'Com crédito',
      creditWarn: 'Atenção',
      creditNever: 'Ainda não verificada.',
      creditPending: 'Verificação na fila…',
      creditChecked: '{provider} · {model} · verificada {when}',
      creditCodes: {
        ok: 'A chamada de teste passou.',
        no_key: 'Sem chave do provedor configurada: os agentes seguem só com texto determinístico.',
        ai_off: 'IA desligada (AI_STATUS=off): o crédito não é verificado e nenhuma chamada sai.',
        http: 'O provedor respondeu {http} {error}: agentes no texto determinístico.',
        network: 'Sem conexão com o provedor ({error}).',
      },
    },
    jobs: {
      title: 'Jobs',
      columns: {
        job: 'Job',
        schedule: 'Agenda (UTC)',
        last: 'Última execução',
        actions: 'Ações',
      },
      status: {
        ok: 'OK',
        error: 'Erro',
        running: 'Rodando',
        never: 'Nunca rodou',
      },
      duration: 'durou {duration}',
      lastOk: 'último sucesso {when}',
      errors24h: { one: '{count} erro em 24 h', other: '{count} erros em 24 h' },
      queued: 'Na fila ({status})',
      triggers: { schedule: 'agenda', manual: 'manual', start: 'partida', panel: 'painel' },
      off: 'Desligado',
      edit: 'Editar agenda',
      names: {
        'sync-daily': {
          label: 'Sync diário',
          description: 'Jogos de ontem, hoje e amanhã, lesões e detalhe dos encerrados. Gasta cota do dia.',
        },
        'live-run': {
          label: 'Ao vivo',
          description: 'Acompanha os jogos em andamento enquanto houver janela.',
        },
        'live-reconcile': {
          label: 'Reconciliação do ao vivo',
          description:
            'Confirma na fonte os jogos ainda dados como em andamento e corrige status, placar e encerramento. Pela agenda, só os que parecem parados; rodar agora é o botão de pânico: confere todos, até 60 chamadas.',
        },
        'normalize-football': {
          label: 'Normalização do futebol',
          description: 'Transforma o bruto do fornecedor nos dados da API. Não gasta cota.',
        },
        'normalize-sports': {
          label: 'Normalização dos outros esportes',
          description:
            'Transforma em jogos e placares o que o sync diário trouxe dos outros esportes e avança o relógio dos jogos. Não gasta cota.',
        },
        'events-clock': {
          label: 'Relógio dos jogos',
          description: 'Muda o status dos jogos pelo horário (agendado, ao vivo, encerrado).',
        },
        'events-importance': {
          label: 'Importância dos jogos',
          description: 'Recalcula a relevância dos jogos dos próximos 7 dias pela tabela. Não gasta cota.',
        },
        'assets-mirror': {
          label: 'Espelho de imagens',
          description: 'Copia escudos, bandeiras e fotos para o nosso armazenamento.',
        },
        'assets-palette': {
          label: 'Cores dos times',
          description: 'Extrai as cores dos escudos já espelhados.',
        },
        'change-feed-prune': {
          label: 'Limpeza do feed de mudanças',
          description: 'Apaga mudanças antigas do feed que alimenta webhooks e tempo real.',
        },
        'quota-status': {
          label: 'Leitura da cota',
          description: 'Lê o contador oficial do fornecedor (gratuito) e reconcilia a cota do dia.',
        },
        'data-quality': {
          label: 'Qualidade dos dados',
          description:
            'Regras automáticas que comparam o que a API entrega com a referência (F1DB, Wikidata, tabela do fornecedor, dicionário de emissoras) e gravam o placar da aba Qualidade.',
        },
        'bootstrap-catalog': {
          label: 'Catálogo do futebol',
          description: 'Atualiza ligas, temporadas e times. Gasta poucas chamadas, uma vez por semana.',
        },
        'recap-run': {
          label: 'Resumo pós-jogo (IA)',
          description: 'Escreve o resumo dos jogos encerrados em até 10 minutos depois do apito final.',
        },
        'context-run': {
          label: 'Cenário pré-jogo (IA)',
          description: 'O que está em jogo nas próximas 72 horas: tabela, classificação e contexto.',
        },
        'wtw-run': {
          label: 'Onde Assistir: rodadas',
          description: 'Confirma onde cada jogo passa, por mercado, perto do horário do jogo.',
        },
        'wtw-channel': {
          label: 'Onde Assistir: canal do jogo',
          description:
            'Descobre o canal de cada jogo pela escala da rodada: consulta semanal, nova tentativa 3 e 1 dia antes só para quem segue sem canal e, depois do jogo, só os encerrados sem canal.',
        },
        'related-run': {
          label: 'Vídeos relacionados',
          description:
            'Lê os canais oficiais e, como complemento, busca no YouTube os vídeos dos jogos encerrados nas últimas 24 horas.',
        },
        'wtw-rights': {
          label: 'Onde Assistir: direitos',
          description: 'Biblioteca de emissoras e direitos de transmissão por temporada.',
        },
        'review-suggestions': {
          label: 'Revisão semântica: sugestões',
          description:
            'A IA decide as sugestões de edição em aberto: a aprovada entra no ar sem deploy, a recusada fica com o motivo.',
        },
        'lineups-revisit': {
          label: 'Grade de canais: revisita',
          description:
            'Uma vez por semana, relê a página oficial de planos das operadoras vistas há mais de 30 dias; a IA (sem busca na web) só extrai de novo se a página mudou (até 4 chamadas por execução).',
        },
        'lineups-pages': {
          label: 'Grade de canais: página oficial',
          description:
            'Confirma a grade, os inclusos e o preço de cada plano na página oficial da plataforma (com cache de 25 dias, sem IA).',
        },
        'channel-lists': {
          label: 'Lista de canais do cliente',
          description:
            'A IA confere só as sobras do casamento da lista de canais com os direitos; o validador decide o que entra.',
        },
      },
    },
    history: {
      title: 'Histórico de mudanças',
      description: 'Quem mudou o quê e quando, no painel.',
      empty: 'Nenhuma mudança feita pelo painel ainda.',
      when: 'Quando',
      who: 'Quem',
      what: 'Flag',
      change: 'Mudança',
      set: '{from} → {to}',
      base: 'env ou padrão',
      reset: 'Voltou ao padrão (era {from})',
      requests: 'Pedidos de "rodar agora"',
      requestsEmpty: 'Nenhum pedido ainda.',
      requestStatus: {
        pending: 'Na fila',
        running: 'Rodando',
        done: 'Concluído',
        error: 'Falhou',
        skipped: 'Recusado',
        expired: 'Expirou',
      },
      requestDetail: {
        not_allowed: 'job não liberado para o painel',
        already_running: 'já estava rodando',
      },
    },
    quality: {
      title: 'Qualidade dos dados',
      description:
        'Regras automáticas que comparam o que a API entrega com a referência: F1DB, Wikidata, a tabela do fornecedor e o dicionário de emissoras. Rodam todo dia. Cada erro achado na demo vira uma regra.',
      lastRun: 'Última execução: {when} ({trigger})',
      never: 'Ainda não rodou. Use "Rodar agora" ou o quality:run do ingestor.',
      unavailable:
        'As tabelas da qualidade ainda não existem neste banco. Rode as migrations (pnpm db:migrate).',
      triggers: { schedule: 'agendada', cli: 'linha de comando' },
      kpi: {
        results: 'Regras × esportes',
        passing: 'Sem falha',
        failing: 'Com falha',
        skipped: 'Puladas ou com erro',
        failures: 'Itens errados',
      },
      bySport: {
        title: 'Por esporte',
        sport: 'Esporte',
        ok: 'Sem falha',
        failing: 'Com falha',
        failed: 'Errados',
        trend: 'Tendência',
      },
      byRule: {
        title: 'Por regra',
        rule: 'Regra',
        sport: 'Esporte',
        status: 'Status',
        failed: 'Errados',
        trend: 'Tendência',
        ofChecked: 'de {n}',
      },
      status: { pass: 'Ok', fail: 'Falha', skipped: 'Pulada', error: 'Erro' },
      severity: { critical: 'crítica', high: 'alta', medium: 'média', low: 'baixa' },
      trend: {
        up: '+{n} desde a anterior',
        down: '−{n} desde a anterior',
        same: 'igual à anterior',
        first: 'primeira execução',
      },
      origin: 'Origem: {origin}',
      sports: { all: 'Todos', geo: 'Países', watch: 'Grades e ofertas' },
      failures: {
        title: 'Falhas',
        description: 'Itens errados no último resultado de cada regra, os mais graves primeiro.',
        shown: 'Mostrando {shown} de {total}.',
        empty: 'Nenhuma falha.',
        filterRule: 'Regra',
        all: 'todas',
        item: 'Item',
        current: 'Atual',
        expected: 'Esperado',
        since: 'Desde',
      },
    },
    unavailable: {
      title: 'Painel indisponível',
      description:
        'As tabelas da configuração ainda não existem neste banco. Rode as migrations (pnpm db:migrate).',
    },
    secrets: {
      configured: 'Configurada',
      missing: 'Não configurada',
    },
    youtube: {
      title: 'Cota do YouTube hoje',
      day: 'Dia de cota {day} (zera à meia-noite do Pacífico)',
      updated: 'Orçamento gravado {when}',
      never: 'O agente de vídeos ainda não rodou neste dia de cota.',
      search: 'Busca (search.list)',
      searchUnit: 'consultas',
      api: 'Geral: uploads dos canais, vídeos e canais',
      apiUnit: 'unidades',
      used: 'Gasta {n}',
      reserved: 'Reservada {n}',
      free: 'Livre {n}',
      ofLimit: '{used} de {limit} {unit}',
      reservedHint:
        'Reservada = buscas guardadas para os jogos que ainda vão acontecer no dia, pela prioridade.',
      channels:
        'Canais oficiais no mapa: {club} de clubes · {competition} de competições · {broadcaster} de emissoras',
      yieldTitle: 'Rendimento por competição (14 dias)',
      yieldNone: 'Sem histórico nos últimos 14 dias.',
      yieldColumns: {
        competition: 'Competição',
        games: 'Jogos',
        searches: 'Consultas',
        units: 'Unidades',
        searchVideos: 'Vídeos da busca',
        channelVideos: 'Vídeos dos canais',
        perSearch: 'Vídeos por consulta',
      },
      zero: 'rendimento zero: fim da fila',
      skippedTitle: 'Jogos pulados por cota',
      skippedNone: 'Nenhum jogo pulado por cota neste dia.',
      skippedColumns: {
        match: 'Jogo',
        competition: 'Competição',
        score: 'Prioridade',
        reason: 'Motivo',
        at: 'Quando',
      },
    },
    apis: {
      football: 'Futebol',
      afl: 'Futebol australiano',
      baseball: 'Beisebol',
      basketball: 'Basquete',
      'formula-1': 'Fórmula 1',
      handball: 'Handebol',
      hockey: 'Hóquei',
      mma: 'MMA',
      nba: 'NBA',
      'american-football': 'Futebol americano',
      rugby: 'Rúgbi',
      volleyball: 'Vôlei',
    },
    planFor: {
      label: 'Plano: {api}',
      description: 'Plano contratado desta API. Vazio herda o plano padrão.',
    },
    schedulePrefix: 'Agenda: {job}',
    settings: {
      LIVE_FEATURED: {
        label: 'Detalhe do jogo principal',
        description:
          'Busca escalações, estatísticas e lances do jogo em destaque a cada atualização do ao vivo. Desligado, o ao vivo atualiza só placar e relógio. Automático liga quando a cota do dia comporta (cada atualização passa a custar 2 chamadas).',
      },
      LIVE_MAX_INTERVAL_MINUTES: {
        label: 'Intervalo máximo entre atualizações',
        description:
          'Maior espera aceitável entre duas leituras de um jogo ao vivo. Menor deixa o placar mais fresco e gasta mais cota.',
        unit: 'min',
      },
      LIVE_IDLE_EXIT_MINUTES: {
        label: 'Encerrar o ao vivo ocioso após',
        description:
          'Sem jogo nos próximos minutos, o processo do ao vivo sai e o agendador o reinicia na próxima janela.',
        unit: 'min',
      },
      LIVE_MIN_PRIORITY: {
        label: 'Ligas acompanhadas ao vivo',
        description:
          'Menor prioridade de liga que o ao vivo acompanha. Com cota folgada, incluir as baixas evita jogos marcados como ao vivo sem placar.',
      },
      LIVE_PROTECT_DAILY: {
        label: 'Chamadas reservadas ao sync diário',
        description:
          'Chamadas do dia que o ao vivo nunca usa. Vazio segue o que o controle de cota planejou.',
        unit: 'chamadas',
      },
      LIVE_POLL_INTERVAL_SECONDS: {
        label: 'Frescor esperado do ao vivo',
        description: 'Usado pela API para alertar quando o dado ao vivo atrasa.',
        unit: 's',
      },
      CHANGE_FEED_RETENTION_DAYS: {
        label: 'Retenção do feed de mudanças',
        description: 'Por quantos dias as mudanças ficam no feed antes da limpeza.',
        unit: 'dias',
      },
      AI_PROVIDER: {
        label: 'Provedor de IA',
        description: 'Quem escreve os textos dos agentes. Trocar exige a chave do novo provedor configurada.',
      },
      AI_MODEL_LIGHT: {
        label: 'Modelo leve',
        description: 'Tarefas curtas e de alto volume: classificação e revalidações.',
      },
      AI_MODEL_STANDARD: { label: 'Modelo padrão', description: 'Resumos pós-jogo e cenários pré-jogo.' },
      AI_MODEL_RESEARCH: { label: 'Modelo de pesquisa', description: 'Pesquisa na web do Onde Assistir.' },
      AI_STATUS: {
        label: 'IA',
        description:
          'Chave geral: ligada ou desligada para todos os agentes. Desligada, nenhuma chamada sai para o provedor (nem a dos agentes com agente=on) e os agentes seguem só com texto determinístico.',
      },
      AI_AGENT_STATUS: {
        label: 'IA por agente',
        description:
          'Desliga a IA de agentes específicos com a IA ligada, no formato agente=on|off separado por vírgula (ex.: wtw=off). agente=on e agente fora da lista seguem o estado global: com a IA desligada, todos ficam desligados. Vazio: todos seguem o global.',
      },
      AI_DAILY_TOKEN_BUDGET: {
        label: 'Orçamento diário de tokens',
        description:
          'Teto de tokens por dia (UTC), somando todos os agentes: um número, ou "Sem limite". Ao bater, os agentes seguem só com texto determinístico. 0 não é aceito: para desligar a IA, use o estado da IA.',
        unit: 'tokens',
      },
      AI_DAILY_USD_BUDGET: {
        label: 'Orçamento diário em US$',
        description:
          'Teto de gasto de IA por dia (UTC), somando todos os agentes: tokens e buscas na web (a busca do Google no Gemini é cobrada por consulta). Ao bater, os agentes seguem só com texto determinístico. Um número, ou "Sem limite"; 0 não é aceito (para desligar a IA, use o estado da IA).',
        unit: 'US$',
      },
      AI_AGENT_USD_BUDGETS: {
        label: 'Teto diário por agente',
        description:
          'US$ por dia de cada agente, no formato agente=valor separado por vírgula (ex.: lineups=2,wtw=unlimited). O agente que bate o teto fica sem IA até a virada do dia UTC; unlimited tira o teto próprio; agente fora da lista fica com o teto do código ou, sem ele, com o teto padrão do agente novo. A lista mescla agente a agente sobre os padrões do código: só os agentes listados mudam. 0 não é aceito: para desligar um agente, use a IA por agente. Vazio usa o padrão.',
      },
      AI_AGENT_DEFAULT_USD_BUDGET: {
        label: 'Teto diário do agente novo',
        description:
          'US$ por dia de cada agente que não está no teto por agente (um agente novo, por exemplo): ele tem IA, mas só até este valor, e o log avisa uma vez por dia que ele está no padrão. Um número, ou "Sem limite" (fica só no teto global); 0 não é aceito.',
        unit: 'US$',
      },
      AI_MAX_SEARCHES_PER_CALL: {
        label: 'Buscas na web por chamada',
        description:
          'Teto de buscas em cada chamada de pesquisa. OpenAI e Anthropic aplicam o teto; o Gemini recebe a instrução, e as chamadas que passarem dele aparecem no Gasto de IA hoje.',
        unit: 'buscas',
      },
      AI_MAX_RETRIES: {
        label: 'Tentativas extras',
        description: 'Quantas vezes repetir uma chamada em erro passageiro do provedor.',
      },
      AI_TIMEOUT_MS: {
        label: 'Tempo limite por chamada',
        description: 'Espera máxima por uma resposta do provedor.',
        unit: 'ms',
      },
      AI_REVIEW_PROVIDER: {
        label: 'IA da revisão semântica',
        description:
          'IA que decide as sugestões de edição da Revisão semântica (Ajustes → Revisão). Padrão: Gemini.',
      },
      AI_REVIEW_MODEL: {
        label: 'Modelo da revisão semântica',
        description:
          'Modelo da IA que decide as sugestões de edição. Vazio usa o padrão do provedor escolhido.',
      },
      AI_CHANNELS_PROVIDER: {
        label: 'IA da lista de canais',
        description:
          'IA que confere as sobras do casamento da lista de canais do cliente com os direitos. Padrão: Gemini.',
      },
      AI_CHANNELS_MODEL: {
        label: 'Modelo da lista de canais',
        description: 'Modelo da IA da lista de canais. Vazio usa o padrão do provedor escolhido.',
      },
      WTW_MARKETS: {
        label: 'Mercados ativos',
        description: 'Países em que o Onde Assistir pesquisa onde passa cada jogo.',
      },
      WTW_MIN_RELEVANCE: {
        label: 'Relevância mínima para usar IA',
        description:
          'Só jogos com relevância no mercado a partir deste valor gastam IA na alocação por rodada.',
        unit: '/100',
      },
      WTW_DAILY_USD_PER_MARKET: {
        label: 'Teto diário por mercado',
        description: 'Gasto máximo de IA por país, por dia.',
        unit: 'US$',
      },
      WTW_CHANNEL_WEEKLY_CRON: {
        label: 'Canal do jogo: consulta semanal',
        description:
          'Quando pesquisar o canal dos jogos das rodadas que começam de 3 a 10 dias à frente (a escala sai pelo menos uma semana antes). Uma pesquisa cobre a rodada inteira; jogo com canal confirmado não volta à pesquisa. Padrão: segunda às 06:00 UTC.',
      },
      WTW_CHANNEL_RETRY_OFFSETS: {
        label: 'Canal do jogo: novas tentativas',
        description:
          'Quanto antes do primeiro jogo da rodada tentar de novo, só para os jogos que seguem sem canal confirmado no mercado (ex.: 3d,1d ou 36h; off desliga). A maior também define onde a consulta semanal começa.',
      },
      WTW_CHANNEL_POST: {
        label: 'Canal do jogo: depois do jogo',
        description:
          'Confirma quem transmitiu os jogos encerrados que ficaram sem canal (até 72 horas depois). Também alimenta o onde assistir dos jogos encerrados.',
      },
      AI_RIGHTS_PROVIDER: {
        label: 'Fonte do Onde Assistir (IA)',
        description:
          'IA que descobre quais canais e plataformas transmitem cada competição em cada país, a base do Onde Assistir. Vazio usa o provedor dos demais agentes; Gemini pesquisa com a busca do Google.',
      },
      AI_RIGHTS_MODEL: {
        label: 'Modelo da fonte do Onde Assistir',
        description:
          'Modelo da IA que pesquisa os canais do Onde Assistir. Vazio usa o padrão do provedor escolhido.',
      },
      LINEUP_MIN_REVIEW_STATUS: {
        label: 'Revisão mínima da grade de canais',
        description:
          'Operadoras, planos e streamings do Onde Assistir só aparecem na API a partir deste status editorial (draft, reviewed ou approved).',
      },
      LINEUP_PROMPT_MAX_CHARS: {
        label: 'Texto das páginas por plataforma (grade de canais)',
        description:
          'Para que serve: limita quanto texto das páginas de planos de uma plataforma vai para a IA em cada extração da grade de canais (pesquisa e revisita diária), dividido igualmente entre as páginas; controla o custo por chamada. Custo aproximado: cada 10 mil caracteres são ~2,5 mil tokens de entrada, ~US$ 0,00075 no Gemini Flash-Lite (~US$ 0,011 no padrão de 150 mil). Efeito colateral: o que passa do teto é cortado do fim da página e a IA não vê esses planos, preços e canais; a revisita não marca nada como removido e o corte aparece no log e no resumo da execução.',
        unit: 'caracteres',
      },
      LINEUP_PAGE_MAX_CHARS: {
        label: 'Texto de uma página (grade de canais)',
        description:
          'Teto de uma página sozinha na extração da grade de canais (pesquisa e revisita), dentro do teto por plataforma. O padrão é igual ao da plataforma: só limita quando é menor. O que passa é cortado do fim da página e a IA não vê esses planos e preços; o corte aparece no log e no resumo da execução.',
        unit: 'caracteres',
      },
      YOUTUBE_SEARCH_DAILY_QUOTA: {
        label: 'Buscas por dia no YouTube',
        description:
          'Balde próprio da busca (search.list), contado em consultas: 100 por dia no projeto padrão. Acima disso, só com aumento aprovado pelo Google.',
        unit: 'consultas',
      },
      YOUTUBE_DAILY_QUOTA: {
        label: 'Cota diária do YouTube (geral)',
        description:
          'Unidades por dia das demais chamadas: uploads dos canais, detalhes dos vídeos e dos canais (zera à meia-noite do Pacífico).',
        unit: 'unidades',
      },
      YOUTUBE_QUOTA_RESERVE_PERCENT: {
        label: 'Reserva da cota do YouTube',
        description: 'Parte dos dois baldes que o agente de vídeos nunca gasta.',
        unit: '%',
      },
      RELATED_MARKETS: {
        label: 'Mercados dos vídeos',
        description:
          'Países cuja relevância decide quais jogos ganham vídeos e em que idioma buscar. Vazio usa os mercados do Onde Assistir.',
      },
      RELATED_MIN_RELEVANCE: {
        label: 'Relevância mínima para buscar vídeos',
        description: 'Jogos abaixo disso, em todos os mercados, não gastam a cota do YouTube.',
      },
      RELATED_MAX_VIDEOS: {
        label: 'Máximo de vídeos por jogo',
        description:
          'Vídeos publicados por jogo e idioma. Menos vídeos também reduz o consumo da cota do YouTube.',
        unit: 'vídeos',
      },
      RELATED_MARKET_WEIGHTS: {
        label: 'Peso de cada mercado',
        description:
          'Multiplica a relevância do jogo no mercado na hora de dividir a busca (ex.: BR:1,AR:0.6). Vazio usa o padrão.',
      },
      RELATED_MAX_SEARCHES_PER_EVENT: {
        label: 'Buscas por jogo (total)',
        description:
          'Teto de consultas de busca por jogo, somando todas as rodadas. Os canais oficiais vêm antes e não contam aqui.',
        unit: 'buscas',
      },
      RELATED_MAX_SEARCHES_PER_RUN: {
        label: 'Buscas por jogo em cada rodada',
        description:
          'Consultas por jogo numa rodada; a busca para cedo quando a primeira não traz vídeo aproveitável.',
        unit: 'buscas',
      },
      RELATED_CHANNEL_ENOUGH: {
        label: 'Vídeos oficiais que dispensam a busca',
        description:
          'Com este número de vídeos aproveitáveis nos canais oficiais (clubes, liga, emissoras), o jogo não gasta busca.',
        unit: 'vídeos',
      },
      RELATED_CHANNEL_REFRESH_MINUTES: {
        label: 'Releitura dos canais oficiais',
        description:
          'Entre as buscas, os uploads dos canais do jogo são lidos de novo a cada intervalo. 0 lê em toda rodada.',
        unit: 'min',
      },
      RELATED_REVALIDATE_MINUTES: {
        label: 'Revalidação dos vídeos',
        description:
          'Os vídeos guardados são conferidos (fora do ar, estatísticas) no máximo a cada intervalo.',
        unit: 'min',
      },
      RELATED_RESERVE_MAX_PERCENT: {
        label: 'Reserva de busca para a agenda do dia',
        description:
          'Teto da parte das buscas do dia guardada para os jogos que ainda vão acontecer, pela prioridade. 0 desliga.',
        unit: '%',
      },
      RELATED_SEARCH_AFTER_KICKOFF_MINUTES: {
        label: 'Primeira busca após o início',
        description:
          'No apito a busca ainda não acha os melhores momentos: antes disto, só os canais oficiais são lidos.',
        unit: 'min',
      },
      RELATED_LOOKBACK_HOURS: {
        label: 'Janela de jogos encerrados',
        description: 'Só jogos encerrados nas últimas horas entram na fila de vídeos.',
        unit: 'h',
      },
      RELATED_SECOND_SEARCH_MINUTES: {
        label: 'Segunda busca após',
        description:
          'Os melhores momentos costumam sair depois do apito: uma segunda busca roda este tempo depois da primeira. 0 desliga.',
        unit: 'min',
      },
      RELATED_RESEARCH_HOURS: {
        label: 'Nova busca completa a cada',
        description: 'Entre uma busca completa e outra do mesmo jogo, só revalida os vídeos.',
        unit: 'h',
      },
      RELATED_CREATOR_MIN_SUBSCRIBERS: {
        label: 'Inscritos mínimos de criadores',
        description:
          'Canais fora da lista curada precisam de pelo menos estes inscritos (só reação e análise).',
        unit: 'inscritos',
      },
      APISPORTS_PLAN: {
        label: 'Plano padrão da api-sports',
        description: 'Vale para toda API sem plano próprio. Define a cota diária e as temporadas acessíveis.',
      },
      QUOTA_RESERVE_PERCENT: {
        label: 'Reserva da cota diária',
        description: 'Parte da cota que nenhum job usa, para emergências.',
        unit: '%',
      },
      ASSETS_CUSTOM_LOGOS: {
        label: 'Usar o acervo customizado de logos',
        description:
          'Ligado, a API mostra o escudo do acervo em tudo que tiver mapeamento (times, jogos, busca, classificação). Desligado, volta na hora para os logos do fornecedor, sem apagar nada.',
      },
      APISPORTS_KEY: { label: 'Chave da api-sports' },
      OPENAI_API_KEY: { label: 'Chave da OpenAI' },
      ANTHROPIC_API_KEY: { label: 'Chave da Anthropic' },
      GEMINI_API_KEY: { label: 'Chave do Gemini' },
      YOUTUBE_API_KEY: { label: 'Chave do YouTube' },
      QUALITY_API_KEY: { label: 'Qualidade dos dados: chave da API' },
      S3_ACCESS_KEY: { label: 'Armazenamento: chave de acesso' },
      S3_SECRET_KEY: { label: 'Armazenamento: segredo' },
      METRICS_TOKEN: { label: 'Token das métricas' },
      WEBHOOK_SIGNING_SECRET: { label: 'Assinatura dos webhooks' },
      ADMIN_KEY_HASHES: { label: 'Chaves de admin da API' },
      GALAXIE_DEMO_KEY: { label: 'Chave da demo na API' },
      BETTER_AUTH_SECRET: { label: 'Segredo do login da demo' },
      SMTP_HOST: { label: 'E-mail: servidor' },
      SMTP_USER: { label: 'E-mail: usuário' },
      SMTP_PASSWORD: { label: 'E-mail: senha' },
    } as Record<string, SettingText>,
  },
  {
    en: {
      meta: { title: 'System' },
      page: {
        title: 'System',
        description:
          'Operational health, live, job schedule, AI, provider and logos. Changes here override the VPS .env without restarting containers.',
        generatedAt: 'Updated {when}',
        refresh: 'Refresh',
      },
      nav: {
        users: 'Users',
        system: 'System',
        features: 'Sports and features',
        review: 'Review',
        lineup: 'Lineups and offers',
        label: 'Settings sections',
      },
      tabs: {
        status: 'Status',
        quality: 'Data quality',
        live: 'Live',
        schedule: 'Job schedule',
        ai: 'AI and budget',
        wtw: 'Where to Watch',
        related: 'Related content',
        provider: 'Provider',
        assets: 'Logos',
        history: 'History',
        sports: 'Sports',
      },
      features: {
        title: 'Sports and features',
        description:
          'What each sport uses from the provider and the rules of each feature: related videos (with the channel control) and where to watch. Same as System: changes apply without restarting containers.',
      },
      sections: {
        live: {
          title: 'Live',
          description: 'How live coverage follows ongoing matches and how much quota it uses.',
        },
        schedule: {
          title: 'Job schedule',
          description:
            'When each job runs (5-field cron, in UTC). The scheduler re-reads the schedule every 30 seconds.',
        },
        ai: { title: 'AI and budget', description: 'Provider, models and daily cap for the AI agents.' },
        wtw: {
          title: 'Where to Watch',
          description: 'Markets researched and spending limits for Where to Watch.',
        },
        related: {
          title: 'Related content',
          description: 'YouTube quota and how often videos are searched.',
        },
        provider: {
          title: 'Provider (plan and quota)',
          description:
            'Default api-sports plan and the daily quota reserve. Each sport plan is under Sports and features.',
        },
        sports: {
          title: 'Plan of each sport',
          description:
            'Subscribed plan of each sport API on api-sports. Empty = inherits the default plan from System.',
        },
        assets: {
          title: 'Custom logo collection',
          description:
            "High-quality crests imported from our own collection (assets:acervo), layered over the provider's logos.",
        },
        credentials: {
          title: 'Credentials and infrastructure',
          description: 'We only show whether they are set. To change them, edit the VPS .env.',
        },
      },
      source: { db: 'Panel', env: 'Container env', default: 'Code default', label: 'Value source' },
      sourceDetail: {
        db: 'Changed by {by} {when}.',
        env: 'Comes from the VPS .env.',
        default: 'Neither the panel nor the .env set it: the code default applies.',
        envBehind: 'In .env: {value}',
        noEnv: 'No value in .env',
        defaultIs: 'Default: {value}',
        invalidOverride: 'The value saved in the panel ({value}) is no longer accepted and is being ignored.',
        notReported: 'The container has not reported its env yet.',
      },
      apply: {
        refresh: 'Applies within 1 minute',
        'next-run': 'Applies on the next run',
        restart: 'Applies on restart: {service}',
      },
      services: { ingestor: 'Ingestor', agents: 'AI agents', api: 'API', demo: 'Demo' },
      values: {
        empty: 'empty',
        unlimited: 'No limit',
        inherit: 'Inherit default ({plan})',
        providerDefault: 'Provider default: {model}',
        tenantsMarkets: 'None selected: markets of customers with the module',
        off: 'Off',
        auto: 'Automatic',
        on: 'On',
        priorities: { high: 'High only', medium: 'Medium and high', low: 'Low, medium and high' },
        plans: {
          free: 'Free · 100/day',
          pro: 'Pro · 7,500/day',
          ultra: 'Ultra · 75,000/day',
          mega: 'Mega · 150,000/day',
        },
      },
      actions: {
        save: 'Save',
        cancel: 'Cancel',
        reset: 'Back to default',
        resetTitle: 'Reset {name} to default?',
        resetBody: 'The panel override is removed and {value} applies again.',
        confirmTitle: 'Confirm change to {name}?',
        confirmBody: 'From {from} to {to}. This flag affects operating cost or coverage.',
        confirm: 'Confirm',
        runNow: 'Run now',
        runNowTitle: 'Run {name} now?',
        runNowBody:
          'The request goes to the scheduler queue ({service}), which runs it within 30 seconds. The run is recorded like any other.',
        checkCredit: 'Check now',
        unlimited: 'No limit',
        turnOff: 'Turn off',
        turnOn: 'Turn on',
      },
      feedback: {
        saved: 'Setting saved.',
        reset: 'Back to default.',
        queued: 'Request queued for the scheduler.',
        serviceOffline:
          "Saved, but this container's scheduler hasn't reported for a few minutes: it may be down.",
        failed: 'Could not complete.',
      },
      errors: {
        unknown: 'Unknown flag.',
        readonly: 'Credentials cannot be edited in the panel.',
        required: 'Enter a value.',
        enum: 'Use one of these values: {values}.',
        integer: 'Use a whole number.',
        number: 'Use a number.',
        range: 'Use a value between {min} and {max}.',
        min: 'Use a value of at least {min}.',
        max: 'Use a value of at most {max}.',
        cron: 'Invalid schedule: use 5 fields (minute hour day month weekday) or "off".',
        markets: 'Unsupported markets: {values}.',
        format: 'Invalid format.',
        zero: '0 is not a valid value: to turn AI off use AI_STATUS=off (or AI_AGENT_STATUS for one agent); to remove the cap, "No limit" (unlimited).',
        providerKeyMissing: "This provider's key is not set in the agents container.",
        alreadyQueued: 'There is already a queued request for this job.',
        notRunnable: 'This job cannot be triggered from the panel.',
      },
      cron: {
        next: 'Next runs',
        none: 'No upcoming runs',
        off: 'Off',
        placeholder: 'e.g. */15 * * * *',
        utc: 'Times in your time zone; the cron is in UTC.',
      },
      status: {
        services: 'Schedulers and services',
        alive: 'Up',
        offline: 'No signal',
        never: 'Never reported',
        reported: 'Last signal {when}',
        startedAt: 'Started {when}',
        quota: 'api-sports quota today',
        quotaDay: 'Quota day {day} (UTC)',
        quotaUsed: '{used} of {limit} calls',
        quotaProvider: 'Provider counter: {used}/{limit}',
        quotaNoLimit: '{used} calls',
        priorities: { BOOTSTRAP: 'Bootstrap', DAILY: 'Daily', LIVE: 'Live', ADHOC: 'Ad hoc' },
        planned: 'planned {n}',
        noQuota: 'No calls today.',
        llm: 'AI spend today',
        llmTokens: '{used} of {budget} tokens',
        llmTokensUnlimited: '{used} tokens (no limit)',
        llmTokenPool: '{agent}: {used} of {budget} tokens (own pool, outside the global cap)',
        llmTokenPoolUnlimited: '{agent}: {used} tokens (own pool, no limit)',
        llmErrors: { one: '{count} error', other: '{count} errors' },
        llmNone: 'No AI calls today.',
        llmUsd: 'US$ {used} of US$ {budget}',
        llmUsdUnlimited: 'US$ {used} (no limit)',
        llmCalls: '{calls} calls · {searches} searches',
        llmOverSearchCap: {
          one: '{count} call went over {max} searches',
          other: '{count} calls went over {max} searches',
        },
        llmAgentCapped: 'capped',
        llmAgentDefaultCap: 'default cap',
        llmCapOrigin: { db: 'panel', env: 'env', code: 'code' },
        aiState: 'AI: {state}',
        aiOn: 'on',
        aiOff: 'off',
        aiLimited: 'limited',
        aiUnlimited: 'no limit',
        aiUsdPerDay: 'US$ {value}/day',
        aiTokensPerDay: '{value} tokens/day',
        aiInvalid: 'Invalid configuration: {keys}. Agents run without AI until it is fixed.',
        aiInvalidState: 'invalid configuration · no AI (agents fall back to deterministic text)',
        aiAgentOnIgnored: '{agents}: on has no effect, AI is off (AI_STATUS=off is the master switch).',
        searchesColumn: 'Searches',
        agent: 'Agent',
        tokensColumn: 'Tokens',
        costColumn: 'US$',
        credit: 'AI account',
        creditPass: 'Has credit',
        creditWarn: 'Attention',
        creditNever: 'Not checked yet.',
        creditPending: 'Check queued…',
        creditChecked: '{provider} · {model} · checked {when}',
        creditCodes: {
          ok: 'The test call passed.',
          no_key: 'No provider key set: agents fall back to deterministic text.',
          ai_off: 'AI is off (AI_STATUS=off): credit is not checked and no call goes out.',
          http: 'The provider answered {http} {error}: agents on deterministic text.',
          network: 'Could not reach the provider ({error}).',
        },
      },
      jobs: {
        title: 'Jobs',
        columns: { job: 'Job', schedule: 'Schedule (UTC)', last: 'Last run', actions: 'Actions' },
        status: { ok: 'OK', error: 'Error', running: 'Running', never: 'Never ran' },
        duration: 'took {duration}',
        lastOk: 'last success {when}',
        errors24h: { one: '{count} error in 24 h', other: '{count} errors in 24 h' },
        queued: 'Queued ({status})',
        triggers: { schedule: 'schedule', manual: 'manual', start: 'startup', panel: 'panel' },
        off: 'Off',
        edit: 'Edit schedule',
        names: {
          'sync-daily': {
            label: 'Daily sync',
            description:
              "Yesterday's, today's and tomorrow's matches, injuries and finished match details. Uses daily quota.",
          },
          'live-run': { label: 'Live', description: 'Follows ongoing matches while there is a window.' },
          'live-reconcile': {
            label: 'Live reconciliation',
            description:
              'Checks with the source the matches still shown as in play and fixes status, score and full time. On schedule, only those that look stuck; run now is the panic button: checks them all, up to 60 calls.',
          },
          'normalize-football': {
            label: 'Football normalization',
            description: 'Turns raw provider data into API data. Uses no quota.',
          },
          'normalize-sports': {
            label: 'Other sports normalization',
            description:
              'Turns what the daily sync brought for the other sports into matches and scores, then advances the match clock. Uses no quota.',
          },
          'events-clock': {
            label: 'Match clock',
            description: 'Moves match status by kick-off time (scheduled, live, finished).',
          },
          'events-importance': {
            label: 'Match importance',
            description:
              'Recomputes relevance of the next 7 days of matches from the standings. Uses no quota.',
          },
          'assets-mirror': {
            label: 'Image mirror',
            description: 'Copies crests, flags and photos to our storage.',
          },
          'assets-palette': { label: 'Team colors', description: 'Extracts colors from mirrored crests.' },
          'change-feed-prune': {
            label: 'Change feed cleanup',
            description: 'Deletes old changes from the feed behind webhooks and real time.',
          },
          'quota-status': {
            label: 'Quota reading',
            description: "Reads the provider's official counter (free) and reconciles today's quota.",
          },
          'data-quality': {
            label: 'Data quality',
            description:
              'Automatic rules that compare what the API serves with the reference (F1DB, Wikidata, the provider table, the broadcaster dictionary) and store the Quality tab scoreboard.',
          },
          'bootstrap-catalog': {
            label: 'Football catalog',
            description: 'Refreshes leagues, seasons and teams. Few calls, once a week.',
          },
          'recap-run': {
            label: 'Post-match recap (AI)',
            description: 'Writes the recap of finished matches within 10 minutes of the final whistle.',
          },
          'context-run': {
            label: 'Pre-match context (AI)',
            description: 'What is at stake in the next 72 hours: table, qualification and context.',
          },
          'wtw-run': {
            label: 'Where to Watch: rounds',
            description: 'Confirms where each match airs, per market, close to kick-off.',
          },
          'wtw-channel': {
            label: 'Where to Watch: match channel',
            description:
              'Finds each match channel from the round schedule: a weekly lookup, a new attempt 3 and 1 day before only for matches still without a channel and, after the match, only finished matches without one.',
          },
          'related-run': {
            label: 'Related videos',
            description:
              'Reads the official channels and, as a complement, searches YouTube for videos of matches finished in the last 24 hours.',
          },
          'wtw-rights': {
            label: 'Where to Watch: rights',
            description: 'Broadcaster library and broadcast rights per season.',
          },
          'review-suggestions': {
            label: 'Semantic review: suggestions',
            description:
              'AI decides the open edit suggestions: an approved one goes live without a deploy, a rejected one keeps the reason.',
          },
          'lineups-revisit': {
            label: 'Channel lineups: revisit',
            description:
              'Once a week, re-reads the official plans page of operators seen more than 30 days ago; the AI (no web search) only extracts again when the page changed (up to 4 calls per run).',
          },
          'lineups-pages': {
            label: 'Channel lineup: official page',
            description:
              "Confirms each plan's lineup, included services and price on the platform's official page (25-day cache, no AI).",
          },
          'channel-lists': {
            label: 'Client channel list',
            description:
              'AI checks only the leftovers of matching the channel list with the rights; the validator decides what goes in.',
          },
        },
      },
      history: {
        title: 'Change history',
        description: 'Who changed what and when, in the panel.',
        empty: 'No changes made from the panel yet.',
        when: 'When',
        who: 'Who',
        what: 'Flag',
        change: 'Change',
        set: '{from} → {to}',
        base: 'env or default',
        reset: 'Back to default (was {from})',
        requests: '"Run now" requests',
        requestsEmpty: 'No requests yet.',
        requestStatus: {
          pending: 'Queued',
          running: 'Running',
          done: 'Done',
          error: 'Failed',
          skipped: 'Refused',
          expired: 'Expired',
        },
        requestDetail: {
          not_allowed: 'job not allowed from the panel',
          already_running: 'was already running',
        },
      },
      quality: {
        title: 'Data quality',
        description:
          'Automatic rules that compare what the API serves with the reference: F1DB, Wikidata, the provider table and the broadcaster dictionary. They run every day. Every error found in the demo becomes a rule.',
        lastRun: 'Last run: {when} ({trigger})',
        never: 'Not run yet. Use "Run now" or the ingestor quality:run.',
        unavailable:
          "The quality tables don't exist in this database yet. Run the migrations (pnpm db:migrate).",
        triggers: { schedule: 'scheduled', cli: 'command line' },
        kpi: {
          results: 'Rules × sports',
          passing: 'Passing',
          failing: 'Failing',
          skipped: 'Skipped or errored',
          failures: 'Wrong items',
        },
        bySport: {
          title: 'By sport',
          sport: 'Sport',
          ok: 'Passing',
          failing: 'Failing',
          failed: 'Wrong',
          trend: 'Trend',
        },
        byRule: {
          title: 'By rule',
          rule: 'Rule',
          sport: 'Sport',
          status: 'Status',
          failed: 'Wrong',
          trend: 'Trend',
          ofChecked: 'of {n}',
        },
        status: { pass: 'Ok', fail: 'Failing', skipped: 'Skipped', error: 'Error' },
        severity: { critical: 'critical', high: 'high', medium: 'medium', low: 'low' },
        trend: {
          up: '+{n} since the previous run',
          down: '−{n} since the previous run',
          same: 'same as the previous run',
          first: 'first run',
        },
        origin: 'Origin: {origin}',
        sports: { all: 'All', geo: 'Countries', watch: 'Lineups and offers' },
        failures: {
          title: 'Failures',
          description: "Wrong items in each rule's latest result, most severe first.",
          shown: 'Showing {shown} of {total}.',
          empty: 'No failures.',
          filterRule: 'Rule',
          all: 'all',
          item: 'Item',
          current: 'Current',
          expected: 'Expected',
          since: 'Since',
        },
      },
      unavailable: {
        title: 'Panel unavailable',
        description:
          'The settings tables do not exist in this database yet. Run the migrations (pnpm db:migrate).',
      },
      secrets: { configured: 'Set', missing: 'Not set' },
      youtube: {
        title: 'YouTube quota today',
        day: 'Quota day {day} (resets at Pacific midnight)',
        updated: 'Budget saved {when}',
        never: 'The video agent has not run in this quota day yet.',
        search: 'Search (search.list)',
        searchUnit: 'queries',
        api: 'General: channel uploads, videos and channels',
        apiUnit: 'units',
        used: 'Spent {n}',
        reserved: 'Reserved {n}',
        free: 'Free {n}',
        ofLimit: '{used} of {limit} {unit}',
        reservedHint: 'Reserved = searches kept for matches still to be played today, by priority.',
        channels:
          'Official channels in the map: {club} clubs · {competition} competitions · {broadcaster} broadcasters',
        yieldTitle: 'Yield by competition (14 days)',
        yieldNone: 'No history in the last 14 days.',
        yieldColumns: {
          competition: 'Competition',
          games: 'Matches',
          searches: 'Queries',
          units: 'Units',
          searchVideos: 'Videos from search',
          channelVideos: 'Videos from channels',
          perSearch: 'Videos per query',
        },
        zero: 'zero yield: end of the queue',
        skippedTitle: 'Matches skipped for quota',
        skippedNone: 'No match skipped for quota in this day.',
        skippedColumns: {
          match: 'Match',
          competition: 'Competition',
          score: 'Priority',
          reason: 'Reason',
          at: 'When',
        },
      },
      apis: {
        football: 'Football',
        afl: 'Australian football',
        baseball: 'Baseball',
        basketball: 'Basketball',
        'formula-1': 'Formula 1',
        handball: 'Handball',
        hockey: 'Hockey',
        mma: 'MMA',
        nba: 'NBA',
        'american-football': 'American football',
        rugby: 'Rugby',
        volleyball: 'Volleyball',
      },
      planFor: {
        label: 'Plan: {api}',
        description: 'Subscribed plan for this API. Empty inherits the default plan.',
      },
      schedulePrefix: 'Schedule: {job}',
      settings: {
        LIVE_FEATURED: {
          label: 'Main match detail',
          description:
            'Fetches lineups, statistics and events of the featured match on every live update. Off, live only updates score and clock. Automatic turns it on when the daily quota allows (each update then costs 2 calls).',
        },
        LIVE_MAX_INTERVAL_MINUTES: {
          label: 'Maximum interval between updates',
          description:
            'Longest acceptable wait between two readings of a live match. Lower means fresher scores and more quota.',
          unit: 'min',
        },
        LIVE_IDLE_EXIT_MINUTES: {
          label: 'Stop idle live after',
          description:
            'With no match in the next minutes, the live process exits and the scheduler restarts it in the next window.',
          unit: 'min',
        },
        LIVE_MIN_PRIORITY: {
          label: 'Leagues followed live',
          description:
            'Lowest league priority live follows. With spare quota, including low avoids matches marked live with no score.',
        },
        LIVE_PROTECT_DAILY: {
          label: 'Calls reserved for the daily sync',
          description: 'Calls of the day live never uses. Empty follows what quota control planned.',
          unit: 'calls',
        },
        LIVE_POLL_INTERVAL_SECONDS: {
          label: 'Expected live freshness',
          description: 'Used by the API to alert when live data falls behind.',
          unit: 's',
        },
        CHANGE_FEED_RETENTION_DAYS: {
          label: 'Change feed retention',
          description: 'How many days changes stay in the feed before cleanup.',
          unit: 'days',
        },
        AI_PROVIDER: {
          label: 'AI provider',
          description: "Who writes the agents' texts. Switching requires the new provider's key to be set.",
        },
        AI_MODEL_LIGHT: {
          label: 'Light model',
          description: 'Short, high-volume tasks: classification and revalidation.',
        },
        AI_MODEL_STANDARD: {
          label: 'Standard model',
          description: 'Post-match recaps and pre-match context.',
        },
        AI_MODEL_RESEARCH: { label: 'Research model', description: 'Web research for Where to Watch.' },
        AI_STATUS: {
          label: 'AI',
          description:
            'Master switch: on or off for every agent. Off, no call goes to the provider (not even for agents set to agent=on) and agents fall back to deterministic text.',
        },
        AI_AGENT_STATUS: {
          label: 'AI per agent',
          description:
            'Turns AI off for specific agents while AI is on, as agent=on|off separated by commas (e.g. wtw=off). agent=on and agents not listed follow the global state: with AI off, all are off. Empty: all follow the global state.',
        },
        AI_DAILY_TOKEN_BUDGET: {
          label: 'Daily token budget',
          description:
            'Token cap per day (UTC) across all agents: a number, or "No limit". Once reached, agents fall back to deterministic text. 0 is not accepted: to turn AI off, use the AI state.',
          unit: 'tokens',
        },
        AI_DAILY_USD_BUDGET: {
          label: 'Daily budget in US$',
          description:
            'AI spend cap per day (UTC) across all agents: tokens plus web searches (Google Search on Gemini is billed per query). Once reached, agents fall back to deterministic text. A number, or "No limit"; 0 is not accepted (to turn AI off, use the AI state).',
          unit: 'US$',
        },
        AI_AGENT_USD_BUDGETS: {
          label: 'Daily cap per agent',
          description:
            'US$ per day for each agent, as agent=value separated by commas (e.g. lineups=2,wtw=unlimited). An agent that hits its cap gets no AI until the UTC day rolls over; unlimited removes its own cap; agents not listed keep the code cap or, without one, the new-agent cap. The list merges agent by agent over the code defaults: only the agents listed change. 0 is not accepted: to turn an agent off, use AI per agent. Empty uses the default.',
        },
        AI_AGENT_DEFAULT_USD_BUDGET: {
          label: 'Daily cap for a new agent',
          description:
            'US$ per day for each agent missing from the per-agent caps (a new agent, for example): it gets AI, but only up to this amount, and the log warns once a day that it is on the default. A number, or "No limit" (only the global cap applies); 0 is not accepted.',
          unit: 'US$',
        },

        AI_MAX_SEARCHES_PER_CALL: {
          label: 'Web searches per call',
          description:
            'Search cap for each research call. OpenAI and Anthropic enforce it; Gemini gets it as an instruction, and calls that go over show up in AI spend today.',
          unit: 'searches',
        },
        AI_MAX_RETRIES: {
          label: 'Extra attempts',
          description: 'How many times to retry a call on a transient provider error.',
        },
        AI_TIMEOUT_MS: {
          label: 'Timeout per call',
          description: 'Longest wait for a provider answer.',
          unit: 'ms',
        },
        AI_REVIEW_PROVIDER: {
          label: 'Semantic review AI',
          description:
            'AI that decides the edit suggestions of the Semantic review (Settings → Review). Default: Gemini.',
        },
        AI_REVIEW_MODEL: {
          label: 'Semantic review model',
          description:
            "Model of the AI that decides edit suggestions. Empty uses the chosen provider's default.",
        },
        AI_CHANNELS_PROVIDER: {
          label: 'Channel list AI',
          description:
            "AI that checks the leftovers of matching the client's channel list with the rights. Default: Gemini.",
        },
        AI_CHANNELS_MODEL: {
          label: 'Channel list model',
          description: "Model of the channel list AI. Empty uses the chosen provider's default.",
        },
        WTW_MARKETS: {
          label: 'Active markets',
          description: 'Countries where Where to Watch researches where each match airs.',
        },
        WTW_MIN_RELEVANCE: {
          label: 'Minimum relevance to use AI',
          description: 'Only matches with market relevance from this value up spend AI on round allocation.',
          unit: '/100',
        },
        WTW_DAILY_USD_PER_MARKET: {
          label: 'Daily cap per market',
          description: 'Maximum AI spend per country, per day.',
          unit: 'US$',
        },
        WTW_CHANNEL_WEEKLY_CRON: {
          label: 'Match channel: weekly lookup',
          description:
            'When to research the channel of matches in rounds starting 3 to 10 days ahead (schedules come out at least a week before). One lookup covers the whole round; a match with a confirmed channel is never researched again. Default: Monday at 06:00 UTC.',
        },
        WTW_CHANNEL_RETRY_OFFSETS: {
          label: 'Match channel: new attempts',
          description:
            'How long before the first match of the round to try again, only for matches still without a confirmed channel in the market (e.g. 3d,1d or 36h; off disables). The largest one also sets where the weekly lookup starts.',
        },
        WTW_CHANNEL_POST: {
          label: 'Match channel: after the match',
          description:
            'Confirms who aired the finished matches left without a channel (up to 72 hours later). It also feeds Where to Watch for finished matches.',
        },
        AI_RIGHTS_PROVIDER: {
          label: 'Where to Watch source (AI)',
          description:
            "AI that finds which channels and platforms carry each competition in each country — the basis of Where to Watch. Empty uses the other agents' provider; Gemini researches with Google Search.",
        },
        AI_RIGHTS_MODEL: {
          label: 'Where to Watch source model',
          description:
            "Model of the AI that researches Where to Watch channels. Empty uses the chosen provider's default.",
        },
        LINEUP_MIN_REVIEW_STATUS: {
          label: 'Minimum review of the channel lineup',
          description:
            'Operators, plans and streaming services in Where to Watch only reach the API from this editorial status on (draft, reviewed or approved).',
        },
        LINEUP_PROMPT_MAX_CHARS: {
          label: 'Page text per platform (channel lineup)',
          description:
            "What it does: caps how much text from a platform's plan pages goes to the AI in each channel lineup extraction (research and the daily revisit), split evenly across the pages; it controls the cost per call. Approximate cost: every 10,000 characters are ~2,500 input tokens, ~US$ 0.00075 on Gemini Flash-Lite (~US$ 0.011 at the 150,000 default). Side effect: whatever goes past the cap is cut from the end of the page and the AI does not see those plans, prices and channels; the revisit marks nothing as removed and the cut shows in the log and in the run summary.",
          unit: 'characters',
        },
        LINEUP_PAGE_MAX_CHARS: {
          label: 'Text of one page (channel lineup)',
          description:
            'Cap for a single page in the channel lineup extraction (research and revisit), within the per-platform cap. The default equals the platform cap: it only limits when lower. Whatever goes past it is cut from the end of the page and the AI does not see those plans and prices; the cut shows in the log and in the run summary.',
          unit: 'characters',
        },
        YOUTUBE_SEARCH_DAILY_QUOTA: {
          label: 'YouTube searches per day',
          description:
            'The search bucket (search.list), counted in queries: 100 per day on a default project. More requires an increase approved by Google.',
          unit: 'queries',
        },
        YOUTUBE_DAILY_QUOTA: {
          label: 'YouTube daily quota (general)',
          description:
            'Units per day for the other calls: channel uploads, video and channel details (resets at Pacific midnight).',
          unit: 'units',
        },
        YOUTUBE_QUOTA_RESERVE_PERCENT: {
          label: 'YouTube quota reserve',
          description: 'Share of both buckets the video agent never spends.',
          unit: '%',
        },
        RELATED_MARKETS: {
          label: 'Video markets',
          description:
            'Countries whose relevance decides which matches get videos and which language to search. Empty uses the Where to Watch markets.',
        },
        RELATED_MIN_RELEVANCE: {
          label: 'Minimum relevance to search videos',
          description: 'Matches below this in every market do not spend YouTube quota.',
        },
        RELATED_MAX_VIDEOS: {
          label: 'Maximum videos per match',
          description:
            'Videos published per match and language. Fewer videos also reduces YouTube quota use.',
          unit: 'videos',
        },
        RELATED_MARKET_WEIGHTS: {
          label: 'Weight of each market',
          description:
            "Multiplies the match's relevance in the market when sharing the searches (e.g. BR:1,AR:0.6). Empty uses the default.",
        },
        RELATED_MAX_SEARCHES_PER_EVENT: {
          label: 'Searches per match (total)',
          description:
            'Cap on search queries per match across all rounds. Official channels come first and do not count here.',
          unit: 'searches',
        },
        RELATED_MAX_SEARCHES_PER_RUN: {
          label: 'Searches per match in each round',
          description:
            'Queries per match in one round; the search stops early when the first brings no usable video.',
          unit: 'searches',
        },
        RELATED_CHANNEL_ENOUGH: {
          label: 'Official videos that skip the search',
          description:
            'With this many usable videos on the official channels (clubs, league, broadcasters), the match spends no search.',
          unit: 'videos',
        },
        RELATED_CHANNEL_REFRESH_MINUTES: {
          label: 'Official channels re-read',
          description:
            "Between searches, the match's channel uploads are read again at this interval. 0 reads every round.",
          unit: 'min',
        },
        RELATED_REVALIDATE_MINUTES: {
          label: 'Video revalidation',
          description: 'Stored videos are re-checked (taken down, statistics) at most once per interval.',
          unit: 'min',
        },
        RELATED_RESERVE_MAX_PERCENT: {
          label: "Search reserve for the day's schedule",
          description:
            "Cap on the share of the day's searches kept for matches still to be played, by priority. 0 disables it.",
          unit: '%',
        },
        RELATED_SEARCH_AFTER_KICKOFF_MINUTES: {
          label: 'First search after kickoff',
          description:
            'At the final whistle the search does not find the highlights yet: before this, only the official channels are read.',
          unit: 'min',
        },
        RELATED_LOOKBACK_HOURS: {
          label: 'Finished matches window',
          description: 'Only matches finished in the last hours enter the video queue.',
          unit: 'h',
        },
        RELATED_SECOND_SEARCH_MINUTES: {
          label: 'Second search after',
          description:
            'Highlights are often published after full time: a second search runs this long after the first. 0 turns it off.',
          unit: 'min',
        },
        RELATED_RESEARCH_HOURS: {
          label: 'Full search every',
          description: 'Between two full searches of the same match, videos are only revalidated.',
          unit: 'h',
        },
        RELATED_CREATOR_MIN_SUBSCRIBERS: {
          label: 'Minimum creator subscribers',
          description:
            'Channels outside the curated list need at least this many subscribers (reaction and analysis only).',
          unit: 'subscribers',
        },
        APISPORTS_PLAN: {
          label: 'Default api-sports plan',
          description:
            'Applies to every API without its own plan. Sets the daily quota and accessible seasons.',
        },
        QUOTA_RESERVE_PERCENT: {
          label: 'Daily quota reserve',
          description: 'Share of the quota no job uses, kept for emergencies.',
          unit: '%',
        },
        ASSETS_CUSTOM_LOGOS: {
          label: 'Use the custom logo collection',
          description:
            "On, the API serves the collection's crest wherever there is a mapping (teams, matches, search, standings). Off, it goes straight back to the provider's logos, deleting nothing.",
        },
        APISPORTS_KEY: { label: 'api-sports key' },
        OPENAI_API_KEY: { label: 'OpenAI key' },
        ANTHROPIC_API_KEY: { label: 'Anthropic key' },
        GEMINI_API_KEY: { label: 'Gemini key' },
        YOUTUBE_API_KEY: { label: 'YouTube key' },
        QUALITY_API_KEY: { label: 'Data quality: API key' },
        S3_ACCESS_KEY: { label: 'Storage: access key' },
        S3_SECRET_KEY: { label: 'Storage: secret' },
        METRICS_TOKEN: { label: 'Metrics token' },
        WEBHOOK_SIGNING_SECRET: { label: 'Webhook signing' },
        ADMIN_KEY_HASHES: { label: 'API admin keys' },
        GALAXIE_DEMO_KEY: { label: 'Demo key for the API' },
        BETTER_AUTH_SECRET: { label: 'Demo sign-in secret' },
        SMTP_HOST: { label: 'Email: server' },
        SMTP_USER: { label: 'Email: user' },
        SMTP_PASSWORD: { label: 'Email: password' },
      },
    },
    'es-AR': {
      meta: { title: 'Sistema' },
      page: {
        title: 'Sistema',
        description:
          'Salud de la operación, en vivo, agenda de los jobs, IA, proveedor y logos. Lo que cambies acá pisa el .env de la VPS sin reiniciar los contenedores.',
        generatedAt: 'Actualizado {when}',
        refresh: 'Actualizar',
      },
      nav: {
        users: 'Usuarios',
        system: 'Sistema',
        features: 'Deportes y features',
        review: 'Revisión',
        lineup: 'Grillas y ofertas',
        label: 'Secciones de ajustes',
      },
      tabs: {
        status: 'Estado',
        quality: 'Calidad de los datos',
        live: 'En vivo',
        schedule: 'Agenda de los jobs',
        ai: 'IA y presupuesto',
        wtw: 'Dónde ver',
        related: 'Contenido relacionado',
        provider: 'Proveedor',
        assets: 'Logos',
        history: 'Historial',
        sports: 'Deportes',
      },
      features: {
        title: 'Deportes y features',
        description:
          'Lo que cada deporte usa del proveedor y las reglas de cada feature: videos relacionados (con el control de los canales) y dónde ver. Igual que en Sistema: cambia sin reiniciar los contenedores.',
      },
      sections: {
        live: {
          title: 'En vivo',
          description: 'Cómo el en vivo sigue los partidos en curso y cuánta cuota usa.',
        },
        schedule: {
          title: 'Agenda de los jobs',
          description:
            'Cuándo corre cada job (cron de 5 campos, en UTC). El programador relee la agenda cada 30 segundos.',
        },
        ai: {
          title: 'IA y presupuesto',
          description: 'Proveedor, modelos y tope diario de los agentes de IA.',
        },
        wtw: { title: 'Dónde ver', description: 'Mercados investigados y límites de gasto de Dónde ver.' },
        related: {
          title: 'Contenido relacionado',
          description: 'Cuota de YouTube y frecuencia de las búsquedas de videos.',
        },
        provider: {
          title: 'Proveedor (plan y cuota)',
          description:
            'Plan por defecto de api-sports y la reserva de la cuota diaria. El plan de cada deporte está en Deportes y features.',
        },
        sports: {
          title: 'Plan de cada deporte',
          description:
            'Plan contratado de la API de cada deporte en api-sports. Vacío = hereda el plan por defecto de Sistema.',
        },
        assets: {
          title: 'Acervo propio de escudos',
          description:
            'Escudos de alta calidad importados de un acervo propio (assets:acervo), por encima de los logos del proveedor.',
        },
        credentials: {
          title: 'Credenciales e infraestructura',
          description: 'Solo mostramos si están configuradas. Para cambiarlas, editá el .env de la VPS.',
        },
      },
      source: {
        db: 'Panel',
        env: 'Env del contenedor',
        default: 'Valor por defecto',
        label: 'Origen del valor',
      },
      sourceDetail: {
        db: 'Cambiado por {by} {when}.',
        env: 'Viene del .env de la VPS.',
        default: 'Ni el panel ni el .env lo definen: vale el valor por defecto del código.',
        envBehind: 'En el .env: {value}',
        noEnv: 'Sin valor en el .env',
        defaultIs: 'Por defecto: {value}',
        invalidOverride: 'El valor guardado en el panel ({value}) ya no es aceptado y se ignora.',
        notReported: 'El contenedor todavía no informó su env.',
      },
      apply: {
        refresh: 'Rige en hasta 1 minuto',
        'next-run': 'Rige en la próxima ejecución',
        restart: 'Rige al reiniciar: {service}',
      },
      services: { ingestor: 'Ingestor', agents: 'Agentes de IA', api: 'API', demo: 'Demo' },
      values: {
        empty: 'vacío',
        unlimited: 'Sin límite',
        inherit: 'Heredar el plan por defecto ({plan})',
        providerDefault: 'Por defecto del proveedor: {model}',
        tenantsMarkets: 'Ninguno marcado: mercados de los clientes con el módulo',
        off: 'Apagado',
        auto: 'Automático',
        on: 'Encendido',
        priorities: { high: 'Solo alta', medium: 'Media y alta', low: 'Baja, media y alta' },
        plans: {
          free: 'Free · 100/día',
          pro: 'Pro · 7.500/día',
          ultra: 'Ultra · 75.000/día',
          mega: 'Mega · 150.000/día',
        },
      },
      actions: {
        save: 'Guardar',
        cancel: 'Cancelar',
        reset: 'Volver al valor por defecto',
        resetTitle: '¿Volver {name} al valor por defecto?',
        resetBody: 'Se borra lo guardado en el panel y vuelve a regir {value}.',
        confirmTitle: '¿Confirmar el cambio en {name}?',
        confirmBody: 'De {from} a {to}. Esta flag afecta el costo o la cobertura de la operación.',
        confirm: 'Confirmar',
        runNow: 'Correr ahora',
        runNowTitle: '¿Correr {name} ahora?',
        runNowBody:
          'El pedido entra en la cola del programador ({service}), que lo ejecuta en hasta 30 segundos. La ejecución queda registrada como las demás.',
        checkCredit: 'Verificar ahora',
        unlimited: 'Sin límite',
        turnOff: 'Apagar',
        turnOn: 'Encender',
      },
      feedback: {
        saved: 'Configuración guardada.',
        reset: 'Volvió al valor por defecto.',
        queued: 'Pedido en la cola del programador.',
        serviceOffline:
          'Guardado, pero el programador de ese contenedor no informa hace unos minutos: puede estar parado.',
        failed: 'No se pudo completar.',
      },
      errors: {
        unknown: 'Flag desconocida.',
        readonly: 'Las credenciales no se editan desde el panel.',
        required: 'Ingresá un valor.',
        enum: 'Usá uno de estos valores: {values}.',
        integer: 'Usá un número entero.',
        number: 'Usá un número.',
        range: 'Usá un valor entre {min} y {max}.',
        min: 'Usá un valor desde {min}.',
        max: 'Usá un valor hasta {max}.',
        cron: 'Agenda inválida: usá 5 campos (minuto hora día mes día-de-la-semana) u "off".',
        markets: 'Mercados no soportados: {values}.',
        format: 'Formato inválido.',
        zero: '0 no es un valor válido: para apagar la IA usa AI_STATUS=off (o AI_AGENT_STATUS para un agente); para quitar el tope, "Sin límite" (unlimited).',
        providerKeyMissing: 'La clave de ese proveedor no está configurada en el contenedor de los agentes.',
        alreadyQueued: 'Ya hay un pedido para este job en la cola.',
        notRunnable: 'Este job no se puede disparar desde el panel.',
      },
      cron: {
        next: 'Próximas ejecuciones',
        none: 'Sin próximas ejecuciones',
        off: 'Apagado',
        placeholder: 'ej.: */15 * * * *',
        utc: 'Horarios en tu huso; el cron es en UTC.',
      },
      status: {
        services: 'Programadores y servicios',
        alive: 'En línea',
        offline: 'Sin señal',
        never: 'Nunca informó',
        reported: 'Última señal {when}',
        startedAt: 'Arranque {when}',
        quota: 'Cuota de api-sports hoy',
        quotaDay: 'Día de cuota {day} (UTC)',
        quotaUsed: '{used} de {limit} llamadas',
        quotaProvider: 'Contador del proveedor: {used}/{limit}',
        quotaNoLimit: '{used} llamadas',
        priorities: { BOOTSTRAP: 'Bootstrap', DAILY: 'Diario', LIVE: 'En vivo', ADHOC: 'Sueltas' },
        planned: 'planificado {n}',
        noQuota: 'Ninguna llamada hoy.',
        llm: 'Gasto de IA hoy',
        llmTokens: '{used} de {budget} tokens',
        llmTokensUnlimited: '{used} tokens (sin límite)',
        llmTokenPool: '{agent}: {used} de {budget} tokens (pool propio, fuera del tope global)',
        llmTokenPoolUnlimited: '{agent}: {used} tokens (pool propio, sin límite)',
        llmErrors: { one: '{count} error', other: '{count} errores' },
        llmNone: 'Ninguna llamada de IA hoy.',
        llmUsd: 'US$ {used} de US$ {budget}',
        llmUsdUnlimited: 'US$ {used} (sin límite)',
        llmCalls: '{calls} llamadas · {searches} búsquedas',
        llmOverSearchCap: {
          one: '{count} llamada superó {max} búsquedas',
          other: '{count} llamadas superaron {max} búsquedas',
        },
        llmAgentCapped: 'en el tope',
        llmAgentDefaultCap: 'tope por defecto',
        llmCapOrigin: { db: 'panel', env: 'env', code: 'código' },
        aiState: 'IA: {state}',
        aiOn: 'encendido',
        aiOff: 'apagado',
        aiLimited: 'limitado',
        aiUnlimited: 'sin límite',
        aiUsdPerDay: 'US$ {value}/día',
        aiTokensPerDay: '{value} tokens/día',
        aiInvalid: 'Configuración inválida: {keys}. Los agentes quedan sin IA hasta corregirla.',
        aiInvalidState: 'configuración inválida · sin IA (los agentes siguen solo con texto determinístico)',
        aiAgentOnIgnored:
          '{agents}: on sin efecto, la IA está apagada (AI_STATUS=off es el interruptor general).',
        searchesColumn: 'Búsquedas',
        agent: 'Agente',
        tokensColumn: 'Tokens',
        costColumn: 'US$',
        credit: 'Cuenta de IA',
        creditPass: 'Con crédito',
        creditWarn: 'Atención',
        creditNever: 'Todavía no verificada.',
        creditPending: 'Verificación en la cola…',
        creditChecked: '{provider} · {model} · verificada {when}',
        creditCodes: {
          ok: 'La llamada de prueba pasó.',
          no_key: 'Sin clave del proveedor configurada: los agentes siguen solo con texto determinístico.',
          ai_off: 'IA apagada (AI_STATUS=off): no se verifica el crédito y no sale ninguna llamada.',
          http: 'El proveedor respondió {http} {error}: agentes con texto determinístico.',
          network: 'Sin conexión con el proveedor ({error}).',
        },
      },
      jobs: {
        title: 'Jobs',
        columns: { job: 'Job', schedule: 'Agenda (UTC)', last: 'Última ejecución', actions: 'Acciones' },
        status: { ok: 'OK', error: 'Error', running: 'Corriendo', never: 'Nunca corrió' },
        duration: 'duró {duration}',
        lastOk: 'último éxito {when}',
        errors24h: { one: '{count} error en 24 h', other: '{count} errores en 24 h' },
        queued: 'En la cola ({status})',
        triggers: { schedule: 'agenda', manual: 'manual', start: 'arranque', panel: 'panel' },
        off: 'Apagado',
        edit: 'Editar agenda',
        names: {
          'sync-daily': {
            label: 'Sync diario',
            description:
              'Partidos de ayer, hoy y mañana, lesiones y detalle de los terminados. Gasta cuota del día.',
          },
          'live-run': { label: 'En vivo', description: 'Sigue los partidos en curso mientras haya ventana.' },
          'live-reconcile': {
            label: 'Reconciliación del en vivo',
            description:
              'Confirma en la fuente los partidos que siguen en curso y corrige estado, marcador y final. Por la agenda, solo los que parecen detenidos; correr ahora es el botón de pánico: revisa todos, hasta 60 llamadas.',
          },
          'normalize-football': {
            label: 'Normalización del fútbol',
            description: 'Transforma lo crudo del proveedor en los datos de la API. No gasta cuota.',
          },
          'normalize-sports': {
            label: 'Normalización de los otros deportes',
            description:
              'Convierte en partidos y marcadores lo que el sync diario trajo de los otros deportes y avanza el reloj de los partidos. No gasta cuota.',
          },
          'events-clock': {
            label: 'Reloj de los partidos',
            description: 'Cambia el estado de los partidos por el horario (programado, en vivo, terminado).',
          },
          'events-importance': {
            label: 'Importancia de los partidos',
            description:
              'Recalcula la relevancia de los partidos de los próximos 7 días por la tabla. No gasta cuota.',
          },
          'assets-mirror': {
            label: 'Espejo de imágenes',
            description: 'Copia escudos, banderas y fotos a nuestro almacenamiento.',
          },
          'assets-palette': {
            label: 'Colores de los equipos',
            description: 'Extrae los colores de los escudos ya espejados.',
          },
          'change-feed-prune': {
            label: 'Limpieza del feed de cambios',
            description: 'Borra cambios viejos del feed que alimenta webhooks y tiempo real.',
          },
          'quota-status': {
            label: 'Lectura de la cuota',
            description: 'Lee el contador oficial del proveedor (gratis) y concilia la cuota del día.',
          },
          'data-quality': {
            label: 'Calidad de los datos',
            description:
              'Reglas automáticas que comparan lo que entrega la API con la referencia (F1DB, Wikidata, la tabla del proveedor, el diccionario de emisoras) y guardan el marcador de la pestaña Calidad.',
          },
          'bootstrap-catalog': {
            label: 'Catálogo del fútbol',
            description: 'Actualiza ligas, temporadas y equipos. Pocas llamadas, una vez por semana.',
          },
          'recap-run': {
            label: 'Resumen post-partido (IA)',
            description:
              'Escribe el resumen de los partidos terminados hasta 10 minutos después del pitazo final.',
          },
          'context-run': {
            label: 'Escenario previo (IA)',
            description: 'Qué está en juego en las próximas 72 horas: tabla, clasificación y contexto.',
          },
          'wtw-run': {
            label: 'Dónde ver: fechas',
            description: 'Confirma dónde pasan cada partido, por mercado, cerca del horario.',
          },
          'wtw-channel': {
            label: 'Dónde ver: canal del partido',
            description:
              'Descubre el canal de cada partido por la programación de la fecha: consulta semanal, nuevo intento 3 y 1 día antes solo para los que siguen sin canal y, después del partido, solo los terminados sin canal.',
          },
          'related-run': {
            label: 'Videos relacionados',
            description:
              'Lee los canales oficiales y, como complemento, busca en YouTube los videos de los partidos terminados en las últimas 24 horas.',
          },
          'wtw-rights': {
            label: 'Dónde ver: derechos',
            description: 'Biblioteca de señales y derechos de transmisión por temporada.',
          },
          'review-suggestions': {
            label: 'Revisión semántica: sugerencias',
            description:
              'La IA decide las sugerencias de edición abiertas: la aprobada sale al aire sin deploy, la rechazada queda con el motivo.',
          },
          'lineups-revisit': {
            label: 'Grilla de canales: revisión',
            description:
              'Una vez por semana, vuelve a leer la página oficial de planes de los operadores vistos hace más de 30 días; la IA (sin búsqueda web) solo extrae de nuevo si la página cambió (hasta 4 llamadas por ejecución).',
          },
          'lineups-pages': {
            label: 'Grilla de canales: página oficial',
            description:
              'Confirma la grilla, los incluidos y el precio de cada plan en la página oficial de la plataforma (con caché de 25 días, sin IA).',
          },
          'channel-lists': {
            label: 'Lista de canales del cliente',
            description:
              'La IA revisa solo lo que sobra del cruce de la lista de canales con los derechos; el validador decide qué entra.',
          },
        },
      },
      history: {
        title: 'Historial de cambios',
        description: 'Quién cambió qué y cuándo, en el panel.',
        empty: 'Todavía no hubo cambios desde el panel.',
        when: 'Cuándo',
        who: 'Quién',
        what: 'Flag',
        change: 'Cambio',
        set: '{from} → {to}',
        base: 'env o por defecto',
        reset: 'Volvió al valor por defecto (era {from})',
        requests: 'Pedidos de "correr ahora"',
        requestsEmpty: 'Todavía no hay pedidos.',
        requestStatus: {
          pending: 'En la cola',
          running: 'Corriendo',
          done: 'Listo',
          error: 'Falló',
          skipped: 'Rechazado',
          expired: 'Venció',
        },
        requestDetail: {
          not_allowed: 'job no habilitado para el panel',
          already_running: 'ya estaba corriendo',
        },
      },
      quality: {
        title: 'Calidad de los datos',
        description:
          'Reglas automáticas que comparan lo que entrega la API con la referencia: F1DB, Wikidata, la tabla del proveedor y el diccionario de emisoras. Corren todos los días. Cada error encontrado en la demo se vuelve una regla.',
        lastRun: 'Última ejecución: {when} ({trigger})',
        never: 'Todavía no corrió. Usá "Ejecutar ahora" o el quality:run del ingestor.',
        unavailable:
          'Las tablas de calidad todavía no existen en esta base. Corré las migrations (pnpm db:migrate).',
        triggers: { schedule: 'agendada', cli: 'línea de comandos' },
        kpi: {
          results: 'Reglas × deportes',
          passing: 'Sin fallas',
          failing: 'Con fallas',
          skipped: 'Salteadas o con error',
          failures: 'Ítems con error',
        },
        bySport: {
          title: 'Por deporte',
          sport: 'Deporte',
          ok: 'Sin fallas',
          failing: 'Con fallas',
          failed: 'Con error',
          trend: 'Tendencia',
        },
        byRule: {
          title: 'Por regla',
          rule: 'Regla',
          sport: 'Deporte',
          status: 'Estado',
          failed: 'Con error',
          trend: 'Tendencia',
          ofChecked: 'de {n}',
        },
        status: { pass: 'Ok', fail: 'Falla', skipped: 'Salteada', error: 'Error' },
        severity: { critical: 'crítica', high: 'alta', medium: 'media', low: 'baja' },
        trend: {
          up: '+{n} desde la anterior',
          down: '−{n} desde la anterior',
          same: 'igual a la anterior',
          first: 'primera ejecución',
        },
        origin: 'Origen: {origin}',
        sports: { all: 'Todos', geo: 'Países', watch: 'Grillas y ofertas' },
        failures: {
          title: 'Fallas',
          description: 'Ítems con error en el último resultado de cada regla, los más graves primero.',
          shown: 'Mostrando {shown} de {total}.',
          empty: 'Ninguna falla.',
          filterRule: 'Regla',
          all: 'todas',
          item: 'Ítem',
          current: 'Actual',
          expected: 'Esperado',
          since: 'Desde',
        },
      },
      unavailable: {
        title: 'Panel no disponible',
        description:
          'Las tablas de configuración todavía no existen en esta base. Corré las migraciones (pnpm db:migrate).',
      },
      secrets: { configured: 'Configurada', missing: 'Sin configurar' },
      youtube: {
        title: 'Cuota de YouTube hoy',
        day: 'Día de cuota {day} (se reinicia a la medianoche del Pacífico)',
        updated: 'Presupuesto guardado {when}',
        never: 'El agente de videos aún no corrió en este día de cuota.',
        search: 'Búsqueda (search.list)',
        searchUnit: 'consultas',
        api: 'General: subidas de los canales, videos y canales',
        apiUnit: 'unidades',
        used: 'Gastada {n}',
        reserved: 'Reservada {n}',
        free: 'Libre {n}',
        ofLimit: '{used} de {limit} {unit}',
        reservedHint:
          'Reservada = búsquedas guardadas para los partidos que aún se jugarán hoy, por prioridad.',
        channels:
          'Canales oficiales en el mapa: {club} de clubes · {competition} de competiciones · {broadcaster} de emisoras',
        yieldTitle: 'Rendimiento por competición (14 días)',
        yieldNone: 'Sin historial en los últimos 14 días.',
        yieldColumns: {
          competition: 'Competición',
          games: 'Partidos',
          searches: 'Consultas',
          units: 'Unidades',
          searchVideos: 'Videos de la búsqueda',
          channelVideos: 'Videos de los canales',
          perSearch: 'Videos por consulta',
        },
        zero: 'rendimiento cero: final de la cola',
        skippedTitle: 'Partidos omitidos por cuota',
        skippedNone: 'Ningún partido omitido por cuota en este día.',
        skippedColumns: {
          match: 'Partido',
          competition: 'Competición',
          score: 'Prioridad',
          reason: 'Motivo',
          at: 'Cuándo',
        },
      },
      apis: {
        football: 'Fútbol',
        afl: 'Fútbol australiano',
        baseball: 'Béisbol',
        basketball: 'Básquet',
        'formula-1': 'Fórmula 1',
        handball: 'Handball',
        hockey: 'Hockey',
        mma: 'MMA',
        nba: 'NBA',
        'american-football': 'Fútbol americano',
        rugby: 'Rugby',
        volleyball: 'Vóley',
      },
      planFor: {
        label: 'Plan: {api}',
        description: 'Plan contratado de esta API. Vacío hereda el plan por defecto.',
      },
      schedulePrefix: 'Agenda: {job}',
      settings: {
        LIVE_FEATURED: {
          label: 'Detalle del partido principal',
          description:
            'Trae formaciones, estadísticas y jugadas del partido destacado en cada actualización del en vivo. Apagado, el en vivo actualiza solo marcador y reloj. Automático lo enciende cuando la cuota del día alcanza (cada actualización pasa a costar 2 llamadas).',
        },
        LIVE_MAX_INTERVAL_MINUTES: {
          label: 'Intervalo máximo entre actualizaciones',
          description:
            'Mayor espera aceptable entre dos lecturas de un partido en vivo. Menos deja el marcador más fresco y gasta más cuota.',
          unit: 'min',
        },
        LIVE_IDLE_EXIT_MINUTES: {
          label: 'Cerrar el en vivo ocioso después de',
          description:
            'Sin partidos en los próximos minutos, el proceso del en vivo sale y el programador lo reinicia en la próxima ventana.',
          unit: 'min',
        },
        LIVE_MIN_PRIORITY: {
          label: 'Ligas seguidas en vivo',
          description:
            'Menor prioridad de liga que sigue el en vivo. Con cuota holgada, incluir las bajas evita partidos marcados en vivo sin marcador.',
        },
        LIVE_PROTECT_DAILY: {
          label: 'Llamadas reservadas al sync diario',
          description:
            'Llamadas del día que el en vivo nunca usa. Vacío sigue lo que planificó el control de cuota.',
          unit: 'llamadas',
        },
        LIVE_POLL_INTERVAL_SECONDS: {
          label: 'Frescura esperada del en vivo',
          description: 'La API lo usa para alertar cuando el dato en vivo se atrasa.',
          unit: 's',
        },
        CHANGE_FEED_RETENTION_DAYS: {
          label: 'Retención del feed de cambios',
          description: 'Cuántos días quedan los cambios en el feed antes de la limpieza.',
          unit: 'días',
        },
        AI_PROVIDER: {
          label: 'Proveedor de IA',
          description:
            'Quién escribe los textos de los agentes. Cambiarlo exige la clave del nuevo proveedor configurada.',
        },
        AI_MODEL_LIGHT: {
          label: 'Modelo liviano',
          description: 'Tareas cortas y de alto volumen: clasificación y revalidaciones.',
        },
        AI_MODEL_STANDARD: {
          label: 'Modelo estándar',
          description: 'Resúmenes post-partido y escenarios previos.',
        },
        AI_MODEL_RESEARCH: { label: 'Modelo de investigación', description: 'Búsqueda web de Dónde ver.' },
        AI_STATUS: {
          label: 'IA',
          description:
            'Interruptor general: encendida o apagada para todos los agentes. Apagada, ninguna llamada va al proveedor (ni la de los agentes con agente=on) y los agentes siguen solo con texto determinístico.',
        },
        AI_AGENT_STATUS: {
          label: 'IA por agente',
          description:
            'Apaga la IA de agentes específicos con la IA encendida, en el formato agente=on|off separado por comas (ej.: wtw=off). agente=on y un agente fuera de la lista siguen el estado global: con la IA apagada, todos quedan apagados. Vacío: todos siguen el global.',
        },
        AI_DAILY_TOKEN_BUDGET: {
          label: 'Presupuesto diario de tokens',
          description:
            'Tope de tokens por día (UTC), sumando todos los agentes: un número, o "Sin límite". Al llegar, los agentes siguen solo con texto determinístico. 0 no se acepta: para apagar la IA, usa el estado de la IA.',
          unit: 'tokens',
        },
        AI_DAILY_USD_BUDGET: {
          label: 'Presupuesto diario en US$',
          description:
            'Tope de gasto de IA por día (UTC), sumando todos los agentes: tokens y búsquedas web (la búsqueda de Google en Gemini se cobra por consulta). Al llegar, los agentes siguen solo con texto determinístico. Un número, o "Sin límite"; 0 no se acepta (para apagar la IA, usa el estado de la IA).',
          unit: 'US$',
        },
        AI_AGENT_USD_BUDGETS: {
          label: 'Tope diario por agente',
          description:
            'US$ por día de cada agente, en el formato agente=valor separado por comas (ej.: lineups=2,wtw=unlimited). El agente que llega al tope queda sin IA hasta el cambio de día UTC; unlimited quita su tope propio; un agente fuera de la lista queda con el tope del código o, sin él, con el tope del agente nuevo. La lista se combina agente por agente sobre los valores del código: solo cambian los agentes listados. 0 no se acepta: para apagar un agente, usa la IA por agente. Vacío usa el valor por defecto.',
        },
        AI_AGENT_DEFAULT_USD_BUDGET: {
          label: 'Tope diario del agente nuevo',
          description:
            'US$ por día de cada agente que no está en el tope por agente (un agente nuevo, por ejemplo): tiene IA, pero solo hasta este valor, y el log avisa una vez por día que está en el valor por defecto. Un número, o "Sin límite" (solo cuenta el tope global); 0 no se acepta.',
          unit: 'US$',
        },
        AI_MAX_SEARCHES_PER_CALL: {
          label: 'Búsquedas web por llamada',
          description:
            'Tope de búsquedas en cada llamada de investigación. OpenAI y Anthropic aplican el tope; Gemini lo recibe como instrucción, y las llamadas que lo superan aparecen en Gasto de IA hoy.',
          unit: 'búsquedas',
        },
        AI_MAX_RETRIES: {
          label: 'Intentos extra',
          description: 'Cuántas veces repetir una llamada ante un error pasajero del proveedor.',
        },
        AI_TIMEOUT_MS: {
          label: 'Tiempo límite por llamada',
          description: 'Espera máxima por una respuesta del proveedor.',
          unit: 'ms',
        },
        AI_REVIEW_PROVIDER: {
          label: 'IA de la revisión semántica',
          description:
            'IA que decide las sugerencias de edición de la Revisión semántica (Ajustes → Revisión). Predeterminado: Gemini.',
        },
        AI_REVIEW_MODEL: {
          label: 'Modelo de la revisión semántica',
          description:
            'Modelo de la IA que decide las sugerencias de edición. Vacío usa el predeterminado del proveedor elegido.',
        },
        AI_CHANNELS_PROVIDER: {
          label: 'IA de la lista de canales',
          description:
            'IA que revisa lo que sobra del cruce de la lista de canales del cliente con los derechos. Predeterminado: Gemini.',
        },
        AI_CHANNELS_MODEL: {
          label: 'Modelo de la lista de canales',
          description:
            'Modelo de la IA de la lista de canales. Vacío usa el predeterminado del proveedor elegido.',
        },
        WTW_MARKETS: {
          label: 'Mercados activos',
          description: 'Países en los que Dónde ver investiga dónde pasan cada partido.',
        },
        WTW_MIN_RELEVANCE: {
          label: 'Relevancia mínima para usar IA',
          description:
            'Solo partidos con relevancia en el mercado desde este valor gastan IA en la asignación por fecha.',
          unit: '/100',
        },
        WTW_DAILY_USD_PER_MARKET: {
          label: 'Tope diario por mercado',
          description: 'Gasto máximo de IA por país, por día.',
          unit: 'US$',
        },
        WTW_CHANNEL_WEEKLY_CRON: {
          label: 'Canal del partido: consulta semanal',
          description:
            'Cuándo investigar el canal de los partidos de las fechas que empiezan de 3 a 10 días adelante (la programación sale al menos una semana antes). Una consulta cubre la fecha entera; un partido con canal confirmado no vuelve a investigarse. Predeterminado: lunes a las 06:00 UTC.',
        },
        WTW_CHANNEL_RETRY_OFFSETS: {
          label: 'Canal del partido: nuevos intentos',
          description:
            'Cuánto antes del primer partido de la fecha intentar de nuevo, solo para los partidos que siguen sin canal confirmado en el mercado (ej.: 3d,1d o 36h; off desactiva). El mayor también define dónde empieza la consulta semanal.',
        },
        WTW_CHANNEL_POST: {
          label: 'Canal del partido: después del partido',
          description:
            'Confirma quién transmitió los partidos terminados que quedaron sin canal (hasta 72 horas después). También alimenta Dónde ver de los partidos terminados.',
        },
        AI_RIGHTS_PROVIDER: {
          label: 'Fuente de Dónde ver (IA)',
          description:
            'IA que descubre qué canales y plataformas transmiten cada competencia en cada país, la base de Dónde ver. Vacío usa el proveedor de los demás agentes; Gemini busca con Google.',
        },
        AI_RIGHTS_MODEL: {
          label: 'Modelo de la fuente de Dónde ver',
          description:
            'Modelo de la IA que busca los canales de Dónde ver. Vacío usa el predeterminado del proveedor elegido.',
        },
        LINEUP_MIN_REVIEW_STATUS: {
          label: 'Revisión mínima de la grilla de canales',
          description:
            'Operadoras, planes y streamings de Dónde ver solo llegan a la API desde este estado editorial (draft, reviewed o approved).',
        },
        LINEUP_PROMPT_MAX_CHARS: {
          label: 'Texto de las páginas por plataforma (grilla de canales)',
          description:
            'Para qué sirve: limita cuánto texto de las páginas de planes de una plataforma va a la IA en cada extracción de la grilla de canales (investigación y revisita diaria), dividido en partes iguales entre las páginas; controla el costo por llamada. Costo aproximado: cada 10 mil caracteres son ~2,5 mil tokens de entrada, ~US$ 0,00075 en Gemini Flash-Lite (~US$ 0,011 con el valor por defecto de 150 mil). Efecto secundario: lo que pasa del tope se corta del final de la página y la IA no ve esos planes, precios y canales; la revisita no marca nada como eliminado y el corte aparece en el log y en el resumen de la ejecución.',
          unit: 'caracteres',
        },
        LINEUP_PAGE_MAX_CHARS: {
          label: 'Texto de una página (grilla de canales)',
          description:
            'Tope de una sola página en la extracción de la grilla de canales (investigación y revisita), dentro del tope por plataforma. El valor por defecto es igual al de la plataforma: solo limita cuando es menor. Lo que pasa se corta del final de la página y la IA no ve esos planes y precios; el corte aparece en el log y en el resumen de la ejecución.',
          unit: 'caracteres',
        },
        YOUTUBE_SEARCH_DAILY_QUOTA: {
          label: 'Búsquedas por día en YouTube',
          description:
            'Cubo propio de la búsqueda (search.list), contado en consultas: 100 por día en un proyecto estándar. Más que eso requiere un aumento aprobado por Google.',
          unit: 'consultas',
        },
        YOUTUBE_DAILY_QUOTA: {
          label: 'Cuota diaria de YouTube (general)',
          description:
            'Unidades por día de las demás llamadas: subidas de los canales, detalles de videos y canales (se reinicia a la medianoche del Pacífico).',
          unit: 'unidades',
        },
        YOUTUBE_QUOTA_RESERVE_PERCENT: {
          label: 'Reserva de la cuota de YouTube',
          description: 'Parte de los dos cubos que el agente de videos nunca gasta.',
          unit: '%',
        },
        RELATED_MARKETS: {
          label: 'Mercados de los videos',
          description:
            'Países cuya relevancia decide qué partidos tienen videos y en qué idioma buscar. Vacío usa los mercados de Dónde ver.',
        },
        RELATED_MIN_RELEVANCE: {
          label: 'Relevancia mínima para buscar videos',
          description: 'Los partidos por debajo de esto en todos los mercados no gastan la cuota de YouTube.',
        },
        RELATED_MAX_VIDEOS: {
          label: 'Máximo de videos por partido',
          description:
            'Videos publicados por partido e idioma. Menos videos también reduce el consumo de la cuota de YouTube.',
          unit: 'videos',
        },
        RELATED_MARKET_WEIGHTS: {
          label: 'Peso de cada mercado',
          description:
            'Multiplica la relevancia del partido en el mercado al repartir las búsquedas (ej.: BR:1,AR:0.6). Vacío usa el estándar.',
        },
        RELATED_MAX_SEARCHES_PER_EVENT: {
          label: 'Búsquedas por partido (total)',
          description:
            'Tope de consultas de búsqueda por partido, sumando todas las rondas. Los canales oficiales van antes y no cuentan aquí.',
          unit: 'búsquedas',
        },
        RELATED_MAX_SEARCHES_PER_RUN: {
          label: 'Búsquedas por partido en cada ronda',
          description:
            'Consultas por partido en una ronda; la búsqueda se detiene antes cuando la primera no trae video aprovechable.',
          unit: 'búsquedas',
        },
        RELATED_CHANNEL_ENOUGH: {
          label: 'Videos oficiales que evitan la búsqueda',
          description:
            'Con esta cantidad de videos aprovechables en los canales oficiales (clubes, liga, emisoras), el partido no gasta búsqueda.',
          unit: 'videos',
        },
        RELATED_CHANNEL_REFRESH_MINUTES: {
          label: 'Relectura de los canales oficiales',
          description:
            'Entre búsquedas, las subidas de los canales del partido se leen de nuevo en cada intervalo. 0 lee en cada ronda.',
          unit: 'min',
        },
        RELATED_REVALIDATE_MINUTES: {
          label: 'Revalidación de los videos',
          description:
            'Los videos guardados se revisan (fuera de línea, estadísticas) como máximo una vez por intervalo.',
          unit: 'min',
        },
        RELATED_RESERVE_MAX_PERCENT: {
          label: 'Reserva de búsqueda para la agenda del día',
          description:
            'Tope de la parte de las búsquedas del día guardada para los partidos que aún se jugarán, por prioridad. 0 la desactiva.',
          unit: '%',
        },
        RELATED_SEARCH_AFTER_KICKOFF_MINUTES: {
          label: 'Primera búsqueda tras el inicio',
          description:
            'Al pitazo final la búsqueda aún no encuentra el resumen: antes de esto, solo se leen los canales oficiales.',
          unit: 'min',
        },
        RELATED_LOOKBACK_HOURS: {
          label: 'Ventana de partidos terminados',
          description: 'Solo los partidos terminados en las últimas horas entran en la fila de videos.',
          unit: 'h',
        },
        RELATED_SECOND_SEARCH_MINUTES: {
          label: 'Segunda búsqueda después de',
          description:
            'Los resúmenes suelen salir después del final: una segunda búsqueda corre este tiempo después de la primera. 0 la apaga.',
          unit: 'min',
        },
        RELATED_RESEARCH_HOURS: {
          label: 'Nueva búsqueda completa cada',
          description: 'Entre una búsqueda completa y otra del mismo partido, solo se revalidan los videos.',
          unit: 'h',
        },
        RELATED_CREATOR_MIN_SUBSCRIBERS: {
          label: 'Suscriptores mínimos de creadores',
          description:
            'Los canales fuera de la lista curada necesitan al menos estos suscriptores (solo reacción y análisis).',
          unit: 'suscriptores',
        },
        APISPORTS_PLAN: {
          label: 'Plan por defecto de api-sports',
          description:
            'Rige para toda API sin plan propio. Define la cuota diaria y las temporadas accesibles.',
        },
        QUOTA_RESERVE_PERCENT: {
          label: 'Reserva de la cuota diaria',
          description: 'Parte de la cuota que ningún job usa, para emergencias.',
          unit: '%',
        },
        ASSETS_CUSTOM_LOGOS: {
          label: 'Usar el acervo propio de escudos',
          description:
            'Encendido, la API muestra el escudo del acervo en todo lo que tenga mapeo (equipos, partidos, búsqueda, tablas). Apagado, vuelve al instante a los logos del proveedor, sin borrar nada.',
        },
        APISPORTS_KEY: { label: 'Clave de api-sports' },
        OPENAI_API_KEY: { label: 'Clave de OpenAI' },
        ANTHROPIC_API_KEY: { label: 'Clave de Anthropic' },
        GEMINI_API_KEY: { label: 'Clave de Gemini' },
        YOUTUBE_API_KEY: { label: 'Clave de YouTube' },
        QUALITY_API_KEY: { label: 'Calidad de los datos: clave de la API' },
        S3_ACCESS_KEY: { label: 'Almacenamiento: clave de acceso' },
        S3_SECRET_KEY: { label: 'Almacenamiento: secreto' },
        METRICS_TOKEN: { label: 'Token de las métricas' },
        WEBHOOK_SIGNING_SECRET: { label: 'Firma de los webhooks' },
        ADMIN_KEY_HASHES: { label: 'Claves de admin de la API' },
        GALAXIE_DEMO_KEY: { label: 'Clave de la demo en la API' },
        BETTER_AUTH_SECRET: { label: 'Secreto del login de la demo' },
        SMTP_HOST: { label: 'Correo: servidor' },
        SMTP_USER: { label: 'Correo: usuario' },
        SMTP_PASSWORD: { label: 'Correo: contraseña' },
      },
    },
  },
);
