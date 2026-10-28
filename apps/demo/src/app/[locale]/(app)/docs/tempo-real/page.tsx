import type { Metadata } from 'next';

import { CodeTabs } from '@/components/docs/code-tabs';
import {
  Bullets,
  Callout,
  docMetadata,
  DocPage,
  DocSection,
  DocTable,
  docText,
  P,
} from '@/components/docs/doc-blocks';
import { docRequests, SAMPLE } from '@/lib/docs';
import {
  apiKeyPlaceholder,
  PUBLIC_API_URL,
  requestSnippets,
  type ApiRequest,
  type CodeExample,
} from '@/lib/galaxie/request';
import type { Dictionary } from '@/lib/i18n/dictionary';
import { getI18n } from '@/lib/i18n/server';

export function generateMetadata(): Promise<Metadata> {
  return docMetadata('realtime');
}

type Text = Dictionary['docs']['realtime'];

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

function sseExamples(key: string, c: Text['sse']['code']): CodeExample[] {
  return [
    {
      label: 'curl',
      language: 'bash',
      code: `# ${c.noBuffer}
curl -N "${STREAM_URL}" \\
  -H "x-galaxie-key: ${key}" \\
  -H "Last-Event-ID: 1041"   # ${c.resumeAfter}

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
      code: `// ${c.server}
let lastEventId: string | undefined; // ${c.keepId}

async function listen(onChange: (change: { topic: string; data: unknown }) => void) {
  const res = await fetch('${STREAM_URL}', {
    headers: {
      'x-galaxie-key': process.env.GALAXIE_KEY ?? '${key}',
      accept: 'text/event-stream',
      ...(lastEventId ? { 'last-event-id': lastEventId } : {}),
    },
  });
  if (!res.ok || !res.body) throw new Error(\`HTTP \${res.status}\`);

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break; // ${c.dropped}
    buffer += value;
    let end: number;
    while ((end = buffer.indexOf('\\n\\n')) >= 0) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      let id = '', event = '', data = '';
      for (const line of block.split('\\n')) {
        if (line.startsWith(':')) continue; // ${c.heartbeat}
        const sep = line.indexOf(':');
        const field = line.slice(0, sep);
        const val = line.slice(sep + 1).trimStart();
        if (field === 'id') id = val;
        else if (field === 'event') event = val;
        else if (field === 'data') data += val;
      }
      if (!id || !data) continue; // ${c.control}
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

last_event_id = None  # ${c.keepId}


def listen():
    global last_event_id
    headers = {"x-galaxie-key": os.environ.get("GALAXIE_KEY", "${key}"), "Accept": "text/event-stream"}
    if last_event_id:
        headers["Last-Event-ID"] = last_event_id
    with requests.get(
        "${PUBLIC_API_URL}/v1/stream",
        params={"events": "${SAMPLE.event}", "topics": "score,status,incidents"},
        headers=headers,
        stream=True,
        timeout=(10, 60),  # ${c.readTimeout}
    ) as resp:
        resp.raise_for_status()
        msg = {}
        for line in resp.iter_lines(decode_unicode=True):
            if line.startswith(":"):
                continue  # ${c.heartbeatShort}
            if line == "":  # ${c.endOfMessage}
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
      label: c.browserTab,
      language: 'typescript',
      code: `// ${c.browserKey1}
// ${c.browserKey2}
let lastId = '';

async function connect() {
  const { data } = await (await fetch('/stream-token', { method: 'POST' })).json();
  const resume = lastId ? \`&last_event_id=\${lastId}\` : '';
  const es = new EventSource(\`${STREAM_URL}&token=\${data.token}\${resume}\`);

  es.addEventListener('event.score_changed', (e) => {
    lastId = e.lastEventId;
    const change = JSON.parse(e.data);
    ${c.updateScore}(change.event_id, change.data.score);
  });
  // ${c.reconnect}
  es.onerror = () => {
    es.close();
    setTimeout(connect, 3000);
  };
}

connect();`,
    },
  ];
}

function verifyExamples(c: Text['webhooks']['code']): CodeExample[] {
  return [
    {
      label: 'TypeScript',
      language: 'typescript',
      code: `import { createHmac, timingSafeEqual } from 'node:crypto';

/** ${c.verify} */
export function verifyGalaxieSignature(rawBody: string, header: string, secret: string, toleranceSec = 300) {
  const parts = Object.fromEntries(header.split(',').map((p) => p.trim().split('=', 2)));
  const t = Number(parts.t);
  if (!Number.isInteger(t) || !parts.v1) return false;
  if (Math.abs(Date.now() / 1000 - t) > toleranceSec) return false; // ${c.replay}
  const expected = createHmac('sha256', secret).update(\`\${t}.\${rawBody}\`).digest();
  const received = Buffer.from(parts.v1, 'hex');
  return received.length === expected.length && timingSafeEqual(expected, received);
}

// Express:
// app.post('/hooks/galaxie', express.raw({ type: 'application/json' }), (req, res) => {
//   if (!verifyGalaxieSignature(req.body.toString('utf8'), req.get('x-galaxie-signature') ?? '', process.env.GALAXIE_WEBHOOK_SECRET!))
//     return res.sendStatus(401);
//   const change = JSON.parse(req.body); // ${c.dedupe}
//   res.sendStatus(204); // ${c.respondFast}
// });`,
    },
    {
      label: 'Python',
      language: 'python',
      code: `import hashlib
import hmac
import time


def verify_galaxie_signature(raw_body: bytes, header: str, secret: str, tolerance: int = 300) -> bool:
    """${c.verifyPy}"""
    parts = dict(p.strip().split("=", 1) for p in header.split(",") if "=" in p)
    try:
        t = int(parts["t"])
        received = parts["v1"]
    except (KeyError, ValueError):
        return False
    if abs(time.time() - t) > tolerance:  # ${c.replay}
        return False
    expected = hmac.new(secret.encode(), f"{t}.".encode() + raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, received)


# Flask:
# @app.post("/hooks/galaxie")
# def galaxie_hook():
#     if not verify_galaxie_signature(request.get_data(), request.headers.get("x-galaxie-signature", ""), SECRET):
#         abort(401)
#     change = request.get_json()  # ${c.dedupe}
#     return "", 204`,
    },
  ];
}

export default async function RealtimePage() {
  const i18n = await getI18n();
  const { locale, t } = i18n;
  const text = t.docs.realtime;
  const key = apiKeyPlaceholder(locale);
  const requests = docRequests(i18n);
  const snippets = (req: ApiRequest) => requestSnippets(req, PUBLIC_API_URL, locale);

  return (
    <DocPage href="/docs/tempo-real" title={t.code.docsNav.realtime.label} lead={text.lead}>
      <DocSection id="change-feed" title={text.feed.title}>
        <P>{docText(text.feed.body)}</P>
        <DocTable
          head={[text.feed.headShort, text.feed.headTopic, text.feed.headWhen, text.feed.headModule]}
          rows={[
            ['status', 'event.status_changed', text.feed.status, 'core_data'],
            ['score', 'event.score_changed', text.feed.score, 'core_data'],
            ['incidents', 'event.incident_added', text.feed.incidents, 'core_data'],
            ['where_to_watch', 'where_to_watch.changed', text.feed.whereToWatch, 'where_to_watch'],
            ['context', 'event.context_published', text.feed.context, 'live_intelligence'],
          ]}
        />
        <CodeTabs
          title={text.feed.sampleTitle}
          examples={[{ label: 'JSON', language: 'json', code: CHANGE_SAMPLE }]}
        />
        <P>{docText(text.feed.data)}</P>
      </DocSection>

      <DocSection id="sse" title={text.sse.title}>
        <DocTable
          head={[text.sse.headParam, text.sse.headRule]}
          rows={[
            ['events', text.sse.events],
            ['competitions, sports', text.sse.filters],
            ['topics', text.sse.topics],
            ['Last-Event-ID / ?last_event_id=', text.sse.resume],
            ['?token=', text.sse.token],
            ['?key=', text.sse.key],
          ]}
        />
        <P>{docText(text.sse.body)}</P>
        <CodeTabs examples={sseExamples(key, text.sse.code)} />
        <Bullets
          items={[docText(text.sse.atLeastOnce), docText(text.sse.replay), docText(text.sse.connections)]}
        />
      </DocSection>

      <DocSection id="webhooks" title={text.webhooks.title}>
        <P>{docText(text.webhooks.body)}</P>
        <DocTable
          head={[text.webhooks.headHeader, text.webhooks.headValue]}
          rows={[
            ['x-galaxie-signature', text.webhooks.signature],
            ['x-galaxie-event', text.webhooks.event],
            ['x-galaxie-delivery', text.webhooks.delivery],
            ['x-galaxie-attempt', text.webhooks.attempt],
            ['idempotency-key', text.webhooks.idempotency],
          ]}
        />
        <CodeTabs examples={verifyExamples(text.webhooks.code)} />
        <Callout title={text.webhooks.retriesTitle} tone="warning">
          {text.webhooks.retries}
        </Callout>
      </DocSection>

      <DocSection id="polling" title={text.polling.title}>
        <P>{docText(text.polling.body)}</P>
        <CodeTabs examples={snippets(requests.live)} />
      </DocSection>
    </DocPage>
  );
}
