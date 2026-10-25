/**
 * Perfil dos pilotos da F1: o nível de cada um (o que o perfil editorial traz) e os vocabulários fixos do perfil
 * (`formula-1/editorial/<locale>.yaml`). Puro: quem chama calcula as entradas do F1DB (core).
 *
 * Nível (docs/runbooks/f1-perfil-editorial.md):
 * - `legend` (lenda, o escopo `lendas` do acervo de fotos): campeão mundial, ou entre os 20 primeiros da história em
 *   vitórias ou em GPs disputados (posição de competição: empatado com o 20º também entra). Perfil editorial
 *   completo: bio, estilo, pontos fortes, momentos marcantes e rivalidades.
 * - `regular`: venceu ao menos um GP ou disputou 3 temporadas ou mais. Bio curta e os traços calculados.
 * - `basic`: os demais. Só os traços calculados (nada de IA).
 */

export const DRIVER_TIERS = ['legend', 'regular', 'basic'] as const;
export type DriverTier = (typeof DRIVER_TIERS)[number];

/** Corte das lendas por vitórias e por GPs (o mesmo `--limite 20` do escopo `lendas` das fotos). */
export const LEGEND_TOP = 20;
/** Temporadas com largada para o piloto sem vitória ser `regular`. */
export const REGULAR_MIN_SEASONS = 3;

export interface DriverTierInput {
  /** Títulos mundiais (temporadas encerradas em 1º). */
  titles: number;
  wins: number;
  /** Temporadas com ao menos uma largada. */
  seasons: number;
  /** Posição de competição na história: 1 + pilotos com mais vitórias / mais GPs. */
  winsRank: number | null;
  startsRank: number | null;
}

export function driverTier(d: DriverTierInput): DriverTier {
  const top = (rank: number | null) => rank != null && rank <= LEGEND_TOP;
  if (d.titles > 0 || (d.wins > 0 && top(d.winsRank)) || top(d.startsRank)) return 'legend';
  if (d.wins > 0 || d.seasons >= REGULAR_MIN_SEASONS) return 'regular';
  return 'basic';
}

/** Idiomas do perfil editorial: o original (pt-BR) e o espanhol neutro (docs/06 §3.3). */
export const EDITORIAL_LOCALES = ['pt-BR', 'es'] as const;
export type EditorialLocale = (typeof EDITORIAL_LOCALES)[number];

/**
 * As 10 lendas da F1 (id do F1DB), na ordem do carrossel "Legendary" e do perfil editorial completo. Escolha
 * editorial por relevância histórica (quem qualquer pessoa cita ao falar das lendas da F1), não pelos números:
 * o critério automático (`driverTier`) traz quase 50 pilotos.
 */
export const F1_LEGENDS = [
  'ayrton-senna',
  'michael-schumacher',
  'lewis-hamilton',
  'juan-manuel-fangio',
  'alain-prost',
  'niki-lauda',
  'nelson-piquet',
  'jim-clark',
  'fernando-alonso',
  'max-verstappen',
] as const;

/** Modo de pilotagem (o texto curto do estilo diz o resto). */
export const DRIVING_STYLES = [
  'aggressive',
  'smooth',
  'calculating',
  'precise',
  'instinctive',
  'complete',
  'consistent',
] as const;
export type DrivingStyle = (typeof DRIVING_STYLES)[number];

/** Pontos fortes reconhecidos (perspicácia = `race_intelligence`; controle do carro = `car_control`). */
export const DRIVER_STRENGTHS = [
  'qualifying',
  'wet_weather',
  'overtaking',
  'defending',
  'starts',
  'tyre_management',
  'car_control',
  'race_intelligence',
  'consistency',
  'technical_feedback',
  'street_circuits',
  'high_speed',
] as const;
export type DriverStrength = (typeof DRIVER_STRENGTHS)[number];

/** Slug do perfil do piloto a partir do id do F1DB (o mesmo de `participants/drivers.yaml`). */
export const driverSlug = (f1dbId: string) => `f1-${f1dbId}`;
