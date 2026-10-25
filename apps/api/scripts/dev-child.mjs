/**
 * Pré-carregado (`--import`) no tsc e no servidor que o `scripts/dev.mjs` sobe: se o dev morrer à força
 * (kill -9, terminal fechado), o canal IPC cai e o filho sai junto, sem deixar o servidor segurando a porta.
 */
process.channel?.unref();
process.once('disconnect', () => process.kill(process.pid, 'SIGTERM'));
