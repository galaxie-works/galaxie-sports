/**
 * Smoke test pós-deploy da stack da VPS: confere, pela API pública e pela demo, que cada funcionalidade
 * entregue responde com DADOS — não só 200. Nasceu de bugs que só apareciam em produção e em silêncio
 * (regulamentos fora da imagem → tags vazias; glossário vazio; base de dados defasada).
 *
 * Roda dentro do contêiner `demo` (tem a chave da demo e a URL interna da API):
 *   docker compose exec -T demo node - < smoke.mjs
 * FAIL = funcionalidade quebrada (código/imagem/config) → sai com 1. WARN = dado incompleto (sync,
 * cota, IA) → não derruba o deploy, mas aparece no relatório.
 *
 * Com DEPLOY_CANDIDATE=on, o deploy também roda este smoke ANTES da troca, no `demo-candidate` (a API e a demo
 * novas, sem tráfego; README › Candidato), com SMOKE_PHASE=candidate. Ali o pós-deploy ainda não rodou: a base
 * semântica, os nomes, a importância e o cache são os da versão no ar. Check novo que depende do pós-deploy deve
 * devolver `afterPostDeploy(...)` em vez de `fail(...)`: vira WARN no candidato e segue FAIL depois da troca.
 */
const API = process.env.GALAXIE_API_URL ?? 'http://api:8080';
const KEY = process.env.GALAXIE_DEMO_KEY ?? '';
const DEMO = process.env.SMOKE_DEMO_URL ?? 'http://127.0.0.1:3000';
// página de manutenção (serviço maintenance): 8080 = HTML dos hosts da demo, 8081 = problem+json do host da API
const MAINT_SITE = process.env.SMOKE_MAINTENANCE_SITE_URL ?? 'http://maintenance:8080';
const MAINT_API = process.env.SMOKE_MAINTENANCE_API_URL ?? 'http://maintenance:8081';

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
// dado que só existe depois do pós-deploy (seed semântico, nomes, importância): no candidato, ainda não
const CANDIDATE = process.env.SMOKE_PHASE === 'candidate';
const afterPostDeploy = (detail) =>
  CANDIDATE ? warn(`${detail} (candidato: antes do pós-deploy)`) : fail(detail);
if (CANDIDATE) console.log('smoke no candidato (antes da troca e do pós-deploy)');

await check('API /health', async () => {
  const res = await fetch(`${API}/health`);
  return res.ok ? true : fail(`status ${res.status}`);
});

await check('Página de manutenção (503 do Traefik quando demo ou API saem do ar)', async () => {
  // O serviço maintenance só aparece para o usuário durante um deploy ou reinício; aqui, pela rede da stack, confere
  // que ele está no ar e responde o 503 certo. Os routers dele no Traefik (prioridade 1) se conferem de fora: README.
  const get = (url) =>
    fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(5000) }).catch((err) => {
      throw new Error(`contêiner maintenance fora do ar? ${url}: ${err.cause?.code ?? err.message}`);
    });
  const nocache = (res) =>
    res.headers.get('retry-after') === '30' && res.headers.get('cache-control') === 'no-store';
  const site = await get(`${MAINT_SITE}/competicoes/brasileirao-serie-a`);
  const html = await site.text();
  if (site.status !== 503) return fail(`página: status ${site.status} (esperado 503)`);
  if (!nocache(site)) return fail('página sem Retry-After: 30 e Cache-Control: no-store');
  if (!site.headers.get('content-type')?.startsWith('text/html') || !html.includes('Galaxie Sports'))
    return fail('página sem o HTML de manutenção');
  const api = await get(`${MAINT_API}/health`);
  const problem = await api.json().catch(() => null);
  if (api.status !== 503) return fail(`API: status ${api.status} (esperado 503)`);
  if (!nocache(api)) return fail('API sem Retry-After: 30 e Cache-Control: no-store');
  if (
    !api.headers.get('content-type')?.startsWith('application/problem+json') ||
    problem?.code !== 'MAINTENANCE'
  )
    return fail('API sem o problem+json MAINTENANCE');
  return '503 em HTML (demo) e em problem+json (API), Retry-After: 30';
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
  if (!pal)
    return afterPostDeploy('"verdao" não achou o Palmeiras — apelidos da base semântica fora da base?');
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

await check('Lendas da F1 (carrossel "Legendary")', async () => {
  const { status, body } = await api('/v1/sports/formula-1/legends?locale=pt-BR');
  if (status !== 200) return fail(`status ${status}`);
  // `api()` já devolve o `data` da resposta
  const legends = Array.isArray(body) ? body : [];
  if (!legends.length) return fail('nenhuma lenda — F1DB fora da base?');
  if (legends.some((l) => l.highlight?.car?.credit?.share_alike))
    return fail('carro CC BY-SA no fundo de um card');
  const withCar = legends.filter((l) => l.highlight?.car).length;
  if (!withCar)
    return warn(`${legends.length} lendas, nenhuma com o carro ao fundo — acervo da Commons importado?`);
  return `${legends.length} lendas (1ª: ${legends[0].name}, ${legends[0].titles.length} títulos) · ${withCar} com o carro ao fundo`;
});

await check('Agenda conta os mesmos jogos que a home', async () => {
  // a agenda tem `data` (os jogos do dia): lida inteira, sem o atalho de `api()` para `data`
  const [summary, res] = await Promise.all([
    api('/v1/explore/summary?locale=pt-BR'),
    fetch(`${API}/v1/explore/agenda?locale=pt-BR&market=BR&limit=1`, { headers: { 'x-galaxie-key': KEY } }),
  ]);
  if (res.status !== 200) return fail(`agenda: status ${res.status}`);
  const agenda = await res.json();
  const home = (summary.body?.sports ?? []).reduce((n, s) => n + (s.upcoming ?? 0), 0);
  const total = agenda.total ?? -1;
  const days = (agenda.days ?? []).reduce((n, d) => n + d.count, 0);
  if (days !== total) return fail(`agenda: soma dos dias ${days} ≠ total ${total}`);
  // os dois caches (60 s) podem estar alguns jogos defasados entre si; diferença grande é consulta divergente
  if (Math.abs(home - total) > Math.max(3, home * 0.02))
    return fail(`home ${home} × agenda ${total} jogos nos próximos 7 dias`);
  if (home !== total) return warn(`home ${home} × agenda ${total} (caches de 60 s fora de fase)`);
  return `${total} jogos nos próximos 7 dias, na home e na agenda`;
});

await check('Demo: páginas públicas e proteção do resto', async () => {
  // públicas: abrem sem sessão (a raiz mostra a apresentação, para filtros web e buscadores)
  for (const path of [
    '/login',
    '/',
    '/sobre',
    '/termos',
    '/privacidade',
    '/robots.txt',
    '/sitemap.xml',
    '/flags/br.svg',
    '/crests/palmeiras.png',
    '/exemplo/jogo',
  ]) {
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

await check('Demo: páginas públicas sem termos internos', async () => {
  // o que só existe no app logado e na operação: fornecedor de dados, provedores de IA, chaves de flag
  // do painel (MAIÚSCULAS_COM_SUBLINHADO, ex.: LIVE_FEATURED) e endereços da rede interna
  const internal = [
    /api-?sports/i,
    /api-football/i,
    /openai/i,
    /anthropic/i,
    /gemini/i,
    // segmentos de 2+ caracteres e fora de token com hífen: o build ID do Next no payload do React
    // (`"b":"u-K_A-rYEK…"`, aleatório a cada build) casava com `K_A` e reprovava o deploy (30/10/2026)
    /(?<![\w-])[A-Z][A-Z0-9]+(?:_[A-Z0-9]{2,})+(?![\w-])/,
    /192\.168\.|\blocalhost\b|\bapi:8080\b/,
  ];
  const found = [];
  for (const path of ['/sobre', '/exemplo/jogo'])
    for (const lang of ['pt-BR', 'en', 'es-AR']) {
      const html = await (await fetch(`${DEMO}${path}`, { headers: { 'accept-language': lang } })).text();
      for (const re of internal) {
        const hit = html.match(re);
        if (hit) found.push(`${path} (${lang}): ${hit[0]}`);
      }
    }
  return found.length ? fail(found.slice(0, 5).join(' · ')) : true;
});

await check('Demo: links antigos de esporte levam à família', async () => {
  // o menu agrupa por família (Basquete com a NBA, Automobilismo com a F1): /esportes/<esporte da API>
  // guardado em favoritos e links continua chegando, com redirecionamento permanente e a query
  for (const [from, to] of [
    ['/esportes/nba', '/esportes/basquete#nba'],
    ['/esportes/formula-1?temporada=2024', '/esportes/automobilismo?temporada=2024'],
    ['/esportes/football', '/esportes/futebol'],
  ]) {
    const res = await fetch(`${DEMO}${from}`, { redirect: 'manual' });
    const location = res.headers.get('location') ?? '';
    if (res.status !== 308 || !location.endsWith(to))
      return fail(`${from}: status ${res.status} → ${location || '(sem location)'} (esperado 308 → ${to})`);
  }
  return true;
});

await check('Builder: registry público dos widgets e painel do cliente protegido', async () => {
  // id bem formado que não existe: a rota é pública (sem redirecionar para o login) e responde 404 em JSON
  const missing = '00000000-0000-7000-8000-000000000000';
  const res = await fetch(`${DEMO}/r/${missing}.json`, { redirect: 'manual' });
  if (res.status === 307 || res.status === 302)
    return fail('/r/<id>.json redireciona para o login (rota não é pública)');
  if (res.status !== 404)
    return fail(`/r/<id inexistente>.json deveria responder 404 (status ${res.status})`);
  if (!res.headers.get('content-type')?.includes('application/json')) return fail('404 do registry sem JSON');
  for (const path of ['/cliente', '/cliente/builder']) {
    const page = await fetch(`${DEMO}${path}`, { redirect: 'manual' });
    if (page.status !== 307 && page.status !== 302)
      return fail(`${path} sem sessão deveria redirecionar para o login (status ${page.status})`);
  }
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
