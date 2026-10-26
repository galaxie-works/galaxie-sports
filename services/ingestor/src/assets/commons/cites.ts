/**
 * Quem a foto cita: o título do arquivo ou a categoria de onde veio fala do piloto? Usado na descoberta (foto do
 * carro com o piloto do destaque, foto que cita outro piloto) e na importação (o fundo de cada piloto). Puro.
 */

/** Texto comparável: sem acento, minúsculo, pontuação e `_` viram espaço ("Pérez_Monaco" → "perez monaco"). */
export const plainWords = (v: string) =>
  v
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** A frase aparece no texto como palavras inteiras ("hill" não casa com "hillclimb"). */
export const hasWords = (text: string, phrase: string) => {
  const p = plainWords(phrase);
  return !!p && ` ${plainWords(text)} `.includes(` ${p} `);
};

/** O sobrenome também é o nome do carro (Brabham no Brabham BT33, McLaren no McLaren M14A, Surtees no TS9)? */
export const surnameIsCar = (surname: string, carNames: readonly string[]) =>
  carNames.some((n) => hasWords(n, surname));

/**
 * O texto cita o piloto: o sobrenome como palavra inteira. Quando o sobrenome também é o nome do carro (Jack
 * Brabham no "1971 Brabham BT33"), só o nome inteiro (ou o possessivo) vale: senão toda foto do carro citaria o
 * piloto-construtor.
 */
export function citesDriver(
  text: string,
  driver: { name: string; surname: string },
  carNames: readonly string[],
): boolean {
  if (surnameIsCar(driver.surname, carNames))
    // "Brabham's Brabham-Ford BT33": o possessivo também é o piloto
    return hasWords(text, driver.name) || hasWords(text, `${driver.surname}'s`);
  return hasWords(text, driver.surname);
}
