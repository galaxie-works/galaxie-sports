/**
 * Prancha de revisão do fundo do heading: para cada piloto do manifesto, o carro e a foto que a importação
 * levaria ao fundo (`pickHighlight`), com a miniatura da Commons, a nota do Gemini e o crédito. Com o manifesto
 * de antes (`before`), as trocas vêm primeiro. Puro: só lê os manifestos.
 */
import { pickHighlight } from './import.js';
import type { CommonsManifest, ManifestEntry } from './manifest.js';

export interface PranchaRow {
  target: string;
  name: string;
  car: string | null;
  season: number | null;
  file: string | null;
  hero: number | null;
  license: string | null;
  author: string | null;
  pageUrl: string | null;
  /** Foto do fundo no manifesto de antes, quando trocou. */
  before: string | null;
  changed: boolean;
  /** Sem fundo porque os carros candidatos têm foto compatível, mas ainda sem a nota do Gemini. */
  pending: boolean;
}

const candidates = (e: ManifestEntry) =>
  e.highlight_car ? [e.highlight_car.target, ...(e.highlight_car.fallbacks ?? []).map((f) => f.target)] : [];
/** Carro com foto que pode ir ao fundo, mas sem a nota do Gemini (`hero`). */
const waiting = (car: ManifestEntry | undefined) =>
  !!car?.photos.some((p) => p.match !== 'rejected' && !p.share_alike && p.hero == null);

export function pranchaRows(manifest: CommonsManifest, before?: CommonsManifest | null): PranchaRow[] {
  const byTarget = new Map(manifest.entries.map((e) => [e.target, e]));
  const old = before ? new Map(before.entries.map((e) => [e.target, e])) : null;
  const oldByTarget = old ?? new Map<string, ManifestEntry>();
  const rows = manifest.entries
    .filter((e) => e.kind === 'driver')
    .map((e): PranchaRow => {
      const now = pickHighlight(e, byTarget);
      const prev = old?.get(e.target);
      const was = prev ? (pickHighlight(prev, oldByTarget)?.photo.file ?? null) : null;
      const file = now?.photo.file ?? null;
      return {
        target: e.target,
        name: e.name,
        car: now?.target ?? null,
        season: now?.season ?? null,
        file,
        hero: now?.photo.hero ?? null,
        license: now?.photo.license ?? null,
        author: now?.photo.author ?? null,
        pageUrl: now?.photo.page_url ?? null,
        before: was,
        changed: !!old && was !== file,
        pending: !now && candidates(e).some((c) => waiting(byTarget.get(c))),
      };
    });
  return rows.sort(
    (a, b) =>
      Number(b.changed) - Number(a.changed) ||
      Number(!b.file) - Number(!a.file) ||
      a.name.localeCompare(b.name),
  );
}

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const thumb = (file: string) =>
  `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file.replace(/^File:/, ''))}?width=480`;

export function pranchaHtml(rows: PranchaRow[], title: string): string {
  const changed = rows.filter((r) => r.changed).length;
  const empty = rows.filter((r) => !r.file).length;
  const pending = rows.filter((r) => r.pending).length;
  const card = (r: PranchaRow) => `
  <figure class="${r.changed ? 'changed' : ''}${r.file ? '' : ' empty'}">
    ${r.file ? `<a href="${esc(r.pageUrl ?? '#')}"><img loading="lazy" src="${esc(thumb(r.file))}" alt=""></a>` : `<div class="none">${r.pending ? 'aguardando nota do Gemini' : 'sem foto para o fundo'}</div>`}
    <figcaption>
      <strong>${esc(r.name)}</strong>
      <span>${r.car ? `${esc(r.car)} · ${r.season}` : '—'}${r.hero != null ? ` · nota ${r.hero.toFixed(2)}` : ''}</span>
      ${r.file ? `<small>${esc(r.file.replace(/^File:/, ''))} — ${esc(r.license ?? '?')}${r.author ? `, ${esc(r.author)}` : ''}</small>` : ''}
      ${r.changed ? `<small class="was">antes: ${r.before ? esc(r.before.replace(/^File:/, '')) : 'sem fundo'}</small>` : ''}
    </figcaption>
  </figure>`;
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
  :root { --bg: #fafafa; --fg: #18181b; --muted: #71717a; --card: #fff; --ring: rgb(24 24 27 / 0.1); --accent: #d97706; }
  @media (prefers-color-scheme: dark) { :root { --bg: #09090b; --fg: #fafafa; --muted: #a1a1aa; --card: #18181b; --ring: rgb(250 250 250 / 0.1); } }
  body { margin: 0; padding: 24px 16px; background: var(--bg); color: var(--fg); font: 14px/1.4 system-ui, sans-serif; }
  h1 { font-size: 20px; margin: 0 0 4px; } p { color: var(--muted); margin: 0 0 20px; }
  main { display: grid; gap: 16px; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); }
  figure { margin: 0; background: var(--card); border-radius: 12px; overflow: hidden; box-shadow: 0 0 0 1px var(--ring); }
  figure.changed { box-shadow: 0 0 0 2px var(--accent); }
  img, .none { display: block; width: 100%; aspect-ratio: 16 / 9; object-fit: cover; }
  .none { display: grid; place-items: center; color: var(--muted); background: var(--ring); }
  figcaption { display: grid; gap: 2px; padding: 10px 12px; }
  figcaption span, small { color: var(--muted); } small { font-size: 12px; overflow-wrap: anywhere; } .was { color: var(--accent); }
</style></head>
<body>
<h1>${esc(title)}</h1>
<p>${rows.length} pilotos · ${changed} trocados pela regra nova (borda laranja, primeiro) · ${empty} sem foto para o fundo (${pending} aguardando nota do Gemini)</p>
<main>${rows.map(card).join('')}
</main>
</body></html>
`;
}
