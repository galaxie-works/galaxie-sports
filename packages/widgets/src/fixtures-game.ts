// Dados de exemplo da estante de Conquistas e do Ranking (#919): um torcedor fictício com algumas Conquistas, o
// Catálogo de exemplo e o Ranking do mês. Só para a prévia do Builder e os testes (nada de marca real).

import type {
  GsAchievementCatalogEntry,
  GsAchievementEarners,
  GsFanAchievement,
  GsFanMe,
  GsMyRanking,
  GsRanking,
} from './core/model.js';

const PROFILE = '00000000-0000-7000-8000-00000000fa01';

function b64url(s: string): string {
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Token de exemplo para a prévia: tem o formato `gft_` (corpo com tenant, Perfil e validade longa), mas não vale
 * na API; só a prévia com `createPreviewFetch` responde a ele.
 */
export const PREVIEW_FAN_TOKEN = `gft_${b64url(
  JSON.stringify({ t: 'preview', p: PROFILE, exp: 4_102_444_800 }),
)}.preview`;

export const PREVIEW_FAN: GsFanMe = {
  profile_id: PROFILE,
  nickname: 'Torcedor_Exemplo',
  avatar_url: null,
  age_band: '18plus',
  country: 'BR',
  locale: 'pt-BR',
  capabilities: ['read', 'predict', 'write', 'redeem'],
  age_status: 'can_write',
};

const steps = (thresholds: number[], card = true) =>
  thresholds.map((threshold, i) => ({ step: i + 1, threshold, card_key: card ? `preview.${i + 1}` : null }));

export const PREVIEW_ACHIEVEMENT_CATALOG: GsAchievementCatalogEntry[] = [
  {
    id: 'loyalty.watched',
    sport: null,
    category: 'participation',
    family: 'loyalty',
    stepped: true,
    seasonal: true,
    name: { pt: 'Fiel', es: 'Fiel', en: 'Faithful' },
    description: {
      pt: 'Acompanhe os jogos do seu time do começo ao fim.',
      es: 'Sigue los partidos de tu equipo de principio a fin.',
      en: "Follow your team's games from start to finish.",
    },
    steps: steps([1, 5, 15, 38, 100]),
  },
  {
    id: 'predictions.correct',
    sport: null,
    category: 'hit',
    family: 'predictions',
    stepped: true,
    seasonal: true,
    name: { pt: 'Palpiteiro', es: 'Pronosticador', en: 'Forecaster' },
    description: {
      pt: 'Acerte o resultado dos jogos.',
      es: 'Acierta el resultado de los partidos.',
      en: 'Get game results right.',
    },
    steps: steps([3, 10, 30, 80, 200]),
  },
  {
    id: 'predictions.exact_score',
    sport: null,
    category: 'hit',
    family: 'predictions',
    stepped: true,
    seasonal: false,
    name: { pt: 'Na mosca', es: 'En el blanco', en: 'Bullseye' },
    description: {
      pt: 'Acerte o placar exato.',
      es: 'Acierta el marcador exacto.',
      en: 'Get the exact score right.',
    },
    steps: steps([1, 3, 8, 20, 50]),
  },
  {
    id: 'football.moments.stoppage_time_goal',
    sport: 'football',
    category: 'moment',
    family: 'moments',
    stepped: false,
    seasonal: false,
    name: { pt: 'Gol nos acréscimos', es: 'Gol en el descuento', en: 'Stoppage-time goal' },
    description: {
      pt: 'Esteja no jogo quando o seu time marcar nos acréscimos.',
      es: 'Está en el partido cuando tu equipo marque en el descuento.',
      en: 'Be watching when your team scores in stoppage time.',
    },
    steps: steps([1]),
  },
  {
    id: 'explorer.competitions',
    sport: null,
    category: 'participation',
    family: 'explorer',
    stepped: true,
    seasonal: false,
    name: { pt: 'Explorador', es: 'Explorador', en: 'Explorer' },
    description: {
      pt: 'Acompanhe jogos de campeonatos diferentes.',
      es: 'Sigue partidos de torneos diferentes.',
      en: 'Follow games from different competitions.',
    },
    steps: steps([2, 4, 7, 10, 18], false),
  },
];

export const PREVIEW_FAN_ACHIEVEMENTS: GsFanAchievement[] = [
  { achievement_id: 'loyalty.watched', season: 'all', count: 21, steps: 3, next_threshold: 38, rarity: 0.18 },
  {
    achievement_id: 'loyalty.watched',
    season: '2026',
    count: 12,
    steps: 2,
    next_threshold: 15,
    rarity: 0.22,
  },
  {
    achievement_id: 'predictions.correct',
    season: 'all',
    count: 7,
    steps: 1,
    next_threshold: 10,
    rarity: 0.41,
  },
  {
    achievement_id: 'predictions.correct',
    season: '2026',
    count: 7,
    steps: 1,
    next_threshold: 10,
    rarity: 0.41,
  },
  {
    achievement_id: 'football.moments.stoppage_time_goal',
    season: 'all',
    count: 1,
    steps: 1,
    next_threshold: null,
    rarity: 0.03,
  },
  {
    achievement_id: 'explorer.competitions',
    season: 'all',
    count: 1,
    steps: 0,
    next_threshold: 2,
    rarity: null,
  },
];

const NAMES = [
  'Ana_FC',
  'Joao10',
  'Tricolor_77',
  'Bia.gol',
  'Rafa_Craque',
  'Lu_Torcida',
  'Pedro_9',
  'Mari_Fiel',
];

export function previewRanking(period: string, limit: number): GsRanking {
  const entries = NAMES.map((nickname, i) => ({
    position: i + 1,
    profile_id: `00000000-0000-7000-8000-0000000fb0${String(i + 10)}`,
    nickname,
    points: 1_480 - i * 115,
    full_hits: 9 - i,
  }));
  return { period, program_country: 'BR', entries: entries.slice(0, limit) };
}

export function previewMyRanking(period: string): GsMyRanking {
  return { period, program_country: 'BR', position: 23, points: 410, full_hits: 2 };
}

export function previewEarners(achievementId: string, season: string): GsAchievementEarners {
  return {
    achievement_id: achievementId,
    season,
    total: 1_284,
    earners: NAMES.slice(0, 5).map((nickname, i) => ({
      profile_id: `00000000-0000-7000-8000-0000000fb0${String(i + 10)}`,
      nickname,
      avatar_url: null,
      step: Math.max(1, 5 - i),
    })),
  };
}

/** Respostas da prévia para as rotas da Gamificação (null = não é rota daqui). */
export function gamePreviewBody(url: URL): unknown {
  const path = url.pathname.replace(/\/+$/, '');
  if (path.endsWith('/v1/fans/me')) return { data: PREVIEW_FAN };
  if (path.endsWith('/v1/fans/me/achievements'))
    return { data: { program_country: 'BR', achievements: PREVIEW_FAN_ACHIEVEMENTS } };
  if (path.endsWith('/v1/achievements')) {
    const sport = url.searchParams.get('sport');
    const list = PREVIEW_ACHIEVEMENT_CATALOG.filter((a) => !sport || a.sport === null || a.sport === sport);
    return { data: { program_country: 'BR', achievements: list } };
  }
  const earners = /\/v1\/achievements\/([^/]+)\/earners$/.exec(path);
  if (earners)
    return { data: previewEarners(decodeURIComponent(earners[1]!), url.searchParams.get('season') ?? 'all') };
  const me = /\/v1\/rankings\/([^/]+)\/me$/.exec(path);
  if (me) return { data: previewMyRanking(decodeURIComponent(me[1]!)) };
  const ranking = /\/v1\/rankings\/([^/]+)$/.exec(path);
  if (ranking)
    return {
      data: previewRanking(decodeURIComponent(ranking[1]!), Number(url.searchParams.get('limit')) || 10),
    };
  return null;
}
