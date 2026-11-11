/**
 * Funções puras do `pnpm status:prs` (status.mjs busca os dados com o gh; aqui só se classifica e se escreve o texto).
 * Testes em lib.test.mjs (`pnpm test:status-prs`).
 */

export const MIGRATION_RE = /^packages\/db\/drizzle\/(\d{4})_([^/]+)\.sql$/;

/** Linhas do comentário padrão de status num PR (CONTRIBUTING, regra 12). */
export const STATUS_KEYS = ['Revisão', 'Próximo passo', 'CI', 'Observação'];

const FAIL = new Set(['FAILURE', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'ERROR']);
const SKIP = new Set(['SKIPPED', 'NEUTRAL', 'STALE']);

/** Estado de um item do statusCheckRollup: pass | fail | pending | skip. */
export function checkState(item) {
  if (item.__typename === 'StatusContext') {
    if (item.state === 'SUCCESS') return 'pass';
    if (FAIL.has(item.state)) return 'fail';
    return 'pending';
  }
  if (item.status !== 'COMPLETED') return 'pending';
  if (item.conclusion === 'SUCCESS') return 'pass';
  if (SKIP.has(item.conclusion)) return 'skip';
  if (FAIL.has(item.conclusion)) return 'fail';
  return 'pending';
}

/**
 * Resume o CI de um PR. Um job rodado de novo aparece duas vezes no rollup: vale o mais recente pelo nome.
 * Retorna { state: 'verde' | 'pendente' | 'falhou' | 'sem CI', pass, pending: [nomes], fail: [{name, url}] }.
 */
export function summarizeCi(rollup = []) {
  const latest = new Map();
  for (const item of rollup) {
    const name = item.name ?? item.context;
    const at = item.startedAt ?? item.completedAt ?? '';
    const prev = latest.get(name);
    if (!prev || at >= prev.at) latest.set(name, { item, at });
  }
  const out = { state: 'sem CI', pass: 0, pending: [], fail: [] };
  for (const [name, { item }] of [...latest].sort(([a], [b]) => a.localeCompare(b))) {
    const s = checkState(item);
    if (s === 'pass') out.pass++;
    else if (s === 'pending') out.pending.push(name);
    else if (s === 'fail') out.fail.push({ name, url: item.detailsUrl ?? item.targetUrl ?? '' });
  }
  if (out.fail.length) out.state = 'falhou';
  else if (out.pending.length) out.state = 'pendente';
  else if (out.pass) out.state = 'verde';
  return out;
}

/** Migrations (número e tag) que o PR adiciona, pelo caminho dos arquivos do diff. */
export function prMigrations(files = []) {
  const found = [];
  for (const f of files) {
    const m = MIGRATION_RE.exec(f.path ?? f);
    if (m) found.push({ num: Number(m[1]), tag: `${m[1]}_${m[2]}` });
  }
  return found.sort((a, b) => a.num - b.num);
}

/** Última migration da main a partir do _journal.json. */
export function lastJournalEntry(journal) {
  const entries = journal?.entries ?? [];
  return entries.reduce((max, e) => (!max || e.idx > max.idx ? e : max), null);
}

/**
 * Problemas de numeração: número repetido entre PRs abertos e número que a main já usa.
 * `prs` = [{ number, migrations: [{num, tag}] }]; `mainLast` = número da última migration da main.
 */
export function migrationIssues(prs, mainLast) {
  const byNum = new Map();
  for (const pr of prs) for (const m of pr.migrations) {
    if (!byNum.has(m.num)) byNum.set(m.num, []);
    byNum.get(m.num).push(pr.number);
  }
  const issues = [];
  for (const [num, all] of [...byNum].sort(([a], [b]) => a - b)) {
    const pad = String(num).padStart(4, '0');
    const owners = [...new Set(all)].sort((a, b) => a - b);
    const who = owners.map((n) => `#${n}`).join(', ');
    if (owners.length > 1) issues.push({ prs: owners, text: `${pad} reservada em mais de um PR: ${who}` });
    for (const n of owners)
      if (all.filter((x) => x === n).length > 1) issues.push({ prs: [n], text: `${pad} aparece mais de uma vez no #${n}` });
    if (mainLast != null && num <= mainLast)
      issues.push({ prs: owners, text: `${pad} (${who}) já existe na main (última: ${String(mainLast).padStart(4, '0')}); renumerar` });
  }
  return issues;
}

/**
 * Lê o comentário padrão de status mais recente: linhas "Revisão: …", "Próximo passo: …", "CI: …", "Observação: …".
 * Só conta como status o comentário com a linha "Revisão:" ou com pelo menos duas das chaves (um comentário qualquer
 * com uma linha "CI: …" não apaga o status). Também reconhece o aviso de cota do Codex.
 * Retorna { fields: {chave: texto}, at, codexNoQuota }.
 */
export function parseStatusComments(comments = []) {
  // "Revisão: x", "- Revisão: x", "**Revisão**: x" e "**Revisão:** x"; chave com a grafia exata.
  const keyRe = new RegExp(`^\\s*[-*]?\\s*\\**(${STATUS_KEYS.join('|')})\\**\\s*:\\s*\\**\\s*(.+)$`);
  let fields = {};
  let at = null;
  let codexNoQuota = false;
  for (const c of comments) {
    const body = c.body ?? '';
    if (/codex usage limits/i.test(body)) codexNoQuota = true;
    const found = {};
    for (const line of body.split(/\r?\n/)) {
      const m = keyRe.exec(line);
      if (!m) continue;
      found[m[1]] = m[2].trim();
    }
    const isStatus = Boolean(found['Revisão']) || Object.keys(found).length >= 2;
    if (isStatus && (!at || (c.createdAt ?? '') >= at)) {
      fields = found;
      at = c.createdAt ?? at;
    }
  }
  return { fields, at, codexNoQuota };
}

/**
 * Pilhas, calculadas sobre TODOS os PRs abertos (não só os filtrados, senão o pai ou o filho fora do filtro some):
 * o PR cuja base é o branch de outro PR aberto está empilhado nele. Base diferente da main sem PR aberto para ela
 * também conta como pilha (`parentBranch`), para nunca sugerir squash.
 */
export function stackInfo(prs) {
  const byHead = new Map(prs.map((p) => [p.headRefName, p]));
  const info = new Map();
  for (const p of prs) {
    const onMain = p.baseRefName === 'main';
    const parent = onMain ? undefined : byHead.get(p.baseRefName);
    const children = prs.filter((c) => c.baseRefName === p.headRefName).map((c) => c.number);
    info.set(p.number, {
      parent: parent?.number ?? null,
      parentBranch: onMain || parent ? null : p.baseRefName,
      children,
      stacked: !onMain || children.length > 0,
    });
  }
  return info;
}

/**
 * Ordem de merge dos PRs da lista: a base de cada pilha antes dos filhos; entre pilhas e independentes, a menor
 * migration da pilha inteira primeiro, depois o número.
 */
export function mergeOrder(prs, stacks) {
  const byNum = new Map(prs.map((p) => [p.number, p]));
  const descendants = (p) => [p, ...stacks.get(p.number).children.filter((c) => byNum.has(c)).flatMap((c) => descendants(byNum.get(c)))];
  const minMig = (p) => Math.min(...descendants(p).map((d) => d.migrations[0]?.num ?? Infinity));
  const roots = prs.filter((p) => !byNum.has(stacks.get(p.number).parent));
  roots.sort((a, b) => minMig(a) - minMig(b) || a.number - b.number);
  const order = [];
  const visit = (p) => {
    if (order.includes(p)) return;
    order.push(p);
    for (const c of stacks.get(p.number).children) if (byNum.has(c)) visit(byNum.get(c));
  };
  roots.forEach(visit);
  return order;
}

function mergeableText(m) {
  if (m === 'CONFLICTING') return 'em conflito com a base';
  if (m === 'MERGEABLE') return 'sem conflito';
  return 'conflito ainda não calculado pelo GitHub';
}

function ciText(ci, sha) {
  const at = sha ? ` em ${sha.slice(0, 8)}` : '';
  if (ci.state === 'sem CI') return `sem checks${at}`;
  if (ci.state === 'verde') return `verde${at} (${ci.pass} checks)`;
  const parts = [];
  if (ci.fail.length) parts.push(`falhou: ${ci.fail.map((f) => `"${f.name}"`).join(', ')}`);
  if (ci.pending.length)
    parts.push(ci.pending.length > 3 ? `${ci.pending.length} pendentes` : `pendente: ${ci.pending.map((n) => `"${n}"`).join(', ')}`);
  return `${parts.join('; ')}${at} (${ci.pass} verdes)`;
}

/** Texto do status, pronto para colar ou para o Agente Master ler. */
export function render({ title, prs, stacks = stackInfo(prs), merged = [], mainLast, generatedAt, issues }) {
  const ordered = mergeOrder(prs, stacks);
  const lines = [];
  lines.push(`${title} — gerado em ${generatedAt}`);
  lines.push('');
  if (merged.length) {
    lines.push(`Já na main: ${merged.map((p) => `#${p.number}`).join(', ')}.`);
    lines.push('');
  }
  if (!ordered.length) {
    lines.push('Nenhum PR aberto.');
    return lines.join('\n');
  }
  lines.push(`PRs abertos, na ordem de merge (${ordered.length}):`);
  ordered.forEach((p, i) => {
    const st = stacks.get(p.number);
    const draft = p.isDraft ? 'rascunho' : 'pronto para revisão';
    const how = st.stacked
      ? `pilha${st.parent ? ` sobre #${st.parent}` : ''}${st.parentBranch ? ` sobre ${st.parentBranch} (sem PR aberto)` : ''}${st.children.length ? `, base de ${st.children.map((n) => `#${n}`).join(', ')}` : ''}; entra com merge commit`
      : `base ${p.baseRefName}, independente; entra com squash`;
    lines.push('');
    lines.push(`${i + 1}. #${p.number}, ${p.title}`);
    lines.push(`   - ${draft}; ${how}; ${mergeableText(p.mergeable)}.`);
    lines.push(`   - CI: ${ciText(p.ci, p.headRefOid)}.`);
    if (p.migrations.length) lines.push(`   - Migrations: ${p.migrations.map((m) => m.tag).join(', ')}.`);
    const labels = (p.labels ?? []).map((l) => l.name ?? l);
    if (labels.length) lines.push(`   - Rótulos: ${labels.join(', ')}.`);
    const f = p.status.fields;
    if (f['Revisão']) lines.push(`   - Revisão: ${f['Revisão']}`);
    else if (p.status.codexNoQuota) lines.push('   - Revisão: Codex sem cota; sem comentário de status no PR.');
    else lines.push('   - Revisão: sem comentário de status no PR.');
    for (const k of STATUS_KEYS.slice(1)) if (f[k]) lines.push(`   - ${k}: ${f[k]}`);
  });
  lines.push('');
  const mainTxt = mainLast != null ? `última na main: ${String(mainLast).padStart(4, '0')}` : 'última na main: desconhecida';
  lines.push(`Migrations (${mainTxt}):`);
  if (issues.length) issues.forEach((t) => lines.push(`- ATENÇÃO: ${t.text}`));
  else lines.push('- sem número repetido nem já usado na main.');
  return lines.join('\n');
}
