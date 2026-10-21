# @galaxie/apisports-client

Cliente único das 12 APIs da [api-sports.io](https://api-sports.io), com **economia de cota por design** (docs/03).

Toda chamada passa por esta sequência:

```mermaid
flowchart LR
  R[get] --> C{Resposta fresca<br/>no raw? TTL}
  C -- sim --> H[cache · 0 cota]
  C -- não --> V{Plano permite?<br/>temporada · data · params}
  V -- não --> X[PlanViolationError · 0 cota]
  V -- sim --> G{Quota Governor<br/>orçamento da prioridade}
  G -- negado --> Q[QuotaExceededError · 0 cota]
  G -- reserva --> L[Token bucket<br/>limite por minuto]
  L --> F[GET api-sports]
  F --> S[raw.api_response + ops.quota_ledger]
```

## Uso

```ts
import { ApiSportsClient, PgQuotaGovernor, PgRawStore, PlanRules, defaultPolicy, planByName } from '@galaxie/apisports-client';
import { createDb } from '@galaxie/db';

const db = createDb(process.env.DATABASE_URL!);
const plan = planByName(process.env.APISPORTS_PLAN); // free | pro | ultra | mega
const client = new ApiSportsClient({
  apiKey: process.env.APISPORTS_KEY!,
  store: new PgRawStore(db),
  governor: new PgQuotaGovernor(db, () => defaultPolicy(plan.dailyLimit, 15)),
  plan: new PlanRules(plan),
});

const { envelope, source } = await client.get({
  sport: 'football',
  endpoint: '/fixtures',
  params: { date: '2026-10-21' },
  priority: 'DAILY', // BOOTSTRAP | DAILY | LIVE | ADHOC
  jobId: 'daily-sync',
});

await client.status('football'); // /status não consome cota e reconcilia o Governor

// Ambiente local sem chave (ex.: depois de `snapshot:import`): só lê o raw, de qualquer idade,
// e lança OfflineMissError em vez de chamar o fornecedor.
const offline = new ApiSportsClient({ apiKey: '', store, governor, offline: true });
```

## Peças

| Módulo | Função |
|---|---|
| `client.ts` | `get`, `getAllPages` (cada página = 1 requisição), `status`; pedidos idênticos simultâneos (no processo ou entre processos) geram uma única chamada |
| `plan.ts` | Restrições do plano (free: temporadas 2022–2024, `date` ontem→amanhã, sem `ids`/`last`/`next`, `page ≤ 3`); aprende a nova janela quando o fornecedor a desloca |
| `ttl.ts` | Por quanto tempo reutilizar uma resposta do raw (referência 24 h, entidades lentas 7 dias, jogos antigos para sempre, ao vivo 10 s) |
| `rate-limiter.ts` | Espaçamento por API: 1 chamada a cada 60/perMinute s (6 s no free), sem rajada inicial |
| `raw-store.ts` | `PgRawStore` / `InMemoryRawStore` — grava todo envelope e só reaproveita respostas HTTP 2xx sem erro no envelope |
| `quota/policy.ts` | Decisão pura: limite − reserva, fatia por prioridade, empréstimo só da folga não protegida |
| `quota/pg-governor.ts` | Reserva atômica (advisory lock por API/dia) em `ops.quota_ledger`, plano do dia em `ops.quota_budget`, contador e limite do fornecedor em `ops.quota_snapshot` (o limite menor prevalece; leituras atrasadas não reduzem o piso) |

## Política padrão (free, 100/dia)

| Prioridade | Fatia | Observação |
|---|---|---|
| DAILY | 40 | protegida |
| LIVE | 40 | protegida; `critical: true` pode usar a reserva |
| ADHOC | 5 | não protegida |
| BOOTSTRAP | 0 | vive da folga; em dia sem jogos, `governor.plan(api, dia, { LIVE: 0, DAILY: 20 })` libera 65 |
| Reserva | 15 | só LIVE crítico |

## Testes

```bash
pnpm --filter @galaxie/apisports-client test              # unitários (servidor falso, simulação de um dia)
pnpm --filter @galaxie/apisports-client test:integration  # Postgres: concorrência do Governor, raw + ledger
```
