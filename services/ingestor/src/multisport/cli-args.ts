/** Lê "--chave valor" / "--chave=valor" / "--flag" de process.argv. */
export function parseArgs(argv: string[]): Map<string, string | true> {
  const out = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith('--')) continue;
    const eq = a.indexOf('=');
    if (eq > 0) {
      out.set(a.slice(2, eq), a.slice(eq + 1));
      continue;
    }
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      out.set(a.slice(2), next);
      i += 1;
    } else out.set(a.slice(2), true);
  }
  return out;
}

export function listArg(args: Map<string, string | true>, key: string): string[] | undefined {
  const v = args.get(key);
  return typeof v === 'string'
    ? v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;
}

export const pct = (x: number | null) => (x === null ? '—' : `${(x * 100).toFixed(1)}%`);
