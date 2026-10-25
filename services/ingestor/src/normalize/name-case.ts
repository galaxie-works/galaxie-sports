/**
 * Partículas de nome em caixa alta vindas do fornecedor ("Vasco DA Gama", "Brasil DE Pelotas"): ficam em
 * minúscula quando não são a primeira palavra e o nome já tem letras minúsculas (nome todo em
 * maiúsculas, sigla ou "DOS Kampen" continuam como vieram).
 */
const PARTICLES = new Set(['DA', 'DAS', 'DE', 'DEL', 'DO', 'DOS', 'DI', 'DU', 'Y']);

export function tidyParticles(name: string): string;
export function tidyParticles(name: string | null | undefined): string | null | undefined;
export function tidyParticles(name: string | null | undefined): string | null | undefined {
  if (!name || !/[a-zà-ÿ]/.test(name)) return name;
  return name
    .split(' ')
    .map((word, i) => (i > 0 && PARTICLES.has(word) ? word.toLowerCase() : word))
    .join(' ');
}
