/**
 * Auditoria dos perfis de piloto da F1 contra o F1DB (CC BY 4.0, a fonte da carreira): compara o que a API serve
 * (`/v1/teams/:id/career`, o país do `/v1/teams/:id` e a campanha do overview) com o release, campo a campo. Puro:
 * recebe a verdade do F1DB e as respostas da API e devolve um problema por campo errado. O CLI
 * (`cli/f1-auditoria.ts`) carrega as duas pontas e escreve o relatório.
 *
 * O heading (temporada em destaque, cor e foto de fundo) segue as regras da demo
 * (`apps/demo/src/lib/driver-hero.ts`), reproduzidas aqui só para conferir o resultado.
 */
import type { CareerSeason, Photo, RaceCareer, TeamCompetition } from '@galaxie/contracts';

/** O piloto no F1DB, já agregado do `race_data`. */
export interface F1dbDriverTruth {
  id: string;
  name: string;
  firstName: string;
  lastName: string;
  nationality: { code: string; name: string } | null;
  birthDate: string | null;
  birthPlace: string | null;
  birthCountry: { code: string; name: string } | null;
  permanentNumber: number | null;
  /** GPs largados (`total_race_starts`): o "GPs disputados" da página. */
  starts: number;
  wins: number;
  podiums: number;
  poles: number;
  /** Pontos do campeonato, somados por temporada já arredondada (como o `core.standing`). */
  points: number;
  dnfs: number;
  bestFinish: { position: number; count: number } | null;
  /** Anos com título (1º no campeonato, temporada encerrada). */
  titles: number[];
  /** Número mais usado na temporada (empate: o menor). */
  numberBySeason: Map<number, number>;
  /** Construtores com mais corridas largadas na temporada (ids do F1DB; mais de um no empate). */
  teamBySeason: Map<number, string[]>;
}

export type AuditField =
  | 'pais'
  | 'nascimento'
  | 'numero_permanente'
  | 'numero_temporada'
  | 'titulos'
  | 'gps'
  | 'vitorias'
  | 'podios'
  | 'poles'
  | 'pontos'
  | 'melhor_resultado'
  | 'abandonos'
  | 'equipe_temporada'
  | 'cor_equipe'
  | 'cor_sem_curadoria'
  | 'campanha_temporada'
  | 'retrato'
  | 'fundo_heading'
  | 'nome';

export const AUDIT_FIELDS: { field: AuditField; label: string; outOfScope?: string }[] = [
  { field: 'pais', label: 'País e nacionalidade' },
  { field: 'nascimento', label: 'Nascimento (data, local e país)' },
  { field: 'numero_permanente', label: 'Número permanente' },
  { field: 'numero_temporada', label: 'Número da temporada selecionada' },
  { field: 'titulos', label: 'Títulos mundiais (quantidade e anos)' },
  { field: 'gps', label: 'GPs disputados' },
  { field: 'vitorias', label: 'Vitórias' },
  { field: 'podios', label: 'Pódios' },
  { field: 'poles', label: 'Poles' },
  { field: 'pontos', label: 'Pontos' },
  { field: 'melhor_resultado', label: 'Melhor resultado (com contagem)' },
  { field: 'abandonos', label: 'Abandonos' },
  { field: 'equipe_temporada', label: 'Equipe da temporada selecionada' },
  { field: 'cor_equipe', label: 'Cor da equipe (curadoria e contraste)' },
  {
    field: 'cor_sem_curadoria',
    label: 'Pintura da época sem curadoria',
    outOfScope: 'lacuna do liveries.yaml (curadoria com fonte e revisão), não erro de código',
  },
  { field: 'campanha_temporada', label: 'Campanha da temporada atual' },
  {
    field: 'retrato',
    label: 'Retrato',
    outOfScope: 'retrato mais recente: sessão "Fotos da F1 para o grid atual"',
  },
  {
    field: 'fundo_heading',
    label: 'Fundo do heading',
    outOfScope: 'fotos do grid de 2026 e fallback do carro: sessão "Fotos da F1 para o grid atual"',
  },
  { field: 'nome', label: 'Nome (primeiro nome e sobrenome)' },
];

export interface AuditIssue {
  field: AuditField;
  current: string;
  expected: string;
  source: string;
  /** Tema de outra frente: só listado, não corrigido aqui. */
  outOfScope?: boolean;
}

/** O que a API serve para o piloto. */
export interface ServedProfile {
  name: string;
  /** País do `/v1/teams/:id` (`country_ref`), no idioma pedido. */
  country: { code: string; name: string } | null;
  career: RaceCareer;
  /** Campanhas do overview (só as da temporada atual interessam). */
  competitions: TeamCompetition[];
}

export interface AuditContext {
  /** Nome do país no idioma da página (`Intl.DisplayNames`), para conferir o rótulo. */
  countryName: (code: string) => string | null;
  /** Construtor do F1DB de cada equipe do core (`provider_map`). */
  f1dbConstructorsOf: (teamId: string) => string[];
  /** Pintura curada do construtor do F1DB no ano. */
  liveryOf: (constructorId: string, year: number) => { colors: string[] } | null;
  /** GPs do calendário ainda por correr na temporada atual (o F1DB traz o calendário inteiro). */
  racesLeftInCurrentSeason: number;
  /** Ano da temporada atual no F1DB. */
  currentYear: number;
}

const F1DB = (what: string) => `F1DB v2026.17.0 (${what})`;
const fmtList = (xs: number[]) => (xs.length ? xs.join(', ') : '—');
const fmtBest = (b: { position: number; count: number } | null) => (b ? `${b.position}º (x${b.count})` : '—');
const norm = (s: string | null | undefined) =>
  (s ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

// ─── regras do heading (as mesmas da demo) ───────────────────────────────────────────────────────

const isTitle = (s: CareerSeason) => s.final && s.position === 1;
export const coverable = (p: Photo | null | undefined): p is Photo => !!p?.url && !p.credit.share_alike;

/** Temporada do heading, o carro do fundo e o retrato (`heroPhotos` da demo). */
export function heroOf(career: RaceCareer): { season: CareerSeason | null; car: Photo | null } {
  const highlight = coverable(career.highlight?.car) ? career.highlight : null;
  const current =
    career.current_season == null
      ? null
      : (career.seasons.find((s) => s.year === career.current_season) ?? null);
  if (current) {
    const team = current.teams[0]?.id;
    const sameTeam = (s: CareerSeason | undefined) => !!team && s?.teams[0]?.id === team;
    const highlightSeason = career.seasons.find((s) => s.year === highlight?.season);
    const car = coverable(current.car)
      ? current.car
      : highlight && sameTeam(highlightSeason)
        ? highlight.car
        : (career.seasons.find((s) => sameTeam(s) && coverable(s.car))?.car ?? null);
    return { season: current, car };
  }
  const raced = career.seasons.filter((s) => s.races > 0 || s.position != null);
  const curated = highlight?.season;
  const picked = curated != null ? raced.find((s) => s.year === curated) : undefined;
  const ranked = [...raced].sort(
    (a, b) => Number(isTitle(b)) - Number(isTitle(a)) || b.wins - a.wins || b.year - a.year,
  );
  const season = picked ?? ranked.find((s) => coverable(s.car)) ?? ranked[0] ?? null;
  const car =
    highlight && season?.year === highlight.season
      ? highlight.car
      : coverable(season?.car)
        ? season.car
        : null;
  return { season, car };
}

/** Luminância relativa (WCAG) de `#rrggbb`. */
export function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
export const contrastWithWhite = (hex: string) => 1.05 / (luminance(hex) + 0.05);

const hexOf = (rgb: number[]) =>
  `#${rgb
    .map((c) =>
      Math.round(Math.min(255, Math.max(0, c)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
const rgbOf = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/**
 * Fundo atrás do nome no heading da demo (`backdrop` de `driver-hero.tsx`): a cor da equipe misturada meio a meio
 * com quase preto, sob o véu preto de 45% do lado do texto. A mistura é em sRGB (a demo usa oklab: diferença
 * pequena para o contraste).
 */
export function textBackdrop(color: string): string {
  const mixed = rgbOf(color).map((c) => (c + 5) / 2);
  return hexOf(mixed.map((c) => c * 0.55));
}

/** Nomes aceitos do país: o do idioma da página e as grafias consagradas que o cadastro curado usa. */
const COUNTRY_ALIASES: Record<string, string[]> = {
  NL: ['Holanda'],
  CZ: ['República Tcheca'],
  HK: ['Hong Kong'],
};
function countryNames(want: { code: string; name: string }, ctx: AuditContext): string[] {
  return [ctx.countryName(want.code) ?? want.name, ...(COUNTRY_ALIASES[want.code] ?? [])];
}

/** Cor do heading (`heroColor` da demo). */
export function heroColorOf(season: CareerSeason | null): string | null {
  const team = season?.teams[0];
  const livery = team?.livery;
  if (livery) {
    const light = luminance(livery.primary) > 0.6;
    if (light && livery.secondary && luminance(livery.secondary) < luminance(livery.primary))
      return livery.secondary;
    return livery.primary;
  }
  return team?.colors?.primary ?? null;
}

/** Licenças livres do acervo, inclusive as portadas para um país ("CC BY-SA 2.0 de"). */
const OK_LICENSE = /^(CC BY(-SA)? [\d.]+( [a-z]{2})?|CC0( 1\.0)?|Public domain|PD.*|Domínio público)$/i;

// ─── auditoria de um piloto ──────────────────────────────────────────────────────────────────────

export function auditDriver(truth: F1dbDriverTruth, served: ServedProfile, ctx: AuditContext): AuditIssue[] {
  const issues: AuditIssue[] = [];
  const add = (field: AuditField, current: string, expected: string, source: string, outOfScope = false) =>
    issues.push({ field, current, expected, source, ...(outOfScope ? { outOfScope } : {}) });
  const { career } = served;
  const t = career.totals;

  // país: o código e o rótulo (um código com várias linhas na tabela não pode cair por acaso)
  const countryOk = (
    got: { code: string; name: string } | null | undefined,
    want: { code: string; name: string },
  ) => !!got && got.code === want.code && countryNames(want, ctx).some((n) => norm(n) === norm(got.name));
  if (truth.nationality && !countryOk(served.country, truth.nationality)) {
    const got = served.country;
    add(
      'pais',
      got ? `${got.code} ${got.name}` : '—',
      `${truth.nationality.code} ${countryNames(truth.nationality, ctx)[0]}`,
      F1DB(`driver.nationality_country_id = ${truth.nationality.name}`),
      // o rótulo errado do GB (a linha do Reino Unido com nome de outra nação) é o caso GB/Wales da outra frente
      !!got && got.code === 'GB' && truth.nationality.code === 'GB',
    );
  }

  // nascimento: data, local e país
  const p = career.profile;
  const birthWant = [truth.birthDate, truth.birthPlace, truth.birthCountry?.code].join(' · ');
  const birthGot = [p?.birth_date, p?.birth_place, p?.birth_country?.code].join(' · ');
  if (birthWant !== birthGot)
    add('nascimento', birthGot, birthWant, F1DB('driver.date_of_birth, place_of_birth, country_of_birth'));
  else if (truth.birthCountry && !countryOk(p?.birth_country, truth.birthCountry))
    add(
      'nascimento',
      `país: ${p?.birth_country?.name ?? '—'}`,
      `país: ${countryNames(truth.birthCountry, ctx)[0]}`,
      F1DB('driver.country_of_birth_country_id'),
      truth.birthCountry.code === 'GB',
    );

  if ((p?.number ?? null) !== truth.permanentNumber)
    add(
      'numero_permanente',
      String(p?.number ?? '—'),
      String(truth.permanentNumber ?? '—'),
      F1DB('driver.permanent_number'),
    );

  // números da carreira
  const counts: [AuditField, number, number, string][] = [
    ['gps', t.races, truth.starts, 'driver.total_race_starts'],
    ['vitorias', t.wins, truth.wins, 'driver.total_race_wins'],
    ['podios', t.podiums, truth.podiums, 'driver.total_podiums'],
    ['poles', t.poles, truth.poles, 'driver.total_pole_positions'],
    ['abandonos', t.dnfs, truth.dnfs, "race_data RACE_RESULT position_text = 'DNF'"],
  ];
  for (const [field, got, want, src] of counts)
    if (got !== want) add(field, String(got), String(want), F1DB(src));
  if (Math.abs(t.points - truth.points) >= 1)
    add(
      'pontos',
      String(t.points),
      String(truth.points),
      F1DB('season_driver_standing.points, por temporada'),
    );
  if (fmtBest(t.best_finish) !== fmtBest(truth.bestFinish))
    add('melhor_resultado', fmtBest(t.best_finish), fmtBest(truth.bestFinish), F1DB('race_data RACE_RESULT'));

  // títulos: quantidade e anos
  if (t.titles !== truth.titles.length || fmtList(career.titles) !== fmtList(truth.titles))
    add(
      'titulos',
      `${t.titles}: ${fmtList(career.titles)}`,
      `${truth.titles.length}: ${fmtList(truth.titles)}`,
      F1DB('season_driver_standing em 1º, temporada encerrada'),
    );

  // temporada selecionada: a atual de quem está no grid, a do heading nas lendas
  const hero = heroOf(career);
  const season = hero.season;
  if (season) {
    const year = season.year;
    const wantNumber = truth.numberBySeason.get(year) ?? null;
    if (wantNumber != null && season.number !== wantNumber)
      add(
        'numero_temporada',
        `${year}: ${season.number ?? '—'}`,
        `${year}: ${wantNumber}`,
        F1DB('race_data.driver_number nas corridas'),
      );

    // a equipe principal do ano: a de mais corridas largadas (empate: qualquer uma delas)
    const wantTeams = truth.teamBySeason.get(year) ?? [];
    const team = season.teams[0];
    const gotTeam = team ? ctx.f1dbConstructorsOf(team.id) : [];
    if (wantTeams.length && !gotTeam.some((c) => wantTeams.includes(c)))
      add(
        'equipe_temporada',
        `${year}: ${team?.name ?? '—'}${gotTeam.length ? ` (${gotTeam.join(', ')})` : ''}`,
        `${year}: ${wantTeams.join(' ou ')}`,
        F1DB('race_data.constructor_id com mais corridas largadas'),
      );

    // cor: a pintura curada daquela época (quando há) e o texto branco legível sobre o fundo do heading
    const curatedTeam = gotTeam.find((c) => wantTeams.includes(c)) ?? wantTeams[0];
    const curated = curatedTeam ? ctx.liveryOf(curatedTeam, year) : null;
    const color = heroColorOf(season);
    if (curated && team?.livery?.primary !== curated.colors[0])
      add(
        'cor_equipe',
        `${year}: ${team?.livery?.primary ?? team?.colors?.primary ?? 'sem pintura'}`,
        `${year}: ${curated.colors[0]}`,
        `liveries.yaml (${curatedTeam})`,
      );
    else if (!curated && curatedTeam)
      add(
        'cor_sem_curadoria',
        `${year}: ${color ?? 'cinza neutro'}`,
        `pintura curada de ${curatedTeam} em ${year}`,
        'liveries.yaml (sem a época)',
        true,
      );
    const behindText = color ? textBackdrop(color) : null;
    if (behindText && contrastWithWhite(behindText) < 4.5)
      add(
        'cor_equipe',
        `${year}: ${color} (texto branco a ${contrastWithWhite(behindText).toFixed(2)}:1)`,
        'texto branco a 4,5:1 ou mais',
        'WCAG 2.2 AA, texto normal',
      );
  }

  // campanha da temporada em andamento: a liderança de hoje não é "terminou em"
  if (career.current_season === ctx.currentYear && ctx.racesLeftInCurrentSeason > 0)
    for (const c of served.competitions)
      if (
        c.season.year === ctx.currentYear &&
        (c.campaign.status === 'finished_league' || !c.campaign.ongoing)
      )
        add(
          'campanha_temporada',
          `${c.season.year}: ${c.campaign.status}${c.campaign.label ? ` (${Object.values(c.campaign.label)[0]})` : ''}`,
          `${c.season.year}: league, em andamento (faltam ${ctx.racesLeftInCurrentSeason} GPs)`,
          F1DB('race: calendário da temporada'),
        );

  // retrato: existe, licença livre e, no grid, recente
  const portrait = career.portrait;
  if (!portrait)
    add('retrato', 'sem retrato', 'retrato da Commons', 'acervo da Commons (assets:commons)', true);
  else if (!OK_LICENSE.test(portrait.credit.license))
    add(
      'retrato',
      portrait.credit.license,
      'CC BY, CC BY-SA, CC0 ou domínio público',
      'regra de licença do acervo',
    );
  else if (career.current_season != null && (portrait.season ?? 0) < career.current_season - 1)
    add(
      'retrato',
      `de ${portrait.season ?? 'ano desconhecido'}`,
      `de ${career.current_season - 1} ou ${career.current_season}`,
      'acervo da Commons',
      true,
    );

  // fundo do heading: existe; sem ele, o motivo
  if (!hero.car) {
    const cars = career.seasons.filter((s) => s.car);
    const reason = coverable(career.highlight?.car)
      ? 'carro de destaque é de outra equipe'
      : career.highlight?.car
        ? 'carro de destaque só em CC BY-SA'
        : cars.some((s) => coverable(s.car))
          ? `há carro livre em ${cars
              .filter((s) => coverable(s.car))
              .map((s) => s.year)
              .join(', ')}, mas de outra equipe`
          : cars.length
            ? 'só há carro em CC BY-SA'
            : 'nenhuma foto de carro no acervo';
    add(
      'fundo_heading',
      `sem foto (${reason})`,
      'carro em CC BY, CC0 ou domínio público',
      'acervo da Commons',
      true,
    );
  }

  // nome: o sobrenome do F1DB e, antes dele, o nome de uso (`name`: "Geoff Lees", não o "Geoffrey" do registro);
  // maiúsculas e pontuação à parte ("de Vries", "Sainz Jr.")
  const wantFirst = truth.name.trim().slice(0, -truth.lastName.length).trim() || truth.firstName;
  const words = (x: string | null | undefined) => norm(x).split(' ').filter(Boolean).join(' ');
  if (p && (words(p.first_name) !== words(wantFirst) || words(p.last_name) !== words(truth.lastName)))
    add(
      'nome',
      `${p.first_name} | ${p.last_name}`,
      `${wantFirst} | ${truth.lastName}`,
      F1DB('driver.name e last_name'),
    );

  return issues;
}
