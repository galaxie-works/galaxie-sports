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

const CLASS_KEY: Record<string, keyof ImageScores> = {
  Neutral: 'neutral',
  Drawing: 'drawing',
  Sexy: 'sexy',
  Porn: 'porn',
  Hentai: 'hentai',
};

/** Carrega o classificador uma vez por processo; falhou, fica null e tudo vai para a Cosmos. */
function loadClassifier(): Promise<Classify | null> {
  loading ??= (async () => {
    try {
      const tf = await import('@tensorflow/tfjs');
      await import('@tensorflow/tfjs-backend-wasm');
      await tf.setBackend('wasm');
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
      return null;
    }
  })();
  return loading;
}

/** Triagem padrão: decodifica e reduz a imagem (sharp) e passa pelo classificador local. */
export const localImageScreener: ImageScreener = async (image) => {
  const classify = await loadClassifier();
  if (!classify) return null;
  const run = queue.then(async () => {
    const { default: sharp } = await import('sharp');
    const size = SCREEN_LIMITS.inputSize;
    const pixels = await sharp(image, { limitInputPixels: 50_000_000 })
      .rotate()
      .removeAlpha()
      .toColourspace('srgb')
      .resize(size, size, { fit: 'fill' })
      .raw()
      .toBuffer();
    return classify(new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength), size);
  });
  queue = run.catch(() => undefined);
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
