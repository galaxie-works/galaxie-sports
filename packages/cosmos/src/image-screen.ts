/**
 * Triagem local da imagem, antes da Cosmos (#1025, decisão do Wagner em 13/11): um classificador aberto, que roda no
 * nosso servidor, sem custo e sem a imagem sair daqui, separa o que é claro do que precisa da IA.
 *
 * - Nu ou sexo explícito claro: a imagem fica segurada e vai para a fila humana, sem passar pela IA.
 * - Imagem comum clara (sem nada sexual): libera sem passar pela IA, só fora do destino infantil.
 * - O resto (faixa de dúvida) vai para a Cosmos, como antes.
 *
 * O classificador só enxerga nudez e conteúdo sexual. Droga, arma e símbolo de ódio ele não vê: por isso, no destino
 * infantil, toda imagem que ele não segurou também passa pela Cosmos. No destino adulto, isso fica para a denúncia.
 * Se o classificador não carregar, tudo vai para a Cosmos (o comportamento de antes).
 *
 * Aqui ficam só as regras (sem dependência pesada). O classificador está em `@galaxie/cosmos/image-screen-local`, que
 * só o servidor da API carrega e passa em `screen` para o `moderateImage`.
 */

/** Notas do classificador, de 0 a 1, somando 1. */
export interface ImageScores {
  /** Foto ou desenho comum. */
  neutral: number;
  drawing: number;
  /** Sugestivo, sem nudez explícita (biquíni, sunga, roupa íntima). */
  sexy: number;
  /** Nudez ou sexo explícito (foto ou desenho). */
  porn: number;
  hentai: number;
}

/** Lê a imagem já conferida (JPEG, PNG ou WebP) e devolve as notas; null quando não conseguiu ler. */
export type ImageScreener = (image: Uint8Array) => Promise<ImageScores | null>;

export type ScreenOutcome = 'held' | 'clear' | 'doubt';

/** Limites da triagem. Fora daqui, nada; ajustar é mudar estes números. */
export const SCREEN_LIMITS = {
  /** Nudez ou sexo explícito a partir desta nota: segura sem a IA. */
  holdExplicit: 0.85,
  /** Imagem comum: foto ou desenho com pelo menos esta nota... */
  clearNeutral: 0.9,
  /** ...e explícito abaixo desta... */
  clearExplicit: 0.03,
  /** ...e sugestivo abaixo desta. */
  clearSexy: 0.05,
  /** Lado do quadrado que o classificador lê. */
  inputSize: 224,
  /** Tempo máximo da triagem de uma imagem, contando a espera na fila; passou, vai para a Cosmos. */
  timeoutMs: 5_000,
  /** Imagens na fila da triagem; acima disso, a nova vai direto para a Cosmos. */
  maxQueue: 8,
  /** Espera antes de tentar carregar de novo o classificador que falhou. */
  retryLoadMs: 600_000,
} as const;

/** O que fazer com as notas. `strict` (destino infantil): a imagem comum também vai para a Cosmos. */
export function screenOutcome(scores: ImageScores, strict: boolean): ScreenOutcome {
  const explicit = scores.porn + scores.hentai;
  if (explicit >= SCREEN_LIMITS.holdExplicit) return 'held';
  if (strict) return 'doubt';
  const neutral = scores.neutral + scores.drawing;
  if (
    neutral >= SCREEN_LIMITS.clearNeutral &&
    explicit < SCREEN_LIMITS.clearExplicit &&
    scores.sexy < SCREEN_LIMITS.clearSexy
  )
    return 'clear';
  return 'doubt';
}
