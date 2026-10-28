#!/usr/bin/env node
// Healthcheck com auto-reinício, para as imagens Node do Galaxie Sports (API, demo, ingestor/agentes).
//
//   node selfheal.mjs http <url>              # 2xx = saudável
//   node selfheal.mjs heartbeat <arquivo> <ms> # arquivo tocado há menos de <ms> = saudável
//
// O Docker só marca o contêiner como unhealthy; sem Swarm, ninguém reinicia. Este script conta as falhas
// seguidas e, passado o limite, encerra o processo principal (filho do tini, PID 1): o contêiner sai e a
// política `restart: unless-stopped` sobe outro. Sem socket do Docker e sem contêiner extra.
//
// Só confere a vivacidade do próprio processo: dependência fora (Postgres, Valkey, API para a demo) não deve
// estar no comando, senão uma queda do banco vira laço de reinícios. Só age sobre um processo que já passou
// no healthcheck alguma vez: a mesma imagem roda a migration e jobs avulsos (`docker compose run ... node
// dist/cli/...`), que nunca respondem ao healthcheck e não podem ser encerrados no meio. E há trava:
//   SELFHEAL_AFTER        falhas seguidas antes de agir (padrão 6: ~1,5 min com intervalo de 15 s)
//   SELFHEAL_GRACE_S      idade mínima do processo para agir (padrão 120 s; cobre a subida lenta)
//   SELFHEAL_MAX_RESTARTS reinícios por janela; passou disso, só sinaliza unhealthy (padrão 3)
//   SELFHEAL_WINDOW_S     janela da trava (padrão 1800 s)
//   SELFHEAL=off          só sinaliza, nunca encerra
//   HEALTH_STATE_DIR      onde guardar a contagem (padrão /tmp; sobrevive ao restart do mesmo contêiner)
// Primeiro SIGTERM (encerramento normal); se o processo seguir vivo 20 s depois, SIGKILL na falha seguinte.
import { appendFileSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const env = process.env;
const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
const AFTER = num(env.SELFHEAL_AFTER, 6);
const GRACE_S = num(env.SELFHEAL_GRACE_S, 120);
const MAX_RESTARTS = num(env.SELFHEAL_MAX_RESTARTS, 3);
const WINDOW_S = num(env.SELFHEAL_WINDOW_S, 1800);
const DIR = env.HEALTH_STATE_DIR || '/tmp';
const STATE = join(DIR, 'selfheal.json');
const LOG = join(DIR, 'selfheal.log');

async function healthy([mode, target, maxAge]) {
  if (mode === 'http') {
    const res = await fetch(target, { signal: AbortSignal.timeout(4_000) });
    return res.ok;
  }
  if (mode === 'heartbeat') return Date.now() - statSync(target).mtimeMs < num(maxAge, 120_000);
  throw new Error(`modo desconhecido: ${mode}`);
}

const readState = () => {
  try {
    return JSON.parse(readFileSync(STATE, 'utf8'));
  } catch {
    return { proc: '', seenOk: false, fails: 0, restarts: [], term: null };
  }
};

/** Processo principal: o filho do PID 1 (tini) que não é este healthcheck. */
function mainPid() {
  for (const d of readdirSync('/proc')) {
    if (!/^\d+$/.test(d) || Number(d) === process.pid || d === '1') continue;
    try {
      const stat = readFileSync(`/proc/${d}/stat`, 'utf8');
      const ppid = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
      if (ppid === 1) return Number(d);
    } catch {
      // processo terminou durante a leitura
    }
  }
  return 0;
}

/** Início do processo em ticks desde o boot (campo 22 de /proc/<pid>/stat; 100 ticks por segundo). */
const startTicks = (pid) => {
  const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
  return Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19]);
};
const ageSeconds = (ticks) => Number(readFileSync('/proc/uptime', 'utf8').split(' ')[0]) - ticks / 100;

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const note = (msg) => {
  const line = `${new Date().toISOString()} selfheal: ${msg}`;
  console.error(line);
  try {
    appendFileSync(LOG, `${line}\n`);
  } catch {
    // sem disco gravável: fica só no log do healthcheck (docker inspect)
  }
};

const ok = await healthy(process.argv.slice(2)).catch(() => false);

const pid = mainPid();
const ticks = (() => {
  try {
    return pid ? startTicks(pid) : 0;
  } catch {
    return 0; // processo saiu entre a busca e a leitura
  }
})();
// o PID se repete depois do restart do contêiner (namespace novo); o instante de início, não
const proc = `${pid}@${ticks}`;
const state = readState();
if (state.proc !== proc) Object.assign(state, { proc, seenOk: false, fails: 0, term: null });
const now = Date.now() / 1000;
state.restarts = (state.restarts ?? []).filter((t) => now - t < WINDOW_S);

if (ok) {
  state.seenOk = true;
  state.fails = 0;
  state.term = null;
} else {
  state.fails += 1;
  const off = String(env.SELFHEAL ?? '').toLowerCase() === 'off';
  const age = ticks ? ageSeconds(ticks) : 0;
  if (!off && pid && state.seenOk && state.fails >= AFTER && age >= GRACE_S) {
    if (state.term) {
      // encerramento em andamento: SIGKILL se passou de 20 s e o processo não saiu
      if (now - state.term >= 20 && alive(pid)) {
        note(`processo ${pid} seguiu vivo depois do SIGTERM; SIGKILL`);
        process.kill(pid, 'SIGKILL');
      }
    } else if (state.restarts.length >= MAX_RESTARTS) {
      if (state.fails === AFTER)
        note(`${state.restarts.length} reinícios em ${WINDOW_S} s; não reinicio de novo (só unhealthy)`);
    } else {
      note(`${state.fails} falhas seguidas; encerrando o processo ${pid} para o Docker reiniciar`);
      state.restarts.push(now);
      state.term = now;
      process.kill(pid, 'SIGTERM');
    }
  }
}

try {
  writeFileSync(STATE, JSON.stringify(state));
} catch {
  // sem disco gravável a contagem não persiste: cada falha conta como a primeira e nada é encerrado
}
process.exit(ok ? 0 : 1);
