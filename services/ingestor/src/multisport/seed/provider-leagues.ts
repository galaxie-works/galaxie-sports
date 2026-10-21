/**
 * Ligas da api-sports que correspondem aos torneios dos Jogos (ganchos para o #78).
 * IDs de futebol conferidos no catálogo local (core.provider_map); demais esportes vêm do snapshot de /leagues
 * documentado em docs/research/api-sports-outros-esportes.md e só são ligados quando o catálogo do esporte existir.
 */

export interface ProviderLeagueSeed {
  gamesType: 'OG' | 'PAN';
  gamesSeason: 'summer' | 'winter';
  sport: string;
  gender: 'M' | 'W' | 'O';
  providerLeagueId: string;
  label: string;
  notes?: string;
}

const s = (
  gamesType: 'OG' | 'PAN',
  sport: string,
  gender: 'M' | 'W' | 'O',
  providerLeagueId: number,
  label: string,
  notes?: string,
  gamesSeason: 'summer' | 'winter' = 'summer',
): ProviderLeagueSeed => ({
  gamesType,
  gamesSeason,
  sport,
  gender,
  providerLeagueId: String(providerLeagueId),
  label,
  ...(notes ? { notes } : {}),
});

export const PROVIDER_LEAGUE_SEED: ProviderLeagueSeed[] = [
  s('OG', 'football', 'M', 480, 'Olympics Men'),
  s('OG', 'football', 'W', 524, 'Olympics Women'),
  s(
    'PAN',
    'football',
    'O',
    1045,
    'Pan American Games',
    'ID único no catálogo; confirmar se masculino e feminino compartilham a liga.',
  ),
  s('OG', 'basketball', 'M', 192, 'Olympic Games'),
  s('OG', 'basketball', 'W', 193, 'Olympic Games Women'),
  s('PAN', 'basketball', 'M', 286, 'Pan American Games'),
  s('PAN', 'basketball', 'W', 294, 'Pan American Games Women'),
  s(
    'OG',
    'volleyball',
    'M',
    189,
    'Olympic Games',
    'Temporada "2023" suspeita (Paris 2024?): ligação por datas.',
  ),
  s('OG', 'volleyball', 'W', 190, 'Olympic Games Women', 'Temporada "2023" suspeita: ligação por datas.'),
  s('PAN', 'volleyball', 'M', 195, 'Pan American Games'),
  s('PAN', 'volleyball', 'W', 213, 'Pan American Games Women'),
  s(
    'OG',
    'handball',
    'M',
    155,
    'Olympic Games',
    'Temporada "2023" suspeita para Paris 2024: ligação por datas.',
  ),
  s('OG', 'handball', 'W', 156, 'Olympic Games Women'),
  s('PAN', 'handball', 'M', 170, 'Pan American Games'),
  s('PAN', 'handball', 'W', 169, 'Pan American Games Women'),
  s('OG', 'rugby', 'M', 74, "Olympic Games 7's"),
  s('OG', 'rugby', 'W', 75, "Olympic Games 7's Women"),
  s('PAN', 'rugby', 'M', 107, "Pan American Games 7's"),
  s('PAN', 'rugby', 'W', 108, "Pan American Games 7's Women"),
  s('OG', 'baseball', 'O', 47, 'Olympic Games'),
  s('PAN', 'baseball', 'O', 41, 'Pan American Games'),
  s('OG', 'hockey', 'M', 131, 'Olympic Games', undefined, 'winter'),
  s('OG', 'hockey', 'W', 151, 'Olympic Games Women', undefined, 'winter'),
];
