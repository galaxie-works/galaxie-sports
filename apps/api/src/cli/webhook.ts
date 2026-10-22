import { parseArgs } from 'node:util';
import { closeDb, createDb, REALTIME_TOPICS } from '@galaxie/db';
import {
  createWebhookEndpoint,
  listDeadDeliveries,
  listWebhookEndpoints,
  replayDeadDeliveries,
  setWebhookActive,
  WebhookInputError,
} from '../webhooks/admin.js';

const USAGE = `Uso: pnpm --filter @galaxie/api webhook <comando> [opções]

Comandos:
  create   --tenant <slug> --url <https://...> [--topics score,status,...] [--events <ids>]
           [--competitions <ids>] [--sports football,...] [--description <texto>] [--allow-http]
           Cadastra um webhook e exibe o segredo de assinatura (uma única vez).
  list     [--tenant <slug>]               Lista os webhooks (com pendentes e DLQ).
  disable  --id <endpoint>                 Desativa um webhook.
  enable   --id <endpoint>                 Reativa um webhook.
  dlq      [--id <endpoint>] [--limit 50]  Lista entregas na DLQ (status dead).
  replay   --id <endpoint> | --deliveries <ids>   Recoloca entregas da DLQ na fila.

Tópicos: score, status, incidents, where_to_watch, context, related (ou ${REALTIME_TOPICS.join(', ')}).
Sem --topics, o webhook recebe todos os tópicos do plano do tenant.
`;

const csv = (v: string | undefined) =>
  v
    ?.split(',')
    .map((s) => s.trim())
    .filter(Boolean);

const { values, positionals } = parseArgs({
  options: {
    tenant: { type: 'string' },
    url: { type: 'string' },
    topics: { type: 'string' },
    events: { type: 'string' },
    competitions: { type: 'string' },
    sports: { type: 'string' },
    description: { type: 'string' },
    'allow-http': { type: 'boolean', default: false },
    id: { type: 'string' },
    deliveries: { type: 'string' },
    limit: { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  },
  // `pnpm webhook -- create ...` repassa o "--"; descartamos para não encerrar as opções
  args: process.argv.slice(2).filter((a, i) => !(i === 0 && a === '--')),
  allowPositionals: true,
});

const command = positionals[0];
if (values.help || !command) {
  console.log(USAGE);
  process.exit(values.help ? 0 : 1);
}
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL não definida (veja .env.example).');
  process.exit(1);
}

const fail = (msg: string): never => {
  console.error(msg);
  process.exit(1);
};

const db = createDb(url, { max: 1 });
try {
  switch (command) {
    case 'create': {
      if (!values.tenant || !values.url) fail('create exige --tenant e --url.');
      const events = csv(values.events)?.map((e) => e.toLowerCase());
      const competitions = csv(values.competitions)?.map((c) => c.toLowerCase());
      const sports = csv(values.sports);
      const created = await createWebhookEndpoint(db, {
        tenantSlug: values.tenant!,
        url: values.url!,
        topics: csv(values.topics) ?? [],
        filters: {
          ...(events?.length ? { events } : {}),
          ...(competitions?.length ? { competitions } : {}),
          ...(sports?.length ? { sports } : {}),
        },
        ...(values.description ? { description: values.description } : {}),
        allowInsecure: values['allow-http'],
      });
      console.log(`Webhook ${created.id} criado para o tenant ${values.tenant}.`);
      console.log(`Tópicos: ${created.topics.length ? created.topics.join(', ') : 'todos os do plano'}`);
      console.log('Segredo de assinatura (guarde agora — não será exibido novamente):\n');
      console.log(`  ${created.secret}\n`);
      console.log('Verificação da assinatura: docs/05-api-publica.md §5.2.');
      break;
    }
    case 'list': {
      const rows = await listWebhookEndpoints(db, values.tenant);
      if (!rows.length) console.log('Nenhum webhook cadastrado.');
      for (const r of rows)
        console.log(
          `${r.id}  ${r.tenant}  ${r.active ? 'ativo' : 'inativo'}  ${r.url}  ` +
            `tópicos=${r.topics.length ? r.topics.join(',') : '*'}  pendentes=${r.pending}  dlq=${r.dead}`,
        );
      break;
    }
    case 'disable':
    case 'enable': {
      if (!values.id) fail(`${command} exige --id.`);
      const ok = await setWebhookActive(db, values.id!, command === 'enable');
      if (!ok) fail(`Webhook não encontrado: ${values.id}`);
      console.log(`Webhook ${values.id} ${command === 'enable' ? 'reativado' : 'desativado'}.`);
      break;
    }
    case 'dlq': {
      const rows = await listDeadDeliveries(db, {
        ...(values.id ? { endpointId: values.id } : {}),
        ...(values.limit ? { limit: Number(values.limit) } : {}),
      });
      if (!rows.length) console.log('DLQ vazia.');
      for (const r of rows)
        console.log(
          `${r.id}  endpoint=${r.endpointId}  mudança=${r.changeId}  ${r.topic}  tentativas=${r.attempts}  ` +
            `http=${r.responseCode ?? '-'}  erro=${r.lastError ?? '-'}`,
        );
      break;
    }
    case 'replay': {
      const ids = csv(values.deliveries)?.map(Number);
      if (!ids?.length && !values.id) fail('replay exige --id <endpoint> ou --deliveries <ids>.');
      const n = await replayDeadDeliveries(db, ids?.length ? { ids } : { endpointId: values.id! });
      console.log(`${n} entrega(s) recolocada(s) na fila.`);
      break;
    }
    default:
      fail(`Comando desconhecido: ${command}\n\n${USAGE}`);
  }
} catch (err) {
  if (err instanceof WebhookInputError) fail(err.message);
  throw err;
} finally {
  await closeDb(db);
}
