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

// artilheiro do elenco de 2025: vira o jogador de referência do perfil
let scorer = null;
await check('Elenco por temporada (squad ?season=2025, com jogos e gols)', async () => {
  const { status, body } = await api(`/v1/teams/${PALMEIRAS}/squad?season=2025`);
  if (status !== 200) return fail(`status ${status}`);
  if (body?.season !== 2025) return fail('season diferente da pedida');
  const players = body?.players ?? [];
  if (!players.length) return fail('elenco de 2025 vazio');
  if (!players.some((p) => p.stats !== undefined))
    return fail('sem stats — API anterior ao elenco por temporada?');
  const played = players.filter((p) => (p.stats?.appearances ?? 0) > 0);
  if (!played.length)
    return warn('ninguém com jogos em 2025 — detalhe das partidas (fixtures/players) ausente?');
  scorer = [...played].sort((a, b) => (b.stats.goals ?? 0) - (a.stats.goals ?? 0))[0];
  const flags = players.filter((p) => p.person?.nationality_ref).length;
  return `${players.length} jogadores · ${played.length} com jogos · ${body.coaches?.length ?? 0} técnicos · ${flags} com bandeira`;
});

await check('Perfil do jogador (people/{id}/overview)', async () => {
  if (!scorer) return warn('sem jogador de referência (elenco de 2025 sem jogos)');
  const { status, body } = await api(`/v1/people/${scorer.person.id}/overview?season=2025`);
  if (status !== 200) return fail(`status ${status}`);
  if (!Array.isArray(body?.seasons) || !Array.isArray(body?.career)) return fail('sem seasons/career');
  if (!body.stats?.length || !body.totals) return fail(`sem números de 2025 para ${scorer.person.name}`);
  if (!body.recent_matches?.length) return fail('sem últimos jogos');
  if (!body.current_team) return warn('sem time atual');
  return `${scorer.person.name}: ${body.totals.appearances} jogos · ${body.totals.goals} gols em ${body.stats.length} competições · ${body.career.length} clubes`;
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

await check('Estatísticas do jogo (códigos estáveis e rótulos)', async () => {
  const { status, body } = await api(`/v1/events/${PAL_FLU_SEMI}/stats`);
  if (status !== 200) return fail(`status ${status}`);
  const teams = body?.teams ?? [];
  if (!body?.available || teams.length !== 2)
    return warn('sem estatísticas — detalhe da partida não sincronizado?');
  const possession = teams.map((t) => t.statistics?.find((s) => s.code === 'possession_pct'));
  // estatística sem `code`/`label`: a imagem da API é anterior à normalização
  if (possession.some((s) => s?.numeric == null || !s.label))
    return fail('posse de bola sem code/numeric/label');
  const coded = teams[0].statistics.filter((s) => s.code).length;
  return `posse ${possession.map((s) => s.numeric).join('–')} · ${coded} estatísticas com código`;
});

await check('Relevância por país (jogo de referência)', async () => {
  const { status, body } = await api(`/v1/events/${PAL_FLU_SEMI}?locale=pt-BR`);
  if (status !== 200) return fail(`status ${status}`);
  const list = body?.relevance_by_market;
  // sem a lista: a imagem da API é anterior à relevância por país (ou config/geo sem `markets`)
  if (!Array.isArray(list) || !list.length) return fail('sem relevance_by_market');
  const br = list.find((r) => r.market === 'BR');
  if (!br) return fail('BR fora dos mercados ativos — config/geo `markets` fora da imagem?');
  if (!br.reasons?.includes('team_from_market'))
    return fail(`BR sem o bônus de time do país (${(br.reasons ?? []).join(', ') || 'nenhum'})`);
  const top = list
    .slice(0, 3)
    .map((r) => `${r.market} ${r.score}`)
    .join(' · ');
  // o bônus da semifinal depende da outra semi (Flamengo × Estudiantes): decidida, a AR pode perdê-lo
  const ar = list.find((r) => r.market === 'AR');
  return ar?.reasons?.includes('decides_final_opponent')
    ? `${list.length} mercados · ${top}`
    : warn(`${top} · AR sem "define o adversário" (outra semifinal já decidida?)`);
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

await check('Busca global: apelido da base semântica, sem acento', async () => {
  const { status, body } = await api('/v1/search?q=verdao&locale=pt-BR');
  if (status !== 200) return fail(`status ${status}`);
  const hits = Array.isArray(body) ? body : [];
  const pal = hits.find((r) => r.type === 'team' && r.id === PALMEIRAS);
  if (!pal) return fail('"verdao" não achou o Palmeiras — apelidos da base semântica fora da base?');
  const games = hits.filter((r) => r.type === 'event').length;
  return `${hits.length} resultados · Palmeiras por "${pal.matched ?? pal.name}" · ${games} jogos`;
});

await check('Home Explorar: resumo por esporte e por país', async () => {
  const { status, body } = await api('/v1/explore/summary?locale=pt-BR');
  if (status !== 200) return fail(`status ${status}`);
  const football = body?.sports?.find((s) => s.slug === 'football');
  const br = body?.countries?.find((c) => c.code === 'BR');
  if (!football?.competitions || !football.top_competitions?.length)
    return fail('futebol sem competições no resumo');
  if (!br?.main_competition) return fail('Brasil sem liga principal (config/geo na imagem da API?)');
  if (!br.top_teams?.length)
    return warn('Brasil sem clubes em destaque — base sem jogos dos últimos 12 meses?');
  if (!br.highlight) return warn('Brasil sem jogo em destaque nos próximos 7 dias');
  const teams = br.highlight.participants?.map((p) => p.name).join(' x ');
  return `${football.upcoming} jogos de futebol em 7 dias · destaque BR: ${teams} (${br.highlight.relevance?.score})`;
});

await check('Demo: páginas públicas e proteção do resto', async () => {
  // públicas: abrem sem sessão (a raiz mostra a apresentação, para filtros web e buscadores)
  for (const path of ['/login', '/', '/sobre', '/termos', '/privacidade', '/robots.txt', '/sitemap.xml']) {
    const res = await fetch(`${DEMO}${path}`, { redirect: 'manual' });
    if (res.status !== 200) return fail(`${path} sem sessão: status ${res.status} (esperado 200)`);
  }
  const about = await (await fetch(`${DEMO}/sobre`)).text();
  if (!about.includes('application/ld+json') || !about.includes('og:title'))
    return fail('/sobre sem JSON-LD ou Open Graph');
  // o resto continua exigindo login
  for (const path of ['/times', '/docs', '/ajustes', '/sobre/x']) {
    const res = await fetch(`${DEMO}${path}`, { redirect: 'manual' });
    if (res.status !== 307 && res.status !== 302)
      return fail(`${path} sem sessão deveria redirecionar para o login (status ${res.status})`);
  }
  const api = await fetch(`${DEMO}/api/galaxie/v1/sports`, { redirect: 'manual' });
  if (api.status !== 401) return fail(`API da demo sem sessão deveria responder 401 (status ${api.status})`);
  return true;
});

await check('Painel de Operação: configuração protegida e sem segredos', async () => {
  const url = `${DEMO}/api/ajustes/operacao`;
  const anon = await fetch(url, { redirect: 'manual' });
  if (anon.status !== 401) return fail(`sem sessão deveria responder 401 (status ${anon.status})`);
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) return warn('sem BETTER_AUTH_SECRET no contêiner: conteúdo não conferido');
  // mesma assinatura de apps/demo/src/lib/ops/smoke.ts (o smoke roda no contêiner da demo)
  const { createHmac } = await import('node:crypto');
  const unix = Math.floor(Date.now() / 1000);
  const mac = createHmac('sha256', secret).update(`ops-smoke:${unix}`).digest('hex');
  const res = await fetch(url, { headers: { 'x-galaxie-smoke': `${unix}.${mac}` } });
  if (res.status !== 200) return fail(`status ${res.status}`);
  const text = await res.text();
  // nenhum segredo do próprio contêiner aparece na resposta (nem a senha do banco dentro da URL)
  const dbPassword = (() => {
    try {
      return decodeURIComponent(new URL(process.env.DEMO_DATABASE_URL ?? '').password);
    } catch {
      return '';
    }
  })();
  for (const [name, value] of [
    ['BETTER_AUTH_SECRET', secret],
    ['GALAXIE_DEMO_KEY', KEY],
    ['SMTP_PASSWORD', process.env.SMTP_PASSWORD],
    ['senha do banco', dbPassword],
  ])
    // só valores longos: um segredo curto (ex.: senha do banco local) bate com qualquer texto
    if (value && value.length >= 12 && text.includes(value)) return fail(`${name} exposto na resposta`);
  const data = JSON.parse(text).data;
  const settings = data?.settings ?? [];
  if (settings.length < 40) return fail(`só ${settings.length} flags no painel`);
  const credential = /(_KEY|_SECRET|_PASSWORD|_TOKEN|_HASHES|SMTP_HOST|SMTP_USER)$/;
  const leaked = settings.filter(
    (s) => credential.test(s.key) && (s.value !== null || s.envValue !== null || s.override !== null),
  );
  if (leaked.length) return fail(`credenciais com valor: ${leaked.map((s) => s.key).join(', ')}`);
  const live = settings.find((s) => s.key === 'LIVE_FEATURED');
  const down = (data.services ?? []).filter((s) => ['ingestor', 'agents'].includes(s.service) && !s.alive);
  const summary = `${settings.length} flags · LIVE_FEATURED=${live?.value} (${live?.source})`;
  // o ingestor pode estar com escala 0 de propósito (ingestão em outro ambiente): só avisa
  return down.length ? warn(`${summary} · sem sinal de ${down.map((s) => s.service).join(', ')}`) : summary;
});

const width = Math.max(...results.map((r) => r.name.length));
for (const r of results) console.log(`${r.level.padEnd(4)}  ${r.name.padEnd(width)}  ${r.detail}`);
const fails = results.filter((r) => r.level === 'FAIL').length;
const warns = results.filter((r) => r.level === 'WARN').length;
console.log(`\n${results.length - fails - warns} ok · ${warns} aviso(s) · ${fails} falha(s)`);
process.exit(fails ? 1 : 0);
