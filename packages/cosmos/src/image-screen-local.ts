/**
 * Classificador local da triagem de imagem (#1025): modelo aberto de nudez (MobileNetV2), em WebAssembly, no próprio
 * processo. Fica fora da raiz do pacote para quem só usa as regras (a demo) não carregar o modelo. Ver
 * `image-screen.ts`.
 */
import { SCREEN_LIMITS, type ImageScores, type ImageScreener } from './image-screen.js';

type Classify = (pixels: Uint8Array, size: number) => Promise<ImageScores>;

let loading: Promise<Classify | null> | null = null;
/** Uma imagem por vez: o classificador é pesado em CPU e as outras esperam na fila daqui. */
let queue: Promise<unknown> = Promise.resolve();
/** Imagens na fila ou rodando. */
let pending = 0;

const CLASS_KEY: Record<string, keyof ImageScores> = {
  Neutral: 'neutral',
  Drawing: 'drawing',
  Sexy: 'sexy',
  Porn: 'porn',
  Hentai: 'hentai',
};

/**
 * Carrega o classificador uma vez por processo. Falhou: as imagens vão para a Cosmos e a carga tenta de novo depois de
 * `retryLoadMs` (uma falha passageira na subida não desliga a triagem até reiniciar).
 */
function loadClassifier(): Promise<Classify | null> {
  loading ??= (async () => {
    try {
      const tf = await import('@tensorflow/tfjs');
      await import('@tensorflow/tfjs-backend-wasm');
      // sem o WebAssembly, o tfjs cai calado no JS puro, dez vezes mais lento: melhor mandar tudo para a Cosmos
      if (!(await tf.setBackend('wasm'))) throw new Error('backend wasm indisponível');
      await tf.ready();
      const { load } = await import('nsfwjs/core');
      const { MobileNetV2Model } = await import('nsfwjs/models/mobilenet_v2');
      const model = await load('MobileNetV2', { modelDefinitions: [MobileNetV2Model] });
      return async (pixels, size) => {
        const input = tf.tensor3d(pixels, [size, size, 3], 'int32');
        try {
          const out = await model.classify(input, 5);
          const scores: ImageScores = { neutral: 0, drawing: 0, sexy: 0, porn: 0, hentai: 0 };
          for (const p of out) {
            const key = CLASS_KEY[p.className];
            if (key) scores[key] = p.probability;
          }
          return scores;
        } finally {
          input.dispose();
        }
      };
    } catch (err) {
      console.error('[cosmos] triagem local de imagem não carregou; as imagens vão para a Cosmos', err);
      setTimeout(() => (loading = null), SCREEN_LIMITS.retryLoadMs).unref();
      return null;
    }
  })();
  return loading;
}

async function pixelsOf(image: Uint8Array, size: number): Promise<Uint8Array | null> {
  const { default: sharp } = await import('sharp');
  const opts = { limitInputPixels: 50_000_000 };
  // animação: a triagem só veria o primeiro quadro; a Cosmos decide
  if (((await sharp(image, opts).metadata()).pages ?? 1) > 1) return null;
  const raw = await sharp(image, opts)
    .rotate()
    .removeAlpha()
    .toColourspace('srgb')
    .resize(size, size, { fit: 'fill' })
    .raw()
    .toBuffer();
  return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
}

/**
 * Triagem padrão: decodifica e reduz a imagem (sharp) e passa pelo classificador local. Com a fila cheia, ou quando a
 * vez chega depois do prazo de quem pediu, devolve null na hora (a imagem vai para a Cosmos) em vez de acumular
 * trabalho que ninguém mais espera.
 */
export const localImageScreener: ImageScreener = async (image) => {
  if (pending >= SCREEN_LIMITS.maxQueue) return null;
  // a vaga é tomada antes de qualquer espera, senão uma rajada passa toda pela conferência
  pending++;
  const deadline = Date.now() + SCREEN_LIMITS.timeoutMs;
  const classify = await loadClassifier();
  if (!classify) {
    pending--;
    return null;
  }
  const run = queue.then(async () => {
    if (Date.now() >= deadline) return null;
    const size = SCREEN_LIMITS.inputSize;
    const pixels = await pixelsOf(image, size);
    return pixels ? classify(pixels, size) : null;
  });
  const done = run.catch(() => null).finally(() => pending--);
  queue = done;
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      run,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), SCREEN_LIMITS.timeoutMs);
      }),
    ]);
  } catch (err) {
    console.error('[cosmos] triagem local não leu a imagem; vai para a Cosmos', err);
    return null;
  } finally {
    clearTimeout(timer);
  }
};
