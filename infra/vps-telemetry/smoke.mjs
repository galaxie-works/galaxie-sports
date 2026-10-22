/**
 * Smoke test pós-deploy da stack da VPS: confere, pela API pública e pela demo, que cada funcionalidade
 * entregue responde com DADOS — não só 200. Nasceu de bugs que só apareciam em produção e em silêncio
 * (regulamentos fora da imagem → tags vazias; glossário vazio; base de dados defasada).
 *
 * Roda dentro do contêiner `demo` (tem a chave da demo e a URL interna da API):
 *   docker compose exec -T demo node - < smoke.mjs
 * FAIL = funcionalidade quebrada (código/imagem/config) → sai com 1. WARN = dado incompleto (sync,
 * cota, IA) → não derruba o deploy, mas aparece no relatório.
 */
const API = process.env.GALAXIE_API_URL ?? 'http://api:8080';
const KEY = process.env.GALAXIE_DEMO_KEY ?? '';
const DEMO = process.env.SMOKE_DEMO_URL ?? 'http://127.0.0.1:3000';

// IDs canônicos estáveis usados como referência (time e jogo com dados completos)
const PALMEIRAS = '01a15fba-ec17-7d8b-90d7-47b3ccbe967e';
const PAL_FLU_SEMI = '01a163b8-7ca2-71e8-a92e-8dc201d5d83a';

const results = [];
const record = (level, name, detail) => results.push({ level, name, detail });

async function api(path) {
  const res = await fetch(`${API}${path}`, { headers: { 'x-galaxie-key': KEY } });
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    // corpo não-JSON: segue com null
  }
  return { status: res.status, body: body?.data ?? body };
}

async function check(name, fn) {
  try {
    const out = await fn();
    if (out === true || out === undefined) record('PASS', name, '');
    else if (typeof out === 'string') record('PASS', name, out);
    else record(out.level, name, out.detail);
  } catch (err) {
    record('FAIL', name, err instanceof Error ? err.message : String(err));
  }
}

const fail = (detail) => ({ level: 'FAIL', detail });
const warn = (detail) => ({ level: 'WARN', detail });

await check('API /health', async () => {
  const res = await fetch(`${API}/health`);
  return res.ok ? true : fail(`status ${res.status}`);
});

await check('Glossário (data/knowledge na imagem da API)', async () => {
  const { status, body } = await api('/v1/glossary?sport=football');
  if (status !== 200) return fail(`status ${status}`);
  return Array.isArray(body) && body.length > 0 ? `${body.length} termos` : fail('lista vazia');
});

await check('Time: cores do escudo, estádio curado e campanha', async () => {
  const { status, body } = await api(`/v1/teams/${PALMEIRAS}/overview`);
  if (status !== 200) return fail(`status ${status}`);
  if (!body?.team?.colors?.primary) return fail('sem colors (paleta dos escudos)');
  if (!body?.competitions?.length) return fail('sem campanha nas competições');
  return `cor ${body.team.colors.primary} · ${body.competitions.length} competições`;
});

await check('Time por temporada (overview ?season=2025)', async () => {
  const { status, body } = await api(`/v1/teams/${PALMEIRAS}/overview?season=2025`);
  if (status !== 200) return fail(`status ${status}`);
  if (body?.season !== 2025 || !Array.isArray(body?.seasons))
    return fail('sem season/seasons — API anterior ao seletor?');
  if (!body.seasons.some((s) => s.year === 2025))
    return fail('2025 fora de seasons (base sem o histórico do time)');
  const comps = body.competitions ?? [];
  if (!comps.length) return fail('sem campanha nas competições de 2025');
  if (comps.some((c) => c.season?.year !== 2025)) return fail('campanha fora da temporada pedida');
  if (!body.last_events?.length) return fail('sem jogos de 2025');
  if (body.next_event) return fail('próximo jogo numa temporada passada');
  // 2025 já acabou: campanha ainda "em disputa" = jogos pendentes sem atualizar na base
  const open = comps.filter((c) => c.campaign?.ongoing).map((c) => c.competition?.slug);
  if (open.length) return warn(`campanha de 2025 ainda em disputa: ${open.join(', ')}`);
  return `${body.seasons.length} temporadas · ${comps.length} competições em 2025 · ${body.last_events.length} jogos`;
});

await check('Stakes e tags do torcedor (config/rules na imagem da API)', async () => {
  const { status, body } = await api(`/v1/teams/${PALMEIRAS}/overview`);
  if (status !== 200) return fail(`status ${status}`);
  const next = body?.next_event;
  if (!next) return warn('time sem próximo jogo na base para conferir');
  const stakes = next.stakes?.length ?? 0;
  const tags = (next.participants ?? []).reduce((n, p) => n + (p.fan_tags?.length ?? 0), 0);
  // o Brasileirão tem regulamento em config/rules: sem stakes num jogo dele, a imagem perdeu os regulamentos
  if (!stakes && next.competition?.slug === 'brasileirao-serie-a')
    return fail(`jogo do Brasileirão (${next.id}) sem stakes — config/rules fora da imagem da API?`);
  if (!stakes) return warn(`próximo jogo (${next.id}) sem stakes — fase sem regra?`);
  return `${stakes} stakes · ${tags} tags no próximo jogo`;
});

await check('Minuto a minuto (lances do jogo de referência)', async () => {
  const { status, body } = await api(`/v1/events/${PAL_FLU_SEMI}/timeline`);
  if (status !== 200) return fail(`status ${status}`);
  const n = (body?.incidents ?? body?.items ?? []).length;
  return n > 0 ? `${n} lances` : warn('sem lances — base da VPS defasada (sync pendente?)');
});

await check('Resumo pós-jogo (IA)', async () => {
  const { status, body } = await api(`/v1/events/${PAL_FLU_SEMI}/context`);
  if (status !== 200) return fail(`status ${status}`);
  const items = Array.isArray(body) ? body : (body?.items ?? []);
  return items.length ? `${items.length} textos` : warn('sem resumo/cenário gerado');
});

await check('Conteúdo relacionado (YouTube)', async () => {
  const { status, body } = await api(`/v1/events/${PAL_FLU_SEMI}/related`);
  if (status !== 200) return fail(`status ${status}`);
  return Array.isArray(body) && body.length ? `${body.length} vídeos` : warn('nenhum vídeo');
});

await check('Onde assistir: biblioteca de emissoras com logos', async () => {
  const { status, body } = await api('/v1/broadcasters');
  if (status !== 200) return fail(`status ${status}`);
  const withLogo = (body ?? []).filter((b) => b.logo).length;
  if (!body?.length) return fail('biblioteca vazia');
  return withLogo ? `${body.length} emissoras · ${withLogo} com logo` : warn('nenhum logo espelhado');
});

await check('Ao vivo (endpoint)', async () => {
  const { status, body } = await api('/v1/events/live');
  return status === 200 ? `${(body ?? []).length} jogos ao vivo agora` : fail(`status ${status}`);
});

await check('Demo: login e proteção das páginas', async () => {
  const login = await fetch(`${DEMO}/login`, { redirect: 'manual' });
  if (login.status !== 200) return fail(`/login status ${login.status}`);
  const home = await fetch(`${DEMO}/`, { redirect: 'manual' });
  if (home.status !== 307 && home.status !== 302)
    return fail(`/ sem sessão deveria redirecionar (status ${home.status})`);
  return true;
});

const width = Math.max(...results.map((r) => r.name.length));
for (const r of results) console.log(`${r.level.padEnd(4)}  ${r.name.padEnd(width)}  ${r.detail}`);
const fails = results.filter((r) => r.level === 'FAIL').length;
const warns = results.filter((r) => r.level === 'WARN').length;
console.log(`\n${results.length - fails - warns} ok · ${warns} aviso(s) · ${fails} falha(s)`);
process.exit(fails ? 1 : 0);
