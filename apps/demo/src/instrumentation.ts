/** Na subida do servidor (Node): prepara o banco de usuários da demo e garante o primeiro admin. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (process.env.NEXT_PHASE === 'phase-production-build') return;
  const { setupAuthDatabase } = await import('./lib/auth/setup');
  try {
    await setupAuthDatabase();
  } catch (err) {
    console.error('[demo-auth] falha ao preparar o banco de usuários', err);
  }
}
