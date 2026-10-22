/**
 * Painel "Ver código" (requisição, exemplos e resposta), abas dos blocos de código e a navegação dos
 * guias da documentação (a sidebar é do navegador, por isso os rótulos dos guias ficam aqui).
 */
import { defineMessages } from '../define';

export default defineMessages(
  {
    button: {
      label: 'Ver código',
      title: 'Ver a requisição da API que gera esta página',
    },
    sheet: {
      title: 'Como obter estes dados',
      copyUrl: 'Copiar URL',
      baseUrl: 'URL base',
      pathHint: 'caminho',
      queryHint: 'query',
      keyHint: 'header (sua chave)',
      example: 'Exemplo',
      response: 'Resposta',
      responseTitle: 'Resposta resumida (dados reais desta página)',
      responseError: 'Não foi possível ler a resposta agora.',
      moreItems: { one: '… +{count} item', other: '… +{count} itens' },
      seeInReference: 'Ver {route} na referência da API',
    },
    tabs: {
      language: 'Linguagem do exemplo',
      copy: 'Copiar código',
      copied: 'Copiado',
      showAll: 'Mostrar tudo',
      showLess: 'Mostrar menos',
    },
    docsNav: {
      start: { label: 'Começando', description: 'URL base, primeira chamada e o mapa da API.' },
      auth: { label: 'Autenticação', description: 'Chave no header, conta, rotação e limites de uso.' },
      concepts: { label: 'Conceitos', description: 'IDs canônicos, locales, cache/ETag, paginação e erros.' },
      modules: {
        label: 'Módulos e planos',
        description: 'O que cada plano libera e como a API responde fora dele.',
      },
      realtime: { label: 'Tempo real', description: 'Change feed, SSE e webhooks assinados.' },
      reference: {
        label: 'Referência da API',
        description: 'Todas as rotas do OpenAPI, com parâmetros e respostas.',
      },
    },
  },
  {
    en: {
      button: {
        label: 'View code',
        title: 'View the API request behind this page',
      },
      sheet: {
        title: 'How to get this data',
        copyUrl: 'Copy URL',
        baseUrl: 'Base URL',
        pathHint: 'path',
        queryHint: 'query',
        keyHint: 'header (your key)',
        example: 'Example',
        response: 'Response',
        responseTitle: 'Trimmed response (live data from this page)',
        responseError: "Couldn't load the response right now.",
        moreItems: { one: '… +{count} item', other: '… +{count} items' },
        seeInReference: 'See {route} in the API reference',
      },
      tabs: {
        language: 'Example language',
        copy: 'Copy code',
        copied: 'Copied',
        showAll: 'Show all',
        showLess: 'Show less',
      },
      docsNav: {
        start: { label: 'Getting started', description: 'Base URL, your first call and a map of the API.' },
        auth: { label: 'Authentication', description: 'Header key, account, rotation and rate limits.' },
        concepts: {
          label: 'Concepts',
          description: 'Canonical IDs, locales, caching/ETag, pagination and errors.',
        },
        modules: {
          label: 'Modules and plans',
          description: 'What each plan unlocks and how the API responds outside it.',
        },
        realtime: { label: 'Real time', description: 'Change feed, SSE and signed webhooks.' },
        reference: {
          label: 'API reference',
          description: 'Every OpenAPI route, with parameters and responses.',
        },
      },
    },
    'es-AR': {
      button: {
        label: 'Ver código',
        title: 'Ver la solicitud a la API que genera esta página',
      },
      sheet: {
        title: 'Cómo obtener estos datos',
        copyUrl: 'Copiar URL',
        baseUrl: 'URL base',
        pathHint: 'ruta',
        queryHint: 'query',
        keyHint: 'header (tu clave)',
        example: 'Ejemplo',
        response: 'Respuesta',
        responseTitle: 'Respuesta resumida (datos reales de esta página)',
        responseError: 'No se pudo leer la respuesta ahora.',
        moreItems: { one: '… +{count} ítem', other: '… +{count} ítems' },
        seeInReference: 'Ver {route} en la referencia de la API',
      },
      tabs: {
        language: 'Lenguaje del ejemplo',
        copy: 'Copiar código',
        copied: 'Copiado',
        showAll: 'Mostrar todo',
        showLess: 'Mostrar menos',
      },
      docsNav: {
        start: { label: 'Primeros pasos', description: 'URL base, primera llamada y el mapa de la API.' },
        auth: {
          label: 'Autenticación',
          description: 'Clave en el header, cuenta, rotación y límites de uso.',
        },
        concepts: {
          label: 'Conceptos',
          description: 'IDs canónicos, locales, caché/ETag, paginación y errores.',
        },
        modules: {
          label: 'Módulos y planes',
          description: 'Qué habilita cada plan y cómo responde la API fuera de él.',
        },
        realtime: { label: 'Tiempo real', description: 'Change feed, SSE y webhooks firmados.' },
        reference: {
          label: 'Referencia de la API',
          description: 'Todas las rutas del OpenAPI, con parámetros y respuestas.',
        },
      },
    },
  },
);
