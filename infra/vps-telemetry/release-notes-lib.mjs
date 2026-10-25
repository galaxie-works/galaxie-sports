/**
 * Lógica pura das notas de versão (infra/vps-telemetry/release-notes.mjs): leitura do assunto dos PRs, agrupamento,
 * data do deploy e numeração das tags `deploy-AAAA-MM-DD.N`. Sem git nem gh aqui, para os testes
 * (release-notes.test.mjs) rodarem sem rede.
 */

/** Fuso das tags: um deploy às 21:30 em Brasília é do mesmo dia, não do seguinte (UTC). */
export const DEPLOY_TIME_ZONE = 'America/Sao_Paulo';

/**
 * PR pelo assunto do squash merge: "tipo(área): título (#123)". Assunto sem o prefixo convencional, mas com o
 * número do PR no fim ("Sobre o jogo: ... (#274)"), vira tipo `outros` e cai em "Outros". Sem `(#N)` no fim
 * (commit direto na main) → null.
 */
export function parseSubject(subject) {
  const pr = subject.match(/^(.*?)\s*\(#(\d+)\)$/);
  if (!pr) return null;
  const [, text, number] = pr;
  const m = text.match(/^(\w+)(?:\(([^)]*)\))?!?:\s*(.+)$/);
  if (!m) return { type: 'outros', scopes: [], title: text.trim(), number };
  return { type: m[1], scopes: (m[2] ?? '').split(',').map((s) => s.trim()), title: m[3], number };
}

/** Área pela primeira área do PR que bate, nesta ordem (do mais específico ao mais geral). */
export const AREAS = [
  ['Fórmula 1', ['f1', 'race', 'formula-1', 'pilotos']],
  ['Onde assistir e grades', ['wtw', 'onde-assistir', 'grade', 'lineups', 'canais', 'channel-list']],
  ['Vídeos relacionados', ['related', 'videos', 'vídeos']],
  ['IA e custos', ['ai', 'ia', 'agents', 'llm', 'stakes', 'context', 'titulos']],
  ['Painel e revisão', ['ajustes', 'revisao', 'review', 'painel', 'ops', 'operacao']],
  [
    'Dados e ingestão',
    [
      'ingestion',
      'ingestor',
      'scheduler',
      'assets',
      'nomes',
      'pessoas',
      'perfis',
      'sync',
      'geo',
      'quality',
      'qualidade',
    ],
  ],
  ['API', ['api', 'contracts', 'webhooks', 'widgets']],
  ['App e navegação', ['demo', 'explorar', 'nav', 'live']],
  ['Infra e qualidade', ['infra', 'ci', 'smoke', 'deps', 'docker', 'db', 'test', 'tests']],
];
export const areaOf = (pr) =>
  AREAS.find(([, keys]) => pr.scopes.some((s) => keys.includes(s)))?.[0] ?? 'Geral';
export const KINDS = [
  ['Novidades', ['feat']],
  ['Correções', ['fix']],
  ['Bastidores', ['chore', 'docs', 'refactor', 'perf', 'test', 'ci', 'style', 'build']],
];

/** Seções em Markdown: novidades, correções e bastidores por área; o resto em "Outros". */
export function renderSections(prs, repoUrl) {
  const line = (pr) =>
    `- ${pr.title.charAt(0).toUpperCase()}${pr.title.slice(1)} ([#${pr.number}](${repoUrl}/pull/${pr.number}))`;
  const sections = [];
  for (const [kind, types] of KINDS) {
    const list = prs.filter((p) => types.includes(p.type));
    if (!list.length) continue;
    sections.push(`## ${kind}`);
    const byArea = new Map();
    for (const p of list) byArea.set(areaOf(p), [...(byArea.get(areaOf(p)) ?? []), p]);
    const order = [...AREAS.map(([a]) => a), 'Geral'];
    for (const area of order.filter((a) => byArea.has(a))) {
      sections.push(`### ${area}`, ...byArea.get(area).map(line), '');
    }
  }
  const others = prs.filter((p) => !KINDS.some(([, types]) => types.includes(p.type)));
  if (others.length) sections.push('## Outros', ...others.map(line), '');
  return sections;
}

/** Data AAAA-MM-DD no fuso do deploy. */
export function deployDate(now = new Date(), timeZone = DEPLOY_TIME_ZONE) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

const TAG_RE = /^deploy-(\d{4}-\d{2}-\d{2})\.(\d+)$/;

/** `deploy-2026-10-25.3` → { name, date: '2026-10-25', n: 3 }; outro nome → null. */
export function parseTagName(name) {
  const m = name.match(TAG_RE);
  return m ? { name, date: m[1], n: Number(m[2]) } : null;
}

/** Pelo nome, mais recente primeiro: data e número (10 depois de 9). Só desempate; a ordem vale pelo histórico. */
export const byTagDesc = (a, b) => (a.date === b.date ? b.n - a.n : a.date < b.date ? 1 : -1);

/**
 * Tags `deploy-*` do `git ls-remote --tags origin` (linhas "<sha>\trefs/tags/<nome>", e "<nome>^{}" com o
 * commit de uma tag anotada) → [{ name, date, n, sha }] com o sha do commit, mais recente primeiro.
 */
export function parseRemoteTags(lsRemote) {
  const byName = new Map();
  for (const row of lsRemote.split('\n').filter(Boolean)) {
    const [sha, ref] = row.split('\t');
    if (!ref?.startsWith('refs/tags/')) continue;
    const peeled = ref.endsWith('^{}');
    const tag = parseTagName(ref.slice('refs/tags/'.length).replace(/\^\{\}$/, ''));
    if (!tag) continue;
    // o commit (^{}) ganha do objeto da tag anotada; tag leve só tem a linha do commit
    if (peeled || !byName.has(tag.name)) byName.set(tag.name, { ...tag, sha });
  }
  return [...byName.values()].sort(byTagDesc);
}

/**
 * Tags no histórico publicado, mais recente primeiro pela posição do commit em `history` (os SHAs de
 * `git log --first-parent --format=%H <to>`, do mais novo ao mais velho), não pelo nome: tags do fluxo antigo
 * levam a data em UTC, e um deploy à noite ganhou o nome do dia seguinte, que passaria à frente das de depois.
 * Tag fora do histórico (commit que não é ancestral de `to`) fica de fora.
 */
export function orderByHistory(tags, history) {
  const pos = new Map(history.map((sha, i) => [sha, i]));
  return tags
    .filter((t) => pos.has(t.sha))
    .sort((a, b) => pos.get(a.sha) - pos.get(b.sha) || byTagDesc(a, b));
}

/**
 * Próxima tag do dia: o maior N já usado no dia (no GitHub ou só local) + 1. Pelo maior e não pela contagem, para
 * um buraco na sequência não repetir um nome que já existe.
 */
export function nextTag(names, today) {
  const used = names
    .map(parseTagName)
    .filter((t) => t && t.date === today)
    .map((t) => t.n);
  const n = Math.max(0, ...used) + 1;
  return { tag: `deploy-${today}.${n}`, n };
}

/** Título padrão da release a partir do nome da tag. */
export const titleOf = (tag) => `Deploy ${tag.date} nº ${tag.n}`;
