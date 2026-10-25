/**
 * Escolha das fotos de cada alvo. A decisão final é por regras verificáveis; a IA só ordena.
 *
 * Regras (eliminatórias):
 * - licença lida da Commons (`extmetadata`) entre as aceitas: domínio público, CC0, CC BY, CC BY-SA;
 * - foto (JPEG/PNG), sem SVG, áudio, vídeo ou PDF;
 * - resolução mínima (lado maior ≥ 640 px e menor ≥ 480 px: as fotos de época na Commons são pequenas);
 * - época certa: com data, entre a temporada de estreia e a última (±1 ano) para o piloto; ano do carro ±3
 *   (museus e exibições depois da temporada contam, mas valem menos);
 * - sem palavras de não-foto no título (assinatura, logo, gráfico, estátua, túmulo, mural...).
 * O Gemini (opcional) classifica cada candidata (retrato, ação, carro, outro), descarta o que não é foto real
 * e dá uma nota de qualidade; sem ele, a ordem é por regras (foto do Wikidata, categoria de retratos,
 * resolução).
 */
import { readLicense, yearOf, type CommonsLicense } from './license.js';
import type { Candidate, Discovery } from './discover.js';

export const MIN_LONG_SIDE = 640;
export const MIN_SHORT_SIDE = 480;
const PHOTO_MIME = new Set(['image/jpeg', 'image/png']);
const NOT_A_PHOTO =
  /\b(signature|logo|chart|graph|diagram|accumulation|map|statue|grave|tomb|mural|graffiti|painting|drawing|poster|stamp|coin|card|cartão|toy|lego|model|replica|wax|figure|cake|diecast|die cast|miniature)\b/i;

export type PhotoRole = 'portrait' | 'action' | 'car';

/**
 * Mesma foto em versões diferentes na Commons (original e recortes): "X (cropped).jpg", "X cropped 2.jpg",
 * "X (33686752075).jpg" (número do Flickr) viram a mesma base — só uma entra.
 */
export function photoBase(title: string): string {
  return title
    .toLowerCase()
    .replace(/^file:/, '')
    .replace(/\.(jpe?g|png)$/, '')
    .replace(/\(\d{6,}\)/g, ' ')
    .replace(/\(?\bcrop(ped)?\s*\d*\)?/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Julgamento da IA para uma candidata (pela posição na lista enviada). */
export interface AiJudgement {
  index: number;
  kind: 'portrait' | 'action' | 'car' | 'other';
  /** É foto real (não ilustração, estátua, captura de tela...). */
  keep: boolean;
  /** 0–10: nitidez, enquadramento, rosto visível (retrato) ou carro inteiro (carro). */
  quality: number;
  /**
   * Carro: 0–1, serve para o fundo do heading do piloto (corrida da temporada com o piloto > carro em ação em
   * evento histórico > carro parado inteiro; close de gente, detalhe ou pessoa moderna em primeiro plano ≈ 0).
   */
  hero?: number;
  reason?: string;
}

export interface Eligible {
  candidate: Candidate;
  license: CommonsLicense;
  year: number | null;
  /** Nota das regras (desempate e ordem sem IA). */
  ruleScore: number;
}

export interface Rejection {
  title: string;
  reason: string;
}

/** Aplica as regras eliminatórias e dá a nota de regras. */
export function eligible(d: Discovery): { ok: Eligible[]; rejected: Rejection[] } {
  const ok: Eligible[] = [];
  const rejected: Rejection[] = [];
  const window =
    d.target.kind === 'driver'
      ? { from: (d.target.seasons[0] ?? 0) - 1, to: (d.target.seasons.at(-1) ?? 9999) + 1 }
      : { from: d.target.year - 1, to: d.target.year + 3 };
  for (const c of d.candidates) {
    const f = c.file;
    const reject = (reason: string) => rejected.push({ title: f.title, reason });
    if (!PHOTO_MIME.has(f.mime)) {
      reject(`não é foto (${f.mime})`);
      continue;
    }
    if (NOT_A_PHOTO.test(f.title.replace(/[_-]/g, ' '))) {
      reject('título indica que não é foto do piloto/carro');
      continue;
    }
    const long = Math.max(f.width, f.height);
    const short = Math.min(f.width, f.height);
    if (long < MIN_LONG_SIDE || short < MIN_SHORT_SIDE) {
      reject(`resolução baixa (${f.width}×${f.height})`);
      continue;
    }
    // carro de destaque: foto que cita outro piloto da temporada (e não o do destaque) é de outro carro ou do
    // companheiro; sem foto boa, o alvo fica sem foto
    if (c.other) {
      reject('cita outro piloto da temporada');
      continue;
    }
    const verdict = readLicense(f.extmetadata);
    if (!verdict.ok) {
      reject(verdict.reason);
      continue;
    }
    const year = c.season ?? yearOf(verdict.value.dateTaken);
    // a data da Commons às vezes é a do upload; só a categoria da temporada ou uma data dentro da janela valem
    if (year != null && c.season == null && (year < window.from || year > window.to)) {
      if (d.target.kind === 'driver' && !c.wikidataImage && !c.portraitCategory) {
        reject(`fora da época (${year})`);
        continue;
      }
    }
    let ruleScore = 0;
    if (c.wikidataImage) ruleScore += 3;
    if (c.portraitCategory) ruleScore += 2;
    // carro de destaque: a foto do carro com o piloto vale mais que a do carro com o companheiro
    if (c.featured) ruleScore += 3;
    if (c.season != null) ruleScore += 1;
    // época da carreira (o retrato de 2015 de um piloto dos anos 1980 vale menos)
    if (year != null && year >= window.from && year <= window.to) ruleScore += 2;
    ruleScore += Math.min(2, long / 2000);
    if (/crop/i.test(f.title)) ruleScore += 0.5;
    ok.push({ candidate: c, license: verdict.value, year, ruleScore });
  }
  return { ok, rejected };
}

export interface ChosenPhoto {
  eligible: Eligible;
  role: PhotoRole;
  rank: number;
  selectedBy: 'rules' | 'gemini';
  reason: string | null;
  /** Nota do Gemini para o fundo do heading (só carro). */
  hero?: number;
}

/**
 * Ordena e escolhe: piloto → 1 retrato + até `maxAction` fotos de ação (no máximo 2 por temporada); carro → até
 * `maxCars` fotos. Com julgamento da IA, só entra o que ela manteve (`keep`) e a ordem é a nota dela.
 */
export function choose(
  d: Discovery,
  pool: Eligible[],
  ai: AiJudgement[] | null,
  opts: { maxAction?: number; maxCars?: number } = {},
): ChosenPhoto[] {
  const judged = (i: number) => ai?.find((a) => a.index === i) ?? null;
  const scored = pool
    .map((e, i) => ({ e, j: judged(i) }))
    .filter(({ j }) => !ai || (j?.keep ?? false))
    .map(({ e, j }) => ({ e, j, score: (j ? j.quality * 2 : 0) + e.ruleScore }))
    .sort((a, b) => b.score - a.score);
  const by = ai ? ('gemini' as const) : ('rules' as const);
  // uma versão por foto (original ou recorte), a de maior nota
  const used = new Set<string>();
  const fresh = (e: Eligible) => {
    const base = photoBase(e.candidate.file.title);
    if (used.has(base)) return false;
    used.add(base);
    return true;
  };
  if (d.target.kind === 'car') {
    // a foto de corrida do carro às vezes volta do Gemini como "action": também é foto do carro
    const cars = scored
      .filter(({ j }) => !j || j.kind === 'car' || j.kind === 'action')
      .filter(({ e }) => fresh(e));
    const top = cars.slice(0, opts.maxCars ?? 3);
    // a melhor para o fundo do heading (nota `hero`) entra mesmo fora das de mais qualidade: a foto de corrida
    // de 1950 perde em nitidez para a do museu, mas é a que vai ao fundo. Só entre as que podem ir ao fundo (sem
    // CC BY-SA): a Ferrari 2026 tinha as 3 de mais qualidade em BY-SA e a CC BY da China ficava de fora
    const hero = cars
      .filter(({ e }) => !e.license.shareAlike)
      .sort((a, b) => (b.j?.hero ?? 0) - (a.j?.hero ?? 0))[0];
    if (hero?.j?.hero != null && !top.includes(hero)) top.push(hero);
    return top.map(({ e, j }, rank) => ({
      eligible: e,
      role: 'car',
      rank,
      selectedBy: by,
      reason: j?.reason ?? null,
      ...(j?.hero != null ? { hero: j.hero } : {}),
    }));
  }
  const out: ChosenPhoto[] = [];
  // o retrato mais recente dentro da carreira (Hamilton na Ferrari, não na Mercedes; Prost piloto, não em 2015);
  // depois o sem data e, por último, o de fora da época (só os retratos escapam da regra da época); a nota desempata
  const seasons = d.target.kind === 'driver' ? d.target.seasons : [];
  const from = (seasons[0] ?? 0) - 1;
  const to = (seasons.at(-1) ?? 9999) + 1;
  const band = (y: number | null) => (y == null ? 1 : y >= from && y <= to ? 0 : 2);
  const recent = <T extends { e: Eligible }>(list: T[]) =>
    [...list].sort(
      (a, b) =>
        band(a.e.year) - band(b.e.year) || (band(a.e.year) === 0 ? (b.e.year ?? 0) - (a.e.year ?? 0) : 0),
    )[0];
  const portrait =
    recent(scored.filter(({ j }) => j?.kind === 'portrait')) ??
    (ai
      ? undefined
      : recent(scored.filter(({ e }) => e.candidate.portraitCategory || e.candidate.wikidataImage)));
  if (portrait && fresh(portrait.e))
    out.push({
      eligible: portrait.e,
      role: 'portrait',
      rank: 0,
      selectedBy: by,
      reason: portrait.j?.reason ?? null,
    });
  const perSeason = new Map<number, number>();
  let actions = 0;
  for (const s of scored) {
    // o limite é só das fotos de ação (com ou sem retrato)
    if (actions >= (opts.maxAction ?? 6)) break;
    if (s === portrait) continue;
    if (s.j && s.j.kind !== 'action' && s.j.kind !== 'portrait') continue;
    const y = s.e.year ?? -1;
    if ((perSeason.get(y) ?? 0) >= 2) continue;
    if (!fresh(s.e)) continue;
    perSeason.set(y, (perSeason.get(y) ?? 0) + 1);
    actions += 1;
    out.push({
      eligible: s.e,
      role: 'action',
      rank: out.length,
      selectedBy: by,
      reason: s.j?.reason ?? null,
    });
  }
  return out;
}
