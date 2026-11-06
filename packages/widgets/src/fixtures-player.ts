// Ficha do jogador de exemplo para a prévia do Builder e os testes: nomes fictícios, sem nenhum jogador,
// clube ou título real (os clubes são os da Liga Exemplo de `fixtures.ts`).
import type { GsPersonOverview } from './core/model.js';

export const PLAYER_IDS = {
  person: '0199a5c0-0000-7000-8000-00000000f001',
} as const;

const AURORA = { id: '0199a5c0-0000-7000-8000-0000000000a1', name: 'Clube Aurora', logo: null };
const SERRA = { id: '0199a5c0-0000-7000-8000-0000000000a3', name: 'Atlético Serra', logo: null };
const VALE = { id: '0199a5c0-0000-7000-8000-0000000000a6', name: 'Sporting Vale', logo: null };

/** Ficha do "camisa 9" de exemplo; `season` escolhe o ano (os anos com jogos estão em `seasons`). */
export function createPlayerFixture(now: Date, season?: number): GsPersonOverview {
  const year = now.getUTCFullYear();
  const seasons = [
    { year, appearances: 24, goals: 14 },
    { year: year - 1, appearances: 31, goals: 17 },
    { year: year - 2, appearances: 28, goals: 9 },
    { year: year - 3, appearances: 19, goals: 6 },
  ];
  const picked = seasons.find((s) => s.year === season) ?? seasons[0]!;
  return {
    person: {
      id: PLAYER_IDS.person,
      name: 'Rafael Tavares',
      birth_date: `${year - 26}-03-14`,
      age: 26,
      nationality: 'Brazil',
      height_cm: 183,
      photo: null,
    },
    nationality_ref: { code: 'BR', name: 'Brasil' },
    role: 'player',
    position: 'Attacker',
    number: 9,
    current_team: AURORA,
    season: picked.year,
    seasons,
    totals: {
      appearances: picked.appearances,
      starts: picked.appearances - 3,
      minutes: picked.appearances * 78,
      goals: picked.goals,
      assists: Math.round(picked.goals / 2),
      yellow_cards: 4,
      red_cards: picked.year === year ? 0 : 1,
      rating: 7.24,
    },
    career: [
      { team: AURORA, from: year - 1, to: year, appearances: 55, goals: 31, current: true },
      { team: SERRA, from: year - 3, to: year - 2, appearances: 47, goals: 15, current: false },
      { team: VALE, from: year - 5, to: year - 4, appearances: 12, goals: 2, current: false },
    ],
    transfers: [
      { date: `${year - 1}-01-10`, type: 'Transfer', from: SERRA, to: AURORA },
      { date: `${year - 3}-07-02`, type: 'Loan', from: VALE, to: SERRA },
    ],
    trophies: [
      { league: 'Liga Exemplo', country: 'Brasil', season: String(year - 1), place: 'Winner' },
      { league: 'Copa Exemplo', country: 'Brasil', season: String(year - 2), place: '2nd Place' },
    ],
  };
}

/** Resposta de exemplo das rotas da pessoa, ou null quando a rota não é dela. */
export function playerPreviewBody(url: URL, now: Date): unknown | null {
  const m = /\/v1\/people\/([^/]+)\/overview\/?$/.exec(url.pathname);
  if (!m || decodeURIComponent(m[1]!) !== PLAYER_IDS.person) return null;
  const season = Number(url.searchParams.get('season')) || undefined;
  return createPlayerFixture(now, season);
}
