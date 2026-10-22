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
import { docRequests } from '@/lib/docs';
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
  return docMetadata('auth');
}

type Text = Dictionary['docs']['auth'];

function rotateExamples(key: string, c: Text['rotation']['code']): CodeExample[] {
  return [
    {
      label: 'curl',
      language: 'bash',
      code: `curl -X POST "${PUBLIC_API_URL}/v1/account/keys/rotate" \\
  -H "x-galaxie-key: ${key}" \\
  -H "content-type: application/json" \\
  -d '{"graceSeconds": 86400}'`,
    },
    {
      label: 'TypeScript',
      language: 'typescript',
      code: `const res = await fetch('${PUBLIC_API_URL}/v1/account/keys/rotate', {
  method: 'POST',
  headers: { 'x-galaxie-key': process.env.GALAXIE_KEY ?? '${key}', 'content-type': 'application/json' },
  body: JSON.stringify({ graceSeconds: 86400 }), // ${c.grace}
});
if (res.status !== 201) throw new Error(\`${c.failed}: HTTP \${res.status}\`);
const { key, previous } = await res.json();
// ${c.newKey}
console.log(key.prefix, previous.expiresAt);`,
    },
    {
      label: 'Python',
      language: 'python',
      code: `import os

import requests

resp = requests.post(
    "${PUBLIC_API_URL}/v1/account/keys/rotate",
    headers={"x-galaxie-key": os.environ.get("GALAXIE_KEY", "${key}")},
    json={"graceSeconds": 86400},  # ${c.grace}
    timeout=10,
)
resp.raise_for_status()
rotated = resp.json()
# ${c.newKeyPy}
print(rotated["key"]["prefix"], rotated["previous"]["expiresAt"])`,
    },
  ];
}

function rateLimitExamples(key: string, c: Text['limits']['code']): CodeExample[] {
  return [
    {
      label: 'curl',
      language: 'bash',
      code: `# ${c.headers}
curl -i "${PUBLIC_API_URL}/v1/sports" -H "x-galaxie-key: ${key}"
# x-ratelimit-limit: 600
# x-ratelimit-remaining: 597
# x-ratelimit-reset: 41`,
    },
    {
      label: 'TypeScript',
      language: 'typescript',
      code: `/** ${c.retry} */
async function galaxieGet(url: string, key: string): Promise<Response> {
  const res = await fetch(url, { headers: { 'x-galaxie-key': key } });
  if (res.status === 429) {
    const wait = Number(res.headers.get('retry-after') ?? res.headers.get('x-ratelimit-reset') ?? 1);
    await new Promise((r) => setTimeout(r, wait * 1000));
    return fetch(url, { headers: { 'x-galaxie-key': key } });
  }
  return res;
}`,
    },
    {
      label: 'Python',
      language: 'python',
      code: `import time

import requests


def galaxie_get(url: str, key: str) -> requests.Response:
    """${c.retry}"""
    resp = requests.get(url, headers={"x-galaxie-key": key}, timeout=10)
    if resp.status_code == 429:
        wait = int(resp.headers.get("retry-after") or resp.headers.get("x-ratelimit-reset") or 1)
        time.sleep(wait)
        resp = requests.get(url, headers={"x-galaxie-key": key}, timeout=10)
    return resp`,
    },
  ];
}

const ACCOUNT_SAMPLE = `{
  "tenant": {
    "slug": "portal-esportivo",
    "plan": "fan_experience",
    "modules": ["core_data", "where_to_watch", "semantic"],
    "markets": ["BR", "AR"],
    "sports": [],
    "rateLimitPerMinute": 600,
    "dailyRequestQuota": 50000
  },
  "key": {
    "prefix": "3f9a0c1b2d4e",
    "env": "live",
    "scopes": null,
    "status": "active",
    "effectiveModules": ["core_data", "where_to_watch", "semantic"]
  }
}`;

export default async function AuthPage() {
  const i18n = await getI18n();
  const { locale, t } = i18n;
  const text = t.docs.auth;
  const key = apiKeyPlaceholder(locale);
  const requests = docRequests(i18n);
  const snippets = (req: ApiRequest) => requestSnippets(req, PUBLIC_API_URL, locale);

  return (
    <DocPage href="/docs/autenticacao" title={t.code.docsNav.auth.label} lead={text.lead}>
      <DocSection id="chave" title={text.key.title}>
        <P>{docText(text.key.body, {}, { key })}</P>
        <DocTable
          head={[text.key.headItem, text.key.headHow]}
          mono={false}
          rows={[
            [text.key.format.name, docText(text.key.format.value)],
            [text.key.display.name, text.key.display.value],
            [text.key.scopes.name, text.key.scopes.value],
            [text.key.revocation.name, text.key.revocation.value],
          ]}
        />
        <Callout title={text.key.calloutTitle} tone="warning">
          {docText(text.key.callout, {}, { key })}
        </Callout>
      </DocSection>

      <DocSection id="conta" title={text.account.title}>
        <P>{docText(text.account.body)}</P>
        <CodeTabs examples={snippets(requests.account)} />
        <CodeTabs
          title={text.account.sampleTitle}
          examples={[{ label: 'JSON', language: 'json', code: ACCOUNT_SAMPLE }]}
        />
        <P>{docText(text.account.selfService)}</P>
        <CodeTabs examples={snippets(requests.usage)} />
      </DocSection>

      <DocSection id="rotacao" title={text.rotation.title}>
        <P>{docText(text.rotation.body)}</P>
        <CodeTabs examples={rotateExamples(key, text.rotation.code)} />
      </DocSection>

      <DocSection id="limites" title={text.limits.title}>
        <P>{text.limits.body}</P>
        <DocTable
          head={[text.limits.headHeader, text.limits.headMeaning]}
          rows={[
            ['x-ratelimit-limit', text.limits.limit],
            ['x-ratelimit-remaining', text.limits.remaining],
            ['x-ratelimit-reset', text.limits.reset],
            ['retry-after', text.limits.retryAfter],
          ]}
        />
        <CodeTabs examples={rateLimitExamples(key, text.limits.code)} />
        <Bullets items={[docText(text.limits.cache), text.limits.realtime]} />
      </DocSection>
    </DocPage>
  );
}
