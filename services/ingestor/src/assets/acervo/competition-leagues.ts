/**
 * Logo de competição da base por país ("<País>/Campeonatos/<Competição>") → liga da api-sports. O nome
 * da pasta é o de mercado ("Campeonato Brasileiro Série A", "MLS - Major League Soccer"), que nem sempre
 * se parece com o do cadastro ("Serie A", "Major League Soccer"). O planejador só usa a liga quando ela
 * existe no banco, é do mesmo país e os nomes têm uma palavra com o mesmo começo; fora da tabela, casa
 * pelo nome. Chave: "<país> <competição>" normalizado (normalizeName).
 */
import { normalizeName } from '@galaxie/knowledge';

const TABLE: Record<string, Record<string, number>> = {
  Alemanha: { Bundesliga: 78, '2. Bundesliga': 79, '3. Liga': 80 },
  Argentina: { 'Argentina Primera Division': 128, 'Primera Nacional': 129 },
  'Arábia Saudita': { 'Saudi Professional League': 307 },
  Austrália: { 'A-League': 188 },
  Áustria: { 'Austrian Football Bundesliga': 218, '2. Liga': 219 },
  Bélgica: { 'Jupiler Pro League': 144, 'Challenger Pro League': 145 },
  Bolívia: { 'Primera División de Bolivia': 344 },
  Brasil: {
    'Campeonato Brasileiro Série A': 71,
    'Campeonato Brasileiro Série B': 72,
    'Campeonato Brasileiro Série C': 75,
    'Campeonato Brasileiro Série D': 76,
  },
  Chile: { 'Liga de Primera': 265 },
  China: { 'Chinese Super League': 169 },
  Colômbia: { 'Categoria Primera A': 239 },
  'Coreia do Sul': { 'K League 1': 292, 'K League 2': 293 },
  Dinamarca: { 'Danish Super League': 119 },
  Equador: { 'Liga Pro Serie A': 242 },
  Escócia: {
    'Scottish Premiership': 179,
    'Scottish Championship': 180,
    'Scottish League One': 183,
    'Scottish League Two': 184,
  },
  Espanha: { 'La Liga': 140, 'La Liga 2': 141 },
  'Estados Unidos': { 'MLS - Major League Soccer': 253, 'USL Championship': 255 },
  França: { 'Ligue 1': 61, 'Ligue 2': 62, 'National 1': 63 },
  Grécia: { 'Super League 1': 197 },
  Inglaterra: {
    'Premier League': 39,
    'EFL Championship': 40,
    'EFL League One': 41,
    'EFL League Two': 42,
    'National League': 43,
  },
  Itália: { 'Serie A': 135, 'Serie B': 136, 'Serie C': 138 },
  Japão: { 'J1 League': 98, 'J2 League': 99 },
  México: { 'Liga MX': 262, 'Liga de Expansión MX': 263 },
  Noruega: { Eliteserien: 103 },
  'Países Baixos': { Eredivisie: 88, 'Eerste Divisie': 89 },
  Peru: { 'Peruvian Primera División': 281 },
  Polônia: { 'PKO BP Ekstraklasa': 106 },
  Portugal: { 'Primeira Liga': 94, 'Liga Portugal 2': 95 },
  Romênia: { Superliga: 283 },
  Rússia: { 'Russian Premier League': 235 },
  Suécia: { Allsvenskan: 113, Superettan: 114 },
  Suíça: { 'Swiss Super League': 207, 'Swiss Challenge League': 208 },
  Turquia: { 'Super Lig': 203, '1. Lig': 204 },
  Uruguai: { 'Liga AUF Uruguaya': 268 },
  Venezuela: { 'Primera División de Venezuela': 299 },
};

export const COMPETITION_LEAGUES: ReadonlyMap<string, number> = new Map(
  Object.entries(TABLE).flatMap(([country, comps]) =>
    Object.entries(comps).map(([name, league]) => [normalizeName(`${country} ${name}`), league] as const),
  ),
);
