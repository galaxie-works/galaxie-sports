/**
 * Na subida do servidor (Node): prepara o banco de usuários da demo, garante o primeiro admin, começa a
 * seguir o `ops.change_feed`, que revalida o cache da demo quando os dados mudam (lib/cache/follower.ts), e liga a
 * conferência diária do andamento das sugestões (lib/feedback/progress-sync.ts).
 *
 * O que sobe depende do papel (`APP_ROLE`, lib/app-role.ts): o `console` não tem o cache do explorador nem a rota de
 * revalidação, então não segue o change feed. Com `DEMO_METRICS_PORT`, o `/metrics` do processo (lib/ops/metrics.ts).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (process.env.NEXT_PHASE === 'phase-production-build') return;
  const { appRole, serviceName } = await import('./lib/app-role');
  const role = appRole();
  if (role !== 'all') console.log(`[demo] papel do processo: ${role}`);
  const metricsPort = Number(process.env.DEMO_METRICS_PORT);
  if (Number.isInteger(metricsPort) && metricsPort > 0) {
    const { startMetricsServer } = await import('./lib/ops/metrics');
    startMetricsServer({ service: serviceName(role), port: metricsPort });
  }
  // chaves trocadas no painel (#1087): abertas com a SETTINGS_KEK e postas no env do processo, relidas a cada minuto
  try {
    const { refreshPanelSecrets, startPanelSecretsSync } = await import('./lib/ops/panel-secrets');
    await refreshPanelSecrets().catch((err: unknown) =>
      console.warn(
        '[ajustes] chaves do painel indisponíveis na subida; seguindo com o .env',
        err instanceof Error ? err.name : 'erro',
      ),
    );
    startPanelSecretsSync();
  } catch (err) {
    console.error(
      '[ajustes] falha ao subir a releitura das chaves do painel',
      err instanceof Error ? err.name : 'erro',
    );
  }
  const { setupAuthDatabase } = await import('./lib/auth/setup');
  try {
    await setupAuthDatabase();
  } catch (err) {
    console.error('[demo-auth] falha ao preparar o banco de usuários', err);
  }
  if (role === 'console') {
    console.log('[demo-cache] console: sem o seguidor do change feed (o cache do explorador fica no site)');
    return;
  }
  try {
    const { startCacheFeed } = await import('./lib/cache/start');
    startCacheFeed();
  } catch (err) {
    console.error('[demo-cache] falha ao subir o seguidor do change feed', err);
  }
  // conferência diária do andamento das sugestões (avisos na caixa de entrada): uma vez por dia, no site
  try {
    const { startFeedbackProgress } = await import('./lib/feedback/progress-sync');
    startFeedbackProgress();
  } catch (err) {
    console.error('[feedback] falha ao subir a conferência do andamento', err);
  }
}
