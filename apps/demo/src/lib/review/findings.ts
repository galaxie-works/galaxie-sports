/**
 * Achados do validador no perfil editorial da F1 (`findings` do item): o painel destaca o trecho no texto do campo,
 * com a cor da gravidade e o motivo, e a lista mostra o selo "N alertas / N graves". Puro: o servidor e o navegador
 * usam o mesmo cálculo.
 */

export type FindingSeverity = 'alert' | 'severe';

export interface Finding {
  field: string;
  start: number;
  end: number;
  rule: string;
  reason: string;
  severity: FindingSeverity;
}

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : {});

/** Os achados do conteúdo do item (o que não tiver a forma esperada fica de fora). */
export function findingsOf(content: Rec | null | undefined): Finding[] {
  const list = Array.isArray(content?.findings) ? content.findings : [];
  return list.flatMap((x) => {
    const f = rec(x);
    if (typeof f.field !== 'string' || typeof f.reason !== 'string') return [];
    return [
      {
        field: f.field,
        start: Number(f.start ?? 0),
        end: Number(f.end ?? 0),
        rule: String(f.rule ?? ''),
        reason: f.reason,
        severity: f.severity === 'severe' ? 'severe' : 'alert',
      } satisfies Finding,
    ];
  });
}

/** O selo da lista; null sem achados. */
export function findingCounts(content: Rec | null | undefined): { alert: number; severe: number } | null {
  const list = findingsOf(content);
  if (!list.length) return null;
  return {
    alert: list.filter((f) => f.severity === 'alert').length,
    severe: list.filter((f) => f.severity === 'severe').length,
  };
}

/** Campo do achado → a parte do perfil, o índice do item e se é a fonte (`moments[2].source`, `bio.sources[0]`). */
export function parseField(field: string): { part: string; index: number | null; source: boolean } | null {
  const m = /^(bio|style|strengths|moments|rivalries)(?:\[(\d+)\])?(\.sources?(?:\[\d+\])?)?$/.exec(field);
  if (!m) return null;
  return { part: m[1]!, index: m[2] == null ? null : Number(m[2]), source: !!m[3] };
}

/** O texto do campo do achado (a fonte, quando o achado é sobre ela). */
export function fieldText(content: Rec, field: string): string | null {
  const f = parseField(field);
  if (!f) return null;
  const node =
    f.index == null ? rec(content[f.part]) : rec((content[f.part] as unknown[] | undefined)?.[f.index]);
  if (!Object.keys(node).length) return null;
  if (f.source) {
    const i = /\[(\d+)\]$/.exec(field)?.[1];
    const sources = Array.isArray(node.sources) ? node.sources : [];
    const v = i != null && Array.isArray(node.sources) ? sources[Number(i)] : node.source;
    return typeof v === 'string' ? v : null;
  }
  return typeof node.text === 'string' ? node.text : null;
}

export interface Segment {
  text: string;
  /** A maior gravidade dos achados que cobrem o trecho; null fora de achado. */
  severity: FindingSeverity | null;
  findings: Finding[];
}

/** O texto em trechos, cada um com os achados que o cobrem (sobreposição vale a maior gravidade). */
export function segments(text: string, findings: Finding[]): Segment[] {
  const marks = findings
    .map((f) => ({
      ...f,
      start: Math.max(0, Math.min(f.start, text.length)),
      end: Math.min(f.end, text.length),
    }))
    .filter((f) => f.end > f.start);
  const cuts = [...new Set([0, text.length, ...marks.flatMap((f) => [f.start, f.end])])].sort(
    (a, b) => a - b,
  );
  const out: Segment[] = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const [a, b] = [cuts[i]!, cuts[i + 1]!];
    const covering = marks.filter((f) => f.start <= a && f.end >= b);
    const severity = covering.some((f) => f.severity === 'severe')
      ? 'severe'
      : covering.length
        ? 'alert'
        : null;
    const prev = out.at(-1);
    // trechos vizinhos com os mesmos achados viram um só
    if (
      prev &&
      prev.severity === severity &&
      prev.findings.length === covering.length &&
      covering.every((f) => prev.findings.includes(f))
    )
      prev.text += text.slice(a, b);
    else out.push({ text: text.slice(a, b), severity, findings: covering });
  }
  return out;
}

/** Os achados agrupados por campo, na ordem do perfil (bio, estilo, pontos fortes, momentos, rivalidades). */
export function findingsByField(findings: Finding[]): [string, Finding[]][] {
  const order = ['bio', 'style', 'strengths', 'moments', 'rivalries'];
  const groups = new Map<string, Finding[]>();
  for (const f of findings) groups.set(f.field, [...(groups.get(f.field) ?? []), f]);
  const rank = (field: string) => {
    const p = parseField(field);
    return p ? order.indexOf(p.part) * 1000 + (p.index ?? 0) * 2 + (p.source ? 1 : 0) : 99_999;
  };
  return [...groups.entries()].sort((a, b) => rank(a[0]) - rank(b[0]));
}
