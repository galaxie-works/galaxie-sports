/**
 * As camadas do monorepo e as regras de dependência entre elas (issue #547). É a única fonte de verdade: o
 * `check.mjs` (pnpm lint:deps) cobra estas regras, e o mapa e a tabela de regras de docs/15 saem daqui.
 *
 * Camadas:
 *   app      apps/*                  processos que atendem gente (API, site/console)
 *   service  services/*              processos que rodam sozinhos (ingestor, agentes de IA)
 *   base     packages/ (lista abaixo)  infraestrutura sem regra de negócio: banco, contratos, logs, flags, SSRF, cliente
 *                                    da api-sports, agendador
 *   domain   packages/ (lista abaixo)  regras de negócio compartilhadas (provedores, tabelas, base semântica, ...)
 *   ui       packages/ (lista abaixo)  bibliotecas de interface entregues ao cliente
 *
 * Pacote novo em packages/ precisa entrar numa das listas: sem camada, o lint:deps reprova.
 */

export const PACKAGE_LAYERS = {
  base: [
    'db',
    'contracts',
    'observability',
    'runtime-config',
    'net-guard',
    'apisports-client',
    // o motor de agendamento compartilhado por ingestor e agentes (só fala com db, runtime-config e observability)
    'scheduler',
  ],
  domain: ['providers', 'rules', 'knowledge', 'where-to-watch', 'geo', 'ai-ledger'],
  ui: ['widgets'],
};

/** Ordem em que as camadas aparecem no mapa, com o título de cada uma. */
export const LAYER_TITLES = {
  app: 'apps',
  service: 'services',
  domain: 'domínio',
  base: 'base',
  ui: 'interface',
};

/** @typedef {{ dir: string, name: string, kind: 'app'|'service'|'base'|'domain'|'ui'|null, group: string }} Unit */

/** A camada de uma pasta de pacote (`apps/api`, `packages/db`), ou null se um pacote novo ainda não foi classificado. */
export function kindOf(dir) {
  const [group, name] = dir.split('/');
  if (group === 'apps') return 'app';
  if (group === 'services') return 'service';
  for (const [kind, names] of Object.entries(PACKAGE_LAYERS)) if (names.includes(name)) return kind;
  return null;
}

/**
 * Cada regra tem um nome estável (é o que aparece no CI e na lista de exceções), a frase curta, o porquê e como
 * resolver. `applies(from, to)` recebe as duas pontas (unidades diferentes) e diz se a dependência é proibida.
 */
export const RULES = [
  {
    id: 'app-nao-importa-app',
    summary: 'Um app não importa outro app.',
    why: 'Cada app vira uma imagem e um processo próprios; o que os dois precisam vai para packages/.',
    applies: (from, to) => from.kind === 'app' && to.kind === 'app',
  },
  {
    id: 'app-nao-importa-servico',
    summary: 'Nenhum app (apps/*) importa serviço (services/*).',
    why: 'App e serviço sobem e caem separados: o app que importa o serviço leva o código dele junto na imagem.',
    applies: (from, to) => from.kind === 'app' && to.kind === 'service',
  },
  {
    id: 'servico-nao-importa-servico',
    summary: 'Um serviço não importa outro serviço.',
    why: 'Serviços rodam em contêineres separados; o que é comum a dois serviços vai para packages/.',
    applies: (from, to) => from.kind === 'service' && to.kind === 'service',
  },
  {
    id: 'pacote-nao-importa-app-nem-servico',
    summary: 'Nenhum pacote (packages/*) importa app ou serviço.',
    why: 'Pacote é a camada de baixo: se ele depende de quem o usa, o grafo vira um nó e o Turborepo perde o que isolar.',
    applies: (from, to) => from.group === 'packages' && (to.kind === 'app' || to.kind === 'service'),
  },
  {
    id: 'base-nao-importa-dominio',
    summary: 'Pacote de base não importa pacote de domínio.',
    why: 'A base (banco, contratos, logs, flags, SSRF, cliente da api-sports) é reaproveitável sem a regra de negócio; o domínio é quem a usa.',
    applies: (from, to) => from.kind === 'base' && to.kind === 'domain',
  },
];

/** A regra de código que nenhum import alcança: o nome do host da api-sports no texto dos arquivos. */
export const APISPORTS_RULE = {
  id: 'so-o-apisports-client-fala-com-a-api-sports',
  summary: 'Só o pacote apisports-client fala com a api-sports.',
  why: 'Cota, raw, plano e limite por minuto vivem no cliente; chamada por fora gasta cota sem contar e sem guardar o raw.',
};

/** Pacote novo que ficou fora das listas de camada. */
export const UNCLASSIFIED_RULE = {
  id: 'pacote-sem-camada',
  summary: 'Todo pacote de packages/ está numa camada.',
  why: 'Sem camada, as regras acima não sabem de que lado do pacote ficam; adicione-o a PACKAGE_LAYERS em scripts/deps/rules.mjs.',
};

/** A dona única do contato com a api-sports. */
export const APISPORTS_OWNER = 'packages/apisports-client';

/** Nomes de host que identificam a api-sports (e o caminho antigo dela pelo RapidAPI). */
export const APISPORTS_HOST =
  /\b(?:[a-z0-9-]+\.)*(?:api-sports\.io|api-football\.com|api-football-v1\.p\.rapidapi\.com)\b/gi;

/** Arquivo de teste ou de apoio a teste: entra nas regras, mas não no mapa do que roda em produção. */
export function isTestFile(path) {
  return (
    /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path) ||
    /(?:^|\/)(?:test|tests|testing|__tests__|fixtures)\//.test(path)
  );
}

/** Todas as regras, na ordem em que o doc as lista. */
export const ALL_RULES = [...RULES, APISPORTS_RULE, UNCLASSIFIED_RULE];
