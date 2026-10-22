import type { Metadata } from 'next';

import { CodeTabs } from '@/components/docs/code-tabs';
import { Bullets, C, Callout, DocPage, DocSection, DocTable, P } from '@/components/docs/doc-blocks';
import { DOC_REQUESTS, SAMPLE } from '@/lib/docs';
import { API_KEY_PLACEHOLDER, PUBLIC_API_URL, requestSnippets, type CodeExample } from '@/lib/galaxie/request';

export const metadata: Metadata = { title: 'Tempo real · Documentação' };

const STREAM_URL = `${PUBLIC_API_URL}/v1/stream?events=${SAMPLE.event}&topics=score,status,incidents`;

const CHANGE_SAMPLE = `{
  "id": "1042",
  "topic": "event.score_changed",
  "event_id": "${SAMPLE.event}",
  "sport": "football",
  "competition_id": "01a15fba-af59-76bd-acc9-e458185511a8",
  "changed": ["score"],
  "data": { "score": { "home": 1, "away": 0 } },
  "occurred_at": "2026-10-09T01:12:47.345Z"
}`;

const SSE: CodeExample[] = [
  {
    label: 'curl',
    language: 'bash',
    code: `# -N: sem buffer, mostra as mensagens conforme chegam
curl -N "${STREAM_URL}" \\
  -H "x-galaxie-key: ${API_KEY_PLACEHOLDER}" \\
  -H "Last-Event-ID: 1041"   # opcional: retoma depois desta mudança

# retry: 3000
#
# event: ready
# data: {"last_event_id":"1041","topics":["event.score_changed","event.status_changed","event.incident_added"]}
#
# id: 1042
# event: event.score_changed
# data: {"id":"1042","topic":"event.score_changed","changed":["score"],"data":{"score":{"home":1,"away":0}},…}
#
# : hb 1791519167`,
  },
  {
    label: 'TypeScript',
    language: 'typescript',
    code: `// Servidor (Node 20+): fetch com a chave no header e leitura do stream.
let lastEventId: string | undefined; // guarde para retomar depois de uma queda

async function listen(onChange: (change: { topic: string; data: unknown }) => void) {
  const res = await fetch('${STREAM_URL}', {
    headers: {
      'x-galaxie-key': process.env.GALAXIE_KEY ?? '${API_KEY_PLACEHOLDER}',
      accept: 'text/event-stream',
      ...(lastEventId ? { 'last-event-id': lastEventId } : {}),
    },
  });
  if (!res.ok || !res.body) throw new Error(\`HTTP \${res.status}\`);

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break; // conexão caiu: chame listen() de novo (retoma pelo lastEventId)
    buffer += value;
    let end: number;
    while ((end = buffer.indexOf('\\n\\n')) >= 0) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      let id = '', event = '', data = '';
      for (const line of block.split('\\n')) {
        if (line.startsWith(':')) continue; // heartbeat a cada 15 s
        const sep = line.indexOf(':');
        const field = line.slice(0, sep);
        const val = line.slice(sep + 1).trimStart();
        if (field === 'id') id = val;
        else if (field === 'event') event = val;
        else if (field === 'data') data += val;
      }
      if (!id || !data) continue; // retry/ready: controle do stream
      lastEventId = id;
      onChange({ topic: event, data: JSON.parse(data) });
    }
  }
}`,
  },
  {
    label: 'Python',
    language: 'python',
    code: `import json
import os

import requests

last_event_id = None  # guarde para retomar depois de uma queda


def listen():
    global last_event_id
    headers = {"x-galaxie-key": os.environ.get("GALAXIE_KEY", "${API_KEY_PLACEHOLDER}"), "Accept": "text/event-stream"}
    if last_event_id:
        headers["Last-Event-ID"] = last_event_id
    with requests.get(
        "${PUBLIC_API_URL}/v1/stream",
        params={"events": "${SAMPLE.event}", "topics": "score,status,incidents"},
        headers=headers,
        stream=True,
        timeout=(10, 60),  # leitura > heartbeat de 15 s
    ) as resp:
        resp.raise_for_status()
        msg = {}
        for line in resp.iter_lines(decode_unicode=True):
            if line.startswith(":"):
                continue  # heartbeat
            if line == "":  # fim da mensagem
                if msg.get("id") and msg.get("data"):
                    last_event_id = msg["id"]
                    yield msg.get("event"), json.loads(msg["data"])
                msg = {}
                continue
            field, _, value = line.partition(":")
            value = value.lstrip()
            msg[field] = msg.get(field, "") + value if field == "data" else value


for topic, change in listen():
    print(topic, change["changed"], change["data"])`,
  },
  {
    label: 'Navegador',
    language: 'typescript',
    code: `// EventSource não envia headers: a chave vai em ?key=. Use uma chave DEDICADA, com escopo
// restrito (core_data) e rotacionável — nunca a chave principal do contrato.
const es = new EventSource('${STREAM_URL}&key=CHAVE_DE_LEITURA');

es.addEventListener('event.score_changed', (e) => {
  const change = JSON.parse(e.data);
  atualizarPlacar(change.event_id, change.data.score);
});
// Reconexão automática: o navegador reenvia o Last-Event-ID e a API completa o que faltou.`,
  },
];

const VERIFY: CodeExample[] = [
  {
    label: 'TypeScript',
    language: 'typescript',
    code: `import { createHmac, timingSafeEqual } from 'node:crypto';

/** Verifica x-galaxie-signature sobre o corpo BRUTO (antes do JSON.parse). */
export function verifyGalaxieSignature(rawBody: string, header: string, secret: string, toleranceSec = 300) {
  const parts = Object.fromEntries(header.split(',').map((p) => p.trim().split('=', 2)));
  const t = Number(parts.t);
  if (!Number.isInteger(t) || !parts.v1) return false;
  if (Math.abs(Date.now() / 1000 - t) > toleranceSec) return false; // proteção contra replay
  const expected = createHmac('sha256', secret).update(\`\${t}.\${rawBody}\`).digest();
  const received = Buffer.from(parts.v1, 'hex');
  return received.length === expected.length && timingSafeEqual(expected, received);
}

// Express:
// app.post('/hooks/galaxie', express.raw({ type: 'application/json' }), (req, res) => {
//   if (!verifyGalaxieSignature(req.body.toString('utf8'), req.get('x-galaxie-signature') ?? '', process.env.GALAXIE_WEBHOOK_SECRET!))
//     return res.sendStatus(401);
//   const change = JSON.parse(req.body); // descarte duplicatas pelo header idempotency-key
//   res.sendStatus(204);                 // responda rápido; processe de forma assíncrona
// });`,
  },
  {
    label: 'Python',
    language: 'python',
    code: `import hashlib
import hmac
import time


def verify_galaxie_signature(raw_body: bytes, header: str, secret: str, tolerance: int = 300) -> bool:
    """Verifica x-galaxie-signature sobre o corpo BRUTO (antes do json.loads)."""
    parts = dict(p.strip().split("=", 1) for p in header.split(",") if "=" in p)
    try:
        t = int(parts["t"])
        received = parts["v1"]
    except (KeyError, ValueError):
        return False
    if abs(time.time() - t) > tolerance:  # proteção contra replay
        return False
    expected = hmac.new(secret.encode(), f"{t}.".encode() + raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, received)


# Flask:
# @app.post("/hooks/galaxie")
# def galaxie_hook():
#     if not verify_galaxie_signature(request.get_data(), request.headers.get("x-galaxie-signature", ""), SECRET):
#         abort(401)
#     change = request.get_json()  # descarte duplicatas pelo header idempotency-key
#     return "", 204`,
  },
];

export default function RealtimePage() {
  return (
    <DocPage
      href="/docs/tempo-real"
      title="Tempo real"
      lead="Placar, status, lances, onde assistir e contexto de IA mudam o tempo todo. Em vez de consultar de novo, receba só o que mudou: por SSE (conexão aberta) ou webhook (POST assinado no seu servidor)."
    >
      <DocSection id="change-feed" title="Change feed">
        <P>
          Toda mudança visível ao cliente entra num change feed ordenado, com um <C>id</C> crescente. O mesmo
          registro sai pelo SSE e pelos webhooks — e também purga o cache da API e da CDN, então a próxima leitura
          REST já vem atualizada. A mensagem é compacta (o tópico, os campos que mudaram e os valores novos); para o
          estado completo, leia a rota REST do evento.
        </P>
        <DocTable
          head={['Curto (?topics=)', 'Tópico', 'Quando', 'Módulo']}
          rows={[
            ['status', 'event.status_changed', 'Mudou status, status_detail ou o relógio', 'core_data'],
            ['score', 'event.score_changed', 'Mudou o placar', 'core_data'],
            ['incidents', 'event.incident_added', 'Lance novo na timeline (gol, cartão, VAR…)', 'core_data'],
            ['where_to_watch', 'where_to_watch.changed', 'Opção de transmissão incluída, corrigida ou removida', 'where_to_watch'],
            ['context', 'event.context_published', 'Cenário/resumo de IA publicado ou revisado', 'live_intelligence'],
          ]}
        />
        <CodeTabs title="RealtimeChange (data: do SSE e corpo do webhook)" examples={[{ label: 'JSON', language: 'json', code: CHANGE_SAMPLE }]} />
        <P>
          <C>data</C> por tópico: <C>status</C>/<C>status_detail</C>/<C>clock</C> (com <C>previous.status</C>);{' '}
          <C>score</C>; <C>incidents</C> (os lances novos); <C>countries</C> (países afetados do onde assistir);{' '}
          <C>contexts</C> (locale e tipo publicados).
        </P>
      </DocSection>

      <DocSection id="sse" title="SSE — GET /v1/stream">
        <DocTable
          head={['Parâmetro', 'Regra']}
          rows={[
            ['events', 'Até 200 IDs de evento, separados por vírgula. Vazio = todos os eventos do contrato.'],
            ['competitions, sports', 'Filtros adicionais (até 50 competições, 20 esportes).'],
            ['topics', 'Nomes curtos ou completos; padrão: todos os do plano.'],
            ['Last-Event-ID / ?last_event_id=', 'Retoma: reenvia em ordem as mudanças depois desse id.'],
            ['?key=', 'Só para EventSource no navegador (que não envia headers); prefira o header.'],
          ]}
        />
        <P>
          Cada mensagem tem <C>id:</C>, <C>event:</C> (o tópico) e <C>data:</C> (JSON). O stream começa com{' '}
          <C>retry: 3000</C>, envia <C>event: ready</C> depois da retomada e um comentário de heartbeat a cada 15 s.
        </P>
        <CodeTabs examples={SSE} />
        <Bullets
          items={[
            <>Entrega pelo menos uma vez, em ordem de id: trate as mudanças como idempotentes pelo <C>id</C>.</>,
            <>
              Retomada guarda até 5000 mudanças; acima disso chega <C>event: replay_truncated</C> e o cliente deve
              recarregar o estado pela REST.
            </>,
            <>
              Há um limite de conexões simultâneas por contrato; acima dele, <C>429 RATE_LIMITED</C> com{' '}
              <C>retry-after</C>.
            </>,
          ]}
        />
      </DocSection>

      <DocSection id="webhooks" title="Webhooks">
        <P>
          A Galaxie faz um <C>POST</C> com o <C>RealtimeChange</C> no corpo para a URL HTTPS que você cadastrar no
          onboarding, com os mesmos filtros do SSE (tópicos, eventos, competições, esportes). O segredo de assinatura
          (<C>whsec_…</C>) é entregue uma única vez.
        </P>
        <DocTable
          head={['Header', 'Valor']}
          rows={[
            ['x-galaxie-signature', 't=<unix segundos>,v1=<hex de HMAC-SHA256(segredo, "<t>.<corpo bruto>")>'],
            ['x-galaxie-event', 'Tópico (ex.: event.score_changed)'],
            ['x-galaxie-delivery', 'ID da entrega'],
            ['x-galaxie-attempt', 'Tentativa (1, 2, …)'],
            ['idempotency-key', 'Igual em todas as tentativas: descarte duplicatas por ela'],
          ]}
        />
        <CodeTabs examples={VERIFY} />
        <Callout title="Retentativas" tone="warning">
          Qualquer resposta fora de 2xx (inclusive redirecionamento) ou demora acima de 10 s conta como falha. A
          Galaxie tenta de novo com espera exponencial (10 s, 20 s, 40 s…, até 1 h) por até 10 tentativas; depois,
          a entrega fica numa fila de reprocessamento. Responda rápido e processe de forma assíncrona.
        </Callout>
      </DocSection>

      <DocSection id="polling" title="Polling (clientes simples)">
        <P>
          Sem SSE nem webhook, consulte <C>GET /v1/events/live</C> com <C>If-None-Match</C>: enquanto nada muda, a
          resposta é <C>304</C> sem corpo. O TTL dessa rota é de 10 s.
        </P>
        <CodeTabs examples={requestSnippets(DOC_REQUESTS.live)} />
      </DocSection>
    </DocPage>
  );
}
