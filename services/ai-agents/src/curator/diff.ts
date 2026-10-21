/**
 * Diff unificado mínimo (estilo `git diff`) para a saída dry-run do curador. As mudanças do
 * curador são localizadas (acréscimos em listas, troca de campos), então cortamos prefixo e
 * sufixo comuns e fazemos LCS só no miolo.
 */

type Op = { kind: ' ' | '-' | '+'; line: string };

function lcsOps(a: readonly string[], b: readonly string[]): Op[] {
  const n = a.length;
  const m = b.length;
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ kind: ' ', line: a[i]! });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) ops.push({ kind: '-', line: a[i++]! });
    else ops.push({ kind: '+', line: b[j++]! });
  }
  while (i < n) ops.push({ kind: '-', line: a[i++]! });
  while (j < m) ops.push({ kind: '+', line: b[j++]! });
  return ops;
}

/** Diff unificado de dois textos (vazio quando iguais). `oldText` null = arquivo novo. */
export function unifiedDiff(path: string, oldText: string | null, newText: string, context = 3): string {
  if (oldText === newText) return '';
  const a = oldText === null ? [] : oldText.replace(/\n$/, '').split('\n');
  const b = newText.replace(/\n$/, '').split('\n');
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf])
    suf++;
  const ops: Op[] = [
    ...a.slice(0, pre).map((line) => ({ kind: ' ' as const, line })),
    ...lcsOps(a.slice(pre, a.length - suf), b.slice(pre, b.length - suf)),
    ...a.slice(a.length - suf).map((line) => ({ kind: ' ' as const, line })),
  ];

  // agrupa em hunks com `context` linhas ao redor das mudanças
  const changed = ops.map((o, i) => (o.kind === ' ' ? -1 : i)).filter((i) => i >= 0);
  const hunks: [number, number][] = [];
  for (const idx of changed) {
    const start = Math.max(0, idx - context);
    const end = Math.min(ops.length, idx + context + 1);
    const last = hunks.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else hunks.push([start, end]);
  }
  const out = [oldText === null ? '--- /dev/null' : `--- a/${path}`, `+++ b/${path}`];
  for (const [start, end] of hunks) {
    let oldLine = 1;
    let newLine = 1;
    for (let k = 0; k < start; k++) {
      if (ops[k]!.kind !== '+') oldLine++;
      if (ops[k]!.kind !== '-') newLine++;
    }
    const slice = ops.slice(start, end);
    const oldCount = slice.filter((o) => o.kind !== '+').length;
    const newCount = slice.filter((o) => o.kind !== '-').length;
    out.push(`@@ -${oldCount ? oldLine : 0},${oldCount} +${newLine},${newCount} @@`);
    for (const o of slice) out.push(`${o.kind}${o.line}`);
  }
  return `${out.join('\n')}\n`;
}
