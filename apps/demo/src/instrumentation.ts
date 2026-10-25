/**
 * Na subida do servidor (Node): prepara o banco de usuários da demo, garante o primeiro admin e começa a
 * seguir o `ops.change_feed`, que revalida o cache da demo quando os dados mudam (lib/cache/follower.ts).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (process.env.NEXT_PHASE === 'phase-production-build') return;
  const { setupAuthDatabase } = await import('./lib/auth/setup');
  try {
    await setupAuthDatabase();
  } catch (err) {
    console.error('[demo-auth] falha ao preparar o banco de usuários', err);
  }
  try {
    const { startCacheFeed } = await import('./lib/cache/start');
    startCacheFeed();
  } catch (err) {
    console.error('[demo-cache] falha ao subir o seguidor do change feed', err);
  }
}
