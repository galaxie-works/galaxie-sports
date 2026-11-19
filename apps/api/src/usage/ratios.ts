/** A partir de quanto da cota diária a resposta avisa (`x-galaxie-quota-warning`). */
export const QUOTA_WARN_RATIO = 0.8;
/** A partir de quanto da cota diária a API recusa (429 QUOTA_EXCEEDED): 10% de folga. */
export const QUOTA_BLOCK_RATIO = 1.1;
/**
 * Teto da chave publicável (widgets, #1137): até aqui o excesso passa e conta como excedente; acima, 429. A chave é
 * pública, e sem teto quem a tivesse geraria excedente sem limite. Três vezes a cota cobre um pico de audiência.
 */
export const QUOTA_PUBLISHABLE_CEILING_RATIO = 3;
