/**
 * Revisão da página de manutenção (serviço `maintenance` do compose.yml).
 *
 * O docker compose não recria um serviço quando só muda o conteúdo das configs inline dele (`configs: content:`):
 * o hash do serviço não inclui esse conteúdo. Por isso o serviço leva o rótulo works.galaxie.maintenance-rev com um
 * hash das configs que ele monta; mudou a página, o JSON ou o Caddyfile, muda o rótulo e o próximo deploy recria
 * o serviço. Fora isso, nenhum deploy toca nele.
 *
 * Confere que o rótulo bate com o conteúdo (CI, job "valida stack"); se não bate, diz o valor certo:
 *   docker compose -f infra/vps-telemetry/compose.yml --env-file infra/vps-telemetry/env.example config --format json \
 *     | node infra/vps-telemetry/maintenance-rev.mjs
 */
import { createHash } from 'node:crypto';
import { text } from 'node:stream/consumers';

const LABEL = 'works.galaxie.maintenance-rev';

const project = JSON.parse(await text(process.stdin));
const service = project.services?.maintenance;
if (!service) {
  console.error('FAIL  serviço maintenance fora do compose');
  process.exit(1);
}

const hash = createHash('sha256');
for (const name of (service.configs ?? []).map((c) => c.source).sort()) {
  const content = project.configs?.[name]?.content;
  if (typeof content !== 'string') {
    console.error(`FAIL  config ${name} sem conteúdo inline (content:)`);
    process.exit(1);
  }
  hash.update(`${name}\n${content}\n`);
}
const expected = hash.digest('hex').slice(0, 12);

// `config --format json` devolve os rótulos como objeto; a lista `- chave=valor` também é aceita
const labels = Array.isArray(service.labels)
  ? Object.fromEntries(service.labels.map((l) => [l.split('=')[0], l.slice(l.indexOf('=') + 1)]))
  : (service.labels ?? {});
const current = labels[LABEL];
if (current !== expected) {
  console.error(
    `FAIL  ${LABEL}=${current ?? '(sem rótulo)'}, mas o conteúdo da página de manutenção pede ${LABEL}=${expected}:` +
      ' atualize o rótulo do serviço maintenance no compose.yml (é ele que faz o deploy recriar o serviço)',
  );
  process.exit(1);
}
console.log(`ok  ${LABEL}=${expected}`);
