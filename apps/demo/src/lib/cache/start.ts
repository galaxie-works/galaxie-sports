/**
 * Sobe o seguidor do change feed na partida do servidor (instrumentation.ts, só no runtime Node). Um por
 * processo: o global evita um segundo seguidor quando o `next dev` recarrega módulos. `DEMO_CACHE_FEED=off`
 * desliga (o cache volta a depender só do `cacheLife`).
 */
import { createDb } from '@galaxie/db/client';

import { pgFeedStore } from './feed-store';
import { ChangeFeedFollower } from './follower';
import { internalBaseUrl, revalidateOverHttp } from './revalidate-client';
import { revalidateSecret } from './signature';

declare global {
  var __galaxieCacheFeed: ChangeFeedFollower | undefined;
}

const logger = {
  info: (msg: string, data?: object) => console.log(`[demo-cache] ${msg}`, data ?? ''),
  warn: (msg: string, data?: object) => console.warn(`[demo-cache] ${msg}`, data ?? ''),
};

export function startCacheFeed(): ChangeFeedFollower | undefined {
  if (globalThis.__galaxieCacheFeed) return globalThis.__galaxieCacheFeed;
  if (process.env.DEMO_CACHE_FEED === 'off') {
    logger.info('seguidor do change feed desligado (DEMO_CACHE_FEED=off)');
    return undefined;
  }
  const url = process.env.DEMO_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    console.warn('[demo-cache] sem DEMO_DATABASE_URL/DATABASE_URL: o cache só expira pelo cacheLife');
    return undefined;
  }
  const follower = new ChangeFeedFollower(
    pgFeedStore(createDb(url, { max: 2 })),
    revalidateOverHttp({ baseUrl: internalBaseUrl(), secret: revalidateSecret }),
    { logger },
  );
  globalThis.__galaxieCacheFeed = follower;
  void follower.start();
  return follower;
}
