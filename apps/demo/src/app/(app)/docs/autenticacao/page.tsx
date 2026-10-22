import type { Metadata } from 'next';

import { CodeTabs } from '@/components/docs/code-tabs';
import { Bullets, C, Callout, DocPage, DocSection, DocTable, P } from '@/components/docs/doc-blocks';
import { DOC_REQUESTS } from '@/lib/docs';
import { API_KEY_PLACEHOLDER, PUBLIC_API_URL, requestSnippets, type CodeExample } from '@/lib/galaxie/request';

export const metadata: Metadata = { title: 'Autenticação · Documentação' };

const ROTATE: CodeExample[] = [
  {
    label: 'curl',
    language: 'bash',
    code: `curl -X POST "${PUBLIC_API_URL}/v1/account/keys/rotate" \\
  -H "x-galaxie-key: ${API_KEY_PLACEHOLDER}" \\
  -H "content-type: application/json" \\
  -d '{"graceSeconds": 86400}'`,
  },
  {
    label: 'TypeScript',
    language: 'typescript',
    code: `const res = await fetch('${PUBLIC_API_URL}/v1/account/keys/rotate', {
  method: 'POST',
  headers: { 'x-galaxie-key': process.env.GALAXIE_KEY ?? '${API_KEY_PLACEHOLDER}', 'content-type': 'application/json' },
  body: JSON.stringify({ graceSeconds: 86400 }), // a chave atual vale mais 24 h
});
if (res.status !== 201) throw new Error(\`rotação falhou: HTTP \${res.status}\`);
const { key, previous } = await res.json();
// key.key é a chave nova completa: aparece só nesta resposta, guarde no cofre de segredos agora
console.log(key.prefix, previous.expiresAt);`,
  },
  {
    label: 'Python',
    language: 'python',
    code: `import os

import requests

resp = requests.post(
    "${PUBLIC_API_URL}/v1/account/keys/rotate",
    headers={"x-galaxie-key": os.environ.get("GALAXIE_KEY", "${API_KEY_PLACEHOLDER}")},
    json={"graceSeconds": 86400},  # a chave atual vale mais 24 h
    timeout=10,
)
resp.raise_for_status()
rotated = resp.json()
# rotated["key"]["key"] é a chave nova completa: aparece só nesta resposta
print(rotated["key"]["prefix"], rotated["previous"]["expiresAt"])`,
  },
];

const RATE_LIMIT: CodeExample[] = [
  {
    label: 'curl',
    language: 'bash',
    code: `# -i mostra os headers da resposta
curl -i "${PUBLIC_API_URL}/v1/sports" -H "x-galaxie-key: ${API_KEY_PLACEHOLDER}"
# x-ratelimit-limit: 600
# x-ratelimit-remaining: 597
# x-ratelimit-reset: 41`,
  },
  {
    label: 'TypeScript',
    language: 'typescript',
    code: `/** GET com uma nova tentativa quando o limite estoura (429 traz retry-after em segundos). */
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
    """GET com uma nova tentativa quando o limite estoura (429 traz retry-after em segundos)."""
    resp = requests.get(url, headers={"x-galaxie-key": key}, timeout=10)
    if resp.status_code == 429:
        wait = int(resp.headers.get("retry-after") or resp.headers.get("x-ratelimit-reset") or 1)
        time.sleep(wait)
        resp = requests.get(url, headers={"x-galaxie-key": key}, timeout=10)
    return resp`,
  },
];

export default function AuthPage() {
  return (
    <DocPage
      href="/docs/autenticacao"
      title="Autenticação"
      lead="Cada requisição leva a chave do seu contrato no header x-galaxie-key. A chave define o plano, os módulos, os mercados e o limite de uso."
    >
      <DocSection id="chave" title="A chave no header">
        <P>
          Envie <C>x-galaxie-key: {API_KEY_PLACEHOLDER}</C> em todas as rotas <C>/v1</C> e <C>/mirror</C>. Só o{' '}
          <C>/openapi.json</C> e a referência <C>/docs</C> são públicos. Sem chave, ou com chave inválida, a
          resposta é <C>401 INVALID_KEY</C>.
        </P>
        <DocTable
          head={['Item', 'Como funciona']}
          mono={false}
          rows={[
            ['Formato', <><C key="f">gs_live_…</C> (produção) ou <C key="t">gs_test_…</C> (testes), com um prefixo público de 12 caracteres</>],
            ['Exibição', 'A chave completa aparece uma única vez, na criação ou na rotação. A Galaxie guarda só o hash.'],
            ['Escopos', 'Uma chave pode ser restrita a alguns módulos do contrato (ex.: uma chave só de core_data para o navegador).'],
            ['Revogação', 'Revogação, suspensão e mudança de plano valem em até 60 segundos.'],
          ]}
        />
        <Callout title="A chave fica no servidor" tone="warning">
          Não coloque a chave em apps, páginas ou repositórios. Chame a API do seu backend (esta demo faz assim:
          o navegador fala com um proxy do servidor, que injeta a chave). Nos exemplos, troque{' '}
          <C>{API_KEY_PLACEHOLDER}</C> pela variável de ambiente com a sua chave.
        </Callout>
      </DocSection>

      <DocSection id="conta" title="Confira o seu contrato">
        <P>
          <C>GET /v1/account</C> não exige módulo: responde o plano, os módulos contratados, os mercados (países),
          os esportes, o limite por minuto e os dados da chave em uso — <C>effectiveModules</C> é o que ela
          realmente libera (módulos do contrato ∩ escopos da chave).
        </P>
        <CodeTabs examples={requestSnippets(DOC_REQUESTS.account)} />
        <CodeTabs
          title="200 OK (exemplo)"
          examples={[
            {
              label: 'JSON',
              language: 'json',
              code: `{
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
}`,
            },
          ]}
        />
        <P>
          Também em autoatendimento: <C>GET /v1/account/keys</C> lista as chaves (só metadados, nunca o segredo)
          e <C>GET /v1/account/usage</C> traz as requisições por dia e rota (até 92 dias):
        </P>
        <CodeTabs examples={requestSnippets(DOC_REQUESTS.usage)} />
      </DocSection>

      <DocSection id="rotacao" title="Rotação sem downtime">
        <P>
          <C>POST /v1/account/keys/rotate</C> cria uma chave nova (mesmo rótulo, escopos e ambiente) e mantém a
          atual válida por <C>graceSeconds</C> (padrão 86400 = 24 h; 0 revoga já; máximo 7 dias). Publique a nova
          chave nos seus servidores dentro desse prazo.
        </P>
        <CodeTabs examples={ROTATE} />
      </DocSection>

      <DocSection id="limites" title="Limites de uso">
        <P>
          O limite é por contrato e por rota, numa janela de 60 segundos. Toda resposta autenticada traz:
        </P>
        <DocTable
          head={['Header', 'Significado']}
          rows={[
            ['x-ratelimit-limit', 'Requisições permitidas na janela (por rota).'],
            ['x-ratelimit-remaining', 'Quantas ainda cabem na janela atual.'],
            ['x-ratelimit-reset', 'Segundos até a janela reiniciar.'],
            ['retry-after', 'Só no 429 RATE_LIMITED: quanto esperar antes de tentar de novo.'],
          ]}
        />
        <CodeTabs examples={RATE_LIMIT} />
        <Bullets
          items={[
            <>
              Respeite o cache (<C>ETag</C> e <C>Cache-Control</C>): uma resposta 304 é mais rápida e o seu CDN pode
              servir sem chamar a API.
            </>,
            <>Para placar ao vivo, prefira o tempo real (SSE ou webhook) a polling curto.</>,
          ]}
        />
      </DocSection>
    </DocPage>
  );
}
