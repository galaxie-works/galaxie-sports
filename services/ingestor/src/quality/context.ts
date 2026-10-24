/** Contexto de uma execução: banco, API pública (opcional), F1DB e Wikimedia, com carga única por execução. */
import { createGalaxieClient } from '@galaxie/contracts';
import type { Database } from '@galaxie/db';
import { WikimediaClient } from '../assets/commons/client.js';
import { f1dbTruthFromRelease, type F1dbTruth } from './sources/f1db.js';
import type { QualityContext } from './types.js';

/**
 * API que as regras conferem: `QUALITY_API_URL` + `QUALITY_API_KEY` (no dev, cai em `NEXT_PUBLIC_GALAXIE_API_URL` e
 * `GALAXIE_DEMO_KEY` do .env). Sem as duas, as regras que leem a API saem como `skipped`.
 */
export function qualityApi(env: NodeJS.ProcessEnv) {
  const baseUrl = env.QUALITY_API_URL || env.NEXT_PUBLIC_GALAXIE_API_URL;
  const apiKey = env.QUALITY_API_KEY || env.GALAXIE_DEMO_KEY;
  return baseUrl && apiKey ? createGalaxieClient({ baseUrl, apiKey, locale: 'pt-BR' }) : null;
}

export function createQualityContext(
  db: Database,
  options: {
    env?: NodeJS.ProcessEnv;
    now?: Date;
    log?: (msg: string) => void;
    f1db?: () => Promise<F1dbTruth>;
  } = {},
): QualityContext {
  const env = options.env ?? process.env;
  const now = options.now ?? new Date();
  const log = options.log ?? (() => {});
  const cache = new Map<string, Promise<unknown>>();
  const memo = <T>(key: string, load: () => Promise<T>): Promise<T> => {
    let p = cache.get(key) as Promise<T> | undefined;
    if (!p) {
      p = load();
      cache.set(key, p);
      // erro não fica em cache: a próxima regra tenta de novo
      p.catch(() => cache.delete(key));
    }
    return p;
  };
  return {
    db,
    now,
    env,
    api: qualityApi(env),
    f1db: () => memo('f1db', options.f1db ?? (() => f1dbTruthFromRelease(now, log))),
    wikimedia: new WikimediaClient({ log }),
    memo,
    log,
  };
}
