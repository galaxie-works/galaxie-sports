#!/usr/bin/env node
/**
 * Validador do Catálogo de Conquistas, Cartas e cosméticos (docs/gamificacao/catalogo).
 *
 *   node docs/gamificacao/catalogo/_validar.mjs            # tudo
 *   node docs/gamificacao/catalogo/_validar.mjs football   # um esporte (ou `common`, `cosmeticos`)
 *
 * Aplica o que é mecânico da padronizacao.md e da regras/linguagem.md: formato, ids, Degraus, bônus, raridade,
 * caminhos do contrato de dados, três idiomas, termos proibidos. Sai com código 1 se houver erro. Avisos não barram.
 * Sem dependência: roda com o Node do repositório.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const only = process.argv[2] ?? null;

const SPORTS = [
  'football',
  'basketball',
  'nba',
  'american-football',
  'baseball',
  'hockey',
  'volleyball',
  'handball',
  'rugby',
  'afl',
  'formula-1',
  'mma',
];
const CATEGORIES = ['participation', 'hit', 'moment', 'consumption'];
const FAMILIES = [
  'predictions',
  'loyalty',
  'explorer',
  'moments',
  'knowledge',
  'community',
  'consumption',
  'collector',
  'rhythm',
  'results',
];
const RARITIES = ['common', 'special', 'rare', 'historic', 'legendary'];
const LANGS = ['pt', 'es', 'en'];
const LEGACY_IDS = new Set([
  'predictions.correct',
  'predictions.exact_score',
  'predictions.winner',
  'predictions.quantity',
  'predictions.placed',
  'loyalty.watched',
  'knowledge.trivia',
  'community.poll',
  'consumption.recap',
]);
const HIT_BONUS = [20, 40, 80, 150, 300];
const MOMENT_STEP_BONUS = [10, 20, 40, 75, 150];
const MOMENT_SINGLE_BONUS = { common: 10, special: 25, rare: 60, historic: 120, legendary: 200 };
const DATA_PREFIXES = ['event.', 'football.detail.', 'race.detail.', 'fight.detail.', 'fan.', 'program.time_zone', 'proposed.'];
const NEGATIVE_STD =
  'logos, crests, badges, brand names, sponsor marks, readable text, letters, numbers, jersey numbers, recognizable faces, real athletes, real stadiums, club colors, national flags, watermark, blurry, extra limbs, deformed hands';
const FRAME = {
  common: 'Card frame: plain slate-grey border, matte finish.',
  special: 'Card frame: brushed steel-blue border with a thin inner line.',
  rare: 'Card frame: deep violet border with faceted corners and a faint glow.',
  historic: 'Card frame: warm amber border with an engraved laurel pattern and a soft outer glow.',
  legendary: 'Card frame: iridescent prismatic border with light rays and floating particles.',
};

// a linguagem de regras (espelho do regra.schema.json, sem ajv)
const FACTS = {
  'football.goal': ['team', 'in_extra', 'min_minute', 'max_minute', 'period', 'detail', 'decisive', 'equalizer', 'winner'],
  'football.hat_trick': ['team', 'min_goals'],
  'football.penalty_missed': ['team'],
  'football.red_card': ['team'],
  'football.var_goal_disallowed': ['team'],
  'football.comeback': ['team', 'from_behind_by'],
  'football.result': ['team', 'side', 'outcome', 'extra_time', 'penalties', 'clean_sheet', 'margin_min', 'total_min', 'scoreless'],
  'game.result': ['team', 'side', 'outcome', 'overtime', 'margin_min', 'margin_max', 'shutout', 'total_min'],
  'game.comeback': ['team', 'trailing_by_min'],
  'score.result': ['team', 'side', 'outcome', 'overtime', 'shootout', 'margin_min', 'margin_max', 'total_min', 'shutout', 'sets', 'period_sweep'],
  'score.comeback': ['team', 'trailing_by_min', 'at'],
  'score.period': ['team', 'period', 'points_min', 'margin_min', 'shutout'],
  'baseball.no_hitter': ['team'],
  'race.result': ['position_max', 'places_gained_min', 'pole_to_win', 'winner_from_grid_min', 'finishers_min', 'pits_max'],
  'fight.result': ['won_type', 'round_max', 'minute_max'],
};
const FACT_SPORTS = {
  'football.': ['football'],
  'game.': ['football', 'basketball', 'nba', 'american-football', 'baseball', 'hockey', 'volleyball', 'handball', 'rugby', 'afl'],
  'score.': ['basketball', 'nba', 'american-football', 'baseball', 'hockey', 'volleyball', 'handball', 'rugby', 'afl'],
  'baseball.': ['baseball'],
  'race.': ['formula-1'],
  'fight.': ['mma'],
};
const WHERE_KEYS = ['sport', 'competition_type', 'stage', 'derby', 'favorite_playing', 'local_hour', 'weekday'];
const COUNT_KEYS = ['competition', 'country', 'sport', 'team', 'stage', 'season', 'month', 'weekday'];
const COUNT_UNITS = ['round', 'game', 'day', 'prediction'];

// termos proibidos (aposta, sorte, compra) e alerta de entidade real; comparação sem acento e sem caixa
const BET_WORDS = [
  'aposta', 'apostar', 'apuesta', 'apostar', 'cuota', 'odd', 'odds', 'bet', 'betting', 'wager', 'gamble', 'cravou a',
  'sorteio', 'sorteo', 'lottery', 'loteria', 'raffle', 'jackpot', 'loot', 'cassino', 'casino', 'bolão', 'bolao', 'quiniela',
  'comprar', 'compra', 'buy', 'purchase', 'loja', 'tienda', 'shop', 'assinatura', 'subscription',
];
const ENTITY_WORDS = [
  'nba', 'nfl', 'mlb', 'nhl', 'afl premiership', 'khl', 'fiba', 'uefa', 'conmebol', 'fifa', 'ufc', 'bellator', 'pfl',
  'libertadores', 'sudamericana', 'champions league', 'premier league', 'laliga', 'bundesliga', 'serie a', 'ligue 1',
  'brasileirao', 'brasileirão', 'paulista', 'carioca', 'copa do brasil', 'copa america', 'copa américa', 'eurocopa', 'euro ',
  'copa do mundo', 'world cup', 'mundial', 'super bowl', 'world series', 'stanley cup', 'olimp', 'olymp', 'pan-americ', 'panameric',
  'superliga', 'summer league', 'super rugby', 'six nations', 'rugby championship', 'formula 1', 'fórmula 1', 'formula one', 'f1 ',
  'flamengo', 'corinthians', 'palmeiras', 'são paulo', 'sao paulo', 'santos', 'grêmio', 'gremio', 'internacional', 'cruzeiro',
  'atlético', 'atletico', 'vasco', 'botafogo', 'fluminense', 'boca', 'river plate', 'real madrid', 'barcelona', 'barça', 'manchester',
  'liverpool', 'arsenal', 'chelsea', 'juventus', 'milan', 'inter', 'bayern', 'psg', 'lakers', 'celtics', 'warriors', 'bulls', 'knicks',
  'yankees', 'dodgers', 'red sox', 'patriots', 'cowboys', 'packers', 'maracanã', 'maracana', 'wembley', 'camp nou', 'bernabéu',
  'pelé', 'pele ', 'maradona', 'messi', 'neymar', 'ronaldo', 'ronaldinho', 'zico', 'romário', 'romario', 'jordan', 'lebron', 'kobe',
  'curry', 'brady', 'mahomes', 'gretzky', 'ovechkin', 'crosby', 'mcdavid', 'ruth', 'ohtani', 'senna', 'hamilton', 'verstappen',
  'schumacher', 'mcgregor', 'anderson silva', 'jon jones', 'khabib', 'nike', 'adidas', 'puma', 'coca', 'pepsi', 'red bull',
  'ferrari', 'mercedes', 'mclaren', 'williams', 'bradesco', 'itaú', 'itau', 'globo', 'espn', 'dazn', 'fox', 'televisa', 'mediapro',
];

const ENTITY_PREFIXES = ['olimp', 'olymp', 'pan-americ', 'panameric', 'mundial', 'superliga'];

const errors = [];
const warnings = [];
const err = (file, msg) => errors.push(`${file}: ${msg}`);
const warn = (file, msg) => warnings.push(`${file}: ${msg}`);

const norm = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const readJson = (rel) => {
  const path = join(ROOT, rel);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    err(rel, `JSON inválido: ${e.message}`);
    return null;
  }
};
const isI18n = (v) => v && typeof v === 'object' && LANGS.every((l) => typeof v[l] === 'string' && v[l].trim().length > 0);
const sortedBy = (list, key) => list.every((x, i) => i === 0 || String(list[i - 1][key]).localeCompare(String(x[key])) < 0);

function checkTexts(file, where, texts) {
  for (const [label, text] of texts) {
    if (typeof text !== 'string') continue;
    const n = ` ${norm(text)} `;
    for (const w of BET_WORDS) {
      const re = new RegExp(`[^a-z]${norm(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^a-z]`);
      if (re.test(n)) err(file, `${where} ${label}: termo proibido "${w}"`);
    }
    for (const w of ENTITY_WORDS) {
      // prefixos intencionais casam por começo; o resto, por palavra inteira
      const tail = ENTITY_PREFIXES.includes(w) ? '' : '[^a-z]';
      const re = new RegExp(`[^a-z]${norm(w.trim()).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}${tail}`);
      if (re.test(n)) warn(file, `${where} ${label}: possível entidade real "${w.trim()}" (confira)`);
    }
  }
}

function checkRule(file, id, rule, sport) {
  if (!rule || typeof rule !== 'object') return err(file, `${id}: rule ausente`);
  const { input } = rule;
  if (!['prediction', 'participation', 'moment'].includes(input)) return err(file, `${id}: rule.input inválido "${input}"`);
  const allowedTop = {
    prediction: ['input', 'kind', 'correct', 'fullHit', 'where', 'count'],
    participation: ['input', 'action', 'where', 'count'],
    moment: ['input', 'fact', 'params', 'presence', 'where', 'count'],
  }[input];
  for (const k of Object.keys(rule)) if (!allowedTop.includes(k)) err(file, `${id}: rule.${k} não existe na linguagem para input ${input}`);
  if (input === 'prediction') {
    if (rule.kind !== undefined && !['exact_score', 'winner', 'quantity'].includes(rule.kind)) err(file, `${id}: rule.kind inválido`);
    if (rule.correct !== undefined && typeof rule.correct !== 'boolean') err(file, `${id}: rule.correct precisa ser bool`);
    if (rule.fullHit !== undefined && typeof rule.fullHit !== 'boolean') err(file, `${id}: rule.fullHit precisa ser bool`);
  }
  if (input === 'participation' && !['watched', 'poll', 'trivia', 'consumption'].includes(rule.action))
    err(file, `${id}: rule.action inválido "${rule.action}"`);
  if (input === 'moment') {
    const params = FACTS[rule.fact];
    if (!params) err(file, `${id}: rule.fact desconhecido "${rule.fact}"`);
    else {
      for (const k of Object.keys(rule.params ?? {})) if (!params.includes(k)) err(file, `${id}: rule.params.${k} não existe no fato ${rule.fact}`);
      const prefix = Object.keys(FACT_SPORTS).find((p) => rule.fact.startsWith(p));
      if (prefix && sport && !FACT_SPORTS[prefix].includes(sport)) err(file, `${id}: o fato ${rule.fact} não vale para ${sport}`);
      if (sport === null && !(rule.where && Array.isArray(rule.where.sport))) warn(file, `${id}: momento comum sem where.sport (o fato limita os esportes)`);
    }
    if (rule.presence !== undefined && !['at_moment', 'game'].includes(rule.presence)) err(file, `${id}: rule.presence inválido`);
    if (rule.presence === 'at_moment' && /\.(result|comeback|no_hitter)$/.test(rule.fact ?? '')) err(file, `${id}: fato de fim de jogo pede presence "game"`);
  }
  if (rule.where) {
    for (const k of Object.keys(rule.where)) if (!WHERE_KEYS.includes(k)) err(file, `${id}: where.${k} não existe`);
    if (rule.where.sport && !rule.where.sport.every((s) => SPORTS.includes(s))) err(file, `${id}: where.sport com slug desconhecido`);
    if (rule.where.derby !== undefined && rule.where.derby !== true) err(file, `${id}: where.derby só aceita true`);
    if (rule.where.local_hour && !(/^\d\d:\d\d$/.test(rule.where.local_hour.from) && /^\d\d:\d\d$/.test(rule.where.local_hour.to)))
      err(file, `${id}: where.local_hour precisa de from/to HH:MM`);
  }
  if (rule.count) {
    const c = rule.count;
    if (!['each', 'distinct', 'streak'].includes(c.mode)) err(file, `${id}: count.mode inválido`);
    if (c.mode === 'distinct' && !COUNT_KEYS.includes(c.key)) err(file, `${id}: count.key inválido para distinct`);
    if (c.mode === 'streak' && !COUNT_UNITS.includes(c.unit)) err(file, `${id}: count.unit inválido para streak`);
  }
}

function checkAchievements(file, list, sport) {
  if (!Array.isArray(list)) return err(file, 'precisa ser uma lista');
  if (!sortedBy(list, 'id')) err(file, 'lista fora de ordem por id');
  const ids = new Set();
  const stepKeys = new Map(); // card_key -> { category, stepped, step, steps }
  for (const a of list) {
    const id = a.id ?? '(sem id)';
    if (ids.has(id)) err(file, `${id}: id repetido`);
    ids.add(id);
    if (!/^[a-z0-9_]+(\.[a-z0-9_]+)+$/.test(id) || id.length > 80) err(file, `${id}: id fora do padrão`);
    // o id segue a restrição do banco (sem hífen): o slug com hífen vira sublinhado no prefixo
    const expectedPrefix = (sport ?? 'common').replace(/-/g, '_');
    if (!LEGACY_IDS.has(id) && !id.startsWith(`${expectedPrefix}.`)) err(file, `${id}: id precisa começar com "${expectedPrefix}."`);
    if (!LEGACY_IDS.has(id) && id.split('.').length !== 3) err(file, `${id}: id precisa ter 3 partes (<esporte|common>.<familia>.<nome>)`);
    if ((a.sport ?? null) !== sport) err(file, `${id}: sport precisa ser ${JSON.stringify(sport)}`);
    if (!CATEGORIES.includes(a.category)) err(file, `${id}: category inválida`);
    if (!FAMILIES.includes(a.family)) err(file, `${id}: family "${a.family}" fora da lista`);
    if (!LEGACY_IDS.has(id) && a.family && id.split('.')[1] !== a.family) err(file, `${id}: a 2ª parte do id precisa ser a family (${a.family})`);
    if (typeof a.collection !== 'string' || !a.collection) err(file, `${id}: collection ausente`);
    if (typeof a.stepped !== 'boolean' || typeof a.seasonal !== 'boolean' || typeof a.active !== 'boolean') err(file, `${id}: stepped/seasonal/active precisam ser bool`);
    if (!a.active && !(typeof a.inactive_reason === 'string' && a.inactive_reason.trim())) err(file, `${id}: inativa sem inactive_reason`);
    if (a.active && a.inactive_reason) err(file, `${id}: ativa com inactive_reason`);
    if (!isI18n(a.name)) err(file, `${id}: name precisa de pt/es/en`);
    else for (const l of LANGS) if (a.name[l].length > 32) err(file, `${id}: name.${l} passa de 32 caracteres`);
    if (!isI18n(a.description)) err(file, `${id}: description precisa de pt/es/en`);
    else for (const l of LANGS) if (a.description[l].length > 120) err(file, `${id}: description.${l} passa de 120 caracteres`);
    if (typeof a.real_world_frequency !== 'string' || !a.real_world_frequency.trim()) err(file, `${id}: real_world_frequency ausente`);
    if (!Array.isArray(a.requires_data) || a.requires_data.length === 0) err(file, `${id}: requires_data vazio`);
    else {
      for (const d of a.requires_data) if (!DATA_PREFIXES.some((p) => String(d).startsWith(p))) err(file, `${id}: requires_data "${d}" fora do contrato`);
      if (a.requires_data.some((d) => String(d).startsWith('proposed.')) && a.active) err(file, `${id}: usa proposed.* e está ativa`);
    }
    checkRule(file, id, a.rule, sport);
    if (a.rule?.input === 'moment' && a.category !== 'moment') err(file, `${id}: input moment pede category moment`);
    if (a.category === 'moment' && a.rule?.input !== 'moment') err(file, `${id}: category moment pede input moment`);
    if (a.category === 'hit' && !(a.rule?.input === 'prediction' && a.rule.correct === true)) err(file, `${id}: category hit pede prediction com correct true`);
    // Degraus
    const steps = Array.isArray(a.steps) ? a.steps : [];
    if (!steps.length) err(file, `${id}: sem steps`);
    if (a.stepped && (steps.length < 2 || steps.length > 5)) err(file, `${id}: Conquista com Degraus pede 2 a 5 steps`);
    if (a.stepped === false && !(steps.length === 1 && steps[0].threshold === 1)) err(file, `${id}: Conquista única pede 1 step com threshold 1`);
    if (a.stepped && a.category !== 'moment' && steps.length !== 5) warn(file, `${id}: Conquista de contagem com ${steps.length} Degraus (o padrão são 5)`);
    steps.forEach((s, i) => {
      if (s.step !== i + 1) err(file, `${id}: step ${i + 1} fora de ordem`);
      if (!Number.isInteger(s.threshold) || s.threshold < 1) err(file, `${id}: threshold do Degrau ${i + 1} inválido`);
      if (i > 0 && s.threshold <= steps[i - 1].threshold) err(file, `${id}: Degrau ${i + 1} precisa de threshold maior que o anterior`);
      if (i > 0 && steps.length === 5 && s.threshold < steps[i - 1].threshold * 2) warn(file, `${id}: Degrau ${i + 1} cresce menos de 2x (padrão 2,5 a 3x)`);
      if (s.card_key !== `${id}.${i + 1}`) err(file, `${id}: card_key do Degrau ${i + 1} precisa ser "${id}.${i + 1}"`);
      if (!Number.isInteger(s.bonus_points) || s.bonus_points < 0) err(file, `${id}: bonus_points do Degrau ${i + 1} inválido`);
      if ((a.category === 'participation' || a.category === 'consumption') && s.bonus_points !== 0) err(file, `${id}: ${a.category} não dá bônus`);
      if (a.category === 'hit' && s.bonus_points !== HIT_BONUS[i]) err(file, `${id}: bônus de acerto do Degrau ${i + 1} precisa ser ${HIT_BONUS[i]}`);
      if (a.category === 'moment' && a.stepped && s.bonus_points !== MOMENT_STEP_BONUS[i]) err(file, `${id}: bônus de momento do Degrau ${i + 1} precisa ser ${MOMENT_STEP_BONUS[i]}`);
      stepKeys.set(s.card_key, { category: a.category, stepped: a.stepped, step: i + 1, steps: steps.length, id });
    });
    checkTexts(file, id, [
      ...LANGS.map((l) => [`name.${l}`, a.name?.[l]]),
      ...LANGS.map((l) => [`description.${l}`, a.description?.[l]]),
    ]);
  }
  return stepKeys;
}

function checkCards(file, list, stepKeys, sport) {
  if (!Array.isArray(list)) return err(file, 'precisa ser uma lista');
  if (!sortedBy(list, 'card_key')) err(file, 'lista fora de ordem por card_key');
  const seen = new Set();
  for (const c of list) {
    const k = c.card_key ?? '(sem card_key)';
    if (seen.has(k)) err(file, `${k}: card_key repetido`);
    seen.add(k);
    const step = stepKeys.get(k);
    if (!step) err(file, `${k}: não existe Degrau com esse card_key no catálogo de ${sport ?? 'common'}`);
    if (!RARITIES.includes(c.rarity)) err(file, `${k}: rarity inválida`);
    if (typeof c.collection !== 'string' || !c.collection) err(file, `${k}: collection ausente`);
    if (!isI18n(c.name)) err(file, `${k}: name precisa de pt/es/en`);
    else for (const l of LANGS) if (c.name[l].length > 32) err(file, `${k}: name.${l} passa de 32 caracteres`);
    if (!isI18n(c.flavor)) err(file, `${k}: flavor precisa de pt/es/en`);
    else for (const l of LANGS) if (c.flavor[l].length > 80) err(file, `${k}: flavor.${l} passa de 80 caracteres`);
    if (typeof c.art_prompt !== 'string' || c.art_prompt.length < 80) err(file, `${k}: art_prompt curto demais`);
    else {
      if (step && RARITIES.includes(c.rarity) && !c.art_prompt.includes(FRAME[c.rarity])) err(file, `${k}: art_prompt sem a frase padrão da moldura ${c.rarity}`);
      if (!/vertical trading card/i.test(c.art_prompt)) err(file, `${k}: art_prompt sem o enquadramento padrão (vertical trading card)`);
    }
    if (typeof c.art_negative_prompt !== 'string' || !c.art_negative_prompt.startsWith(NEGATIVE_STD)) err(file, `${k}: art_negative_prompt precisa começar pelo padrão`);
    if (step) {
      // raridade mecânica da Conquista de contagem
      if (step.stepped) {
        const expected =
          step.step === 1 ? 'common' : step.step <= 3 ? 'special' : step.step === 4 ? 'rare' : step.category === 'hit' || step.category === 'moment' ? 'legendary' : 'historic';
        if (step.steps === 5 && c.rarity !== expected) err(file, `${k}: raridade do Degrau ${step.step} de ${step.category} precisa ser ${expected}`);
      } else if (step.category === 'moment') {
        // bônus da Conquista única pela raridade da Carta
        const ach = achievementsByKey.get(k);
        if (ach && ach.steps[0].bonus_points !== MOMENT_SINGLE_BONUS[c.rarity])
          err(file, `${k}: Conquista única ${c.rarity} pede bonus_points ${MOMENT_SINGLE_BONUS[c.rarity]} (tem ${ach.steps[0].bonus_points})`);
      }
    }
    checkTexts(file, k, [
      ...LANGS.map((l) => [`name.${l}`, c.name?.[l]]),
      ...LANGS.map((l) => [`flavor.${l}`, c.flavor?.[l]]),
      ['art_prompt', c.art_prompt],
    ]);
  }
  for (const k of stepKeys.keys()) if (!seen.has(k)) err(file, `falta a Carta ${k}`);
}

const achievementsByKey = new Map();
const summary = {};
const allCollections = new Map();
const scopes = new Map(); // esporte -> { collections, cards }

function checkSport(sport) {
  const name = sport ?? 'common';
  const aFile = `conquistas/${name}.json`;
  const cFile = `cartas/${name}.json`;
  const list = readJson(aFile);
  if (!list) return err(aFile, 'arquivo ausente');
  for (const a of list) for (const s of a.steps ?? []) achievementsByKey.set(s.card_key, a);
  const stepKeys = checkAchievements(aFile, list, sport);
  const cards = readJson(cFile);
  if (!cards) err(cFile, 'arquivo ausente');
  else if (stepKeys) checkCards(cFile, cards, stepKeys, sport);
  for (const a of list) allCollections.set(a.collection, (allCollections.get(a.collection) ?? 0) + 1);
  scopes.set(name, {
    collections: new Set(list.map((a) => a.collection)),
    cards: list.flatMap((a) => (a.steps ?? []).map((s) => s.card_key)),
  });
  const active = list.filter((a) => a.active).length;
  const byRarity = {};
  for (const c of cards ?? []) byRarity[c.rarity] = (byRarity[c.rarity] ?? 0) + 1;
  summary[name] = { conquistas: list.length, ativas: active, inativas: list.length - active, cartas: (cards ?? []).length, raridade: byRarity };
}

/**
 * Coleções: `cartas/colecoes.json` (consolidado) ou `cartas/colecoes-<esporte>.json` (por pacote). Toda Coleção usada
 * no catálogo validado existe; toda Carta do catálogo está em exatamente uma Coleção; o `unlock` aponta cosmético.
 */
function checkCollections(file, scopeCollections, scopeCards, onlyScope = false) {
  const all = readJson(file);
  if (!all) return warn(file, 'arquivo ausente');
  if (!Array.isArray(all)) return err(file, 'precisa ser uma lista');
  const wanted = new Set(scopeCollections);
  // validando um pacote só contra o consolidado: olha só as Coleções desse pacote
  const list = onlyScope ? all.filter((c) => wanted.has(c.id)) : all;
  if (!sortedBy(list, 'id')) err(file, 'lista fora de ordem por id');
  const membership = new Map();
  const ids = new Set();
  for (const col of list) {
    if (ids.has(col.id)) err(file, `${col.id}: id repetido`);
    ids.add(col.id);
    if (!/^[a-z0-9_]+\.[a-z0-9_]+$/.test(col.id ?? '')) err(file, `${col.id}: id fora do padrão <esporte|common>.<nome> (sem hífen)`);
    if (!isI18n(col.name) || !isI18n(col.description)) err(file, `${col.id}: name/description precisam de pt/es/en`);
    if (!Array.isArray(col.cards) || col.cards.length < 2) err(file, `${col.id}: precisa listar pelo menos 2 Cartas`);
    else
      for (const k of col.cards) {
        if (!achievementsByKey.has(k)) err(file, `${col.id}: Carta ${k} não existe`);
        membership.set(k, (membership.get(k) ?? 0) + 1);
      }
    const u = col.unlock;
    if (!u || !(typeof u.frame === 'string' || typeof u.background === 'string' || typeof u.title === 'string'))
      err(file, `${col.id}: unlock precisa apontar frame, background ou title`);
    checkTexts(file, col.id, [...LANGS.map((l) => [`name.${l}`, col.name?.[l]]), ...LANGS.map((l) => [`description.${l}`, col.description?.[l]])]);
  }
  for (const id of wanted) if (!ids.has(id)) err(file, `a Coleção ${id} é usada no catálogo e não está definida`);
  for (const [k, n] of membership) if (n > 1) err(file, `a Carta ${k} está em ${n} Coleções (precisa ser uma só)`);
  for (const k of scopeCards) if (!membership.has(k)) warn(file, `a Carta ${k} não está em nenhuma Coleção`);
  summary[file] = { colecoes: list.length };
  if (!onlyScope && !sortedBy(all, 'id')) err(file, 'lista fora de ordem por id');
}

function checkCosmetics() {
  const files = ['niveis', 'molduras', 'fundos', 'titulos'];
  for (const f of files) {
    const file = `cosmeticos/${f}.json`;
    const list = readJson(file);
    if (!list) {
      warn(file, 'arquivo ausente');
      continue;
    }
    if (!sortedBy(list, 'id')) err(file, 'lista fora de ordem por id');
    const seen = new Set();
    for (const item of list) {
      const id = item.id ?? '(sem id)';
      if (seen.has(id)) err(file, `${id}: id repetido`);
      seen.add(id);
      if (!isI18n(item.name)) err(file, `${id}: name precisa de pt/es/en`);
      const u = item.unlock;
      if (f !== 'niveis') {
        if (!u || typeof u !== 'object') err(file, `${id}: unlock ausente`);
        else if (!(Number.isInteger(u.level) || typeof u.collection === 'string' || (typeof u.achievement === 'string' && Number.isInteger(u.step))))
          err(file, `${id}: unlock precisa ser level, collection ou achievement+step`);
        else if (u.collection && allCollections.size && !allCollections.has(u.collection)) err(file, `${id}: Coleção ${u.collection} não existe`);
        else if (u.achievement && achievementsByKey.size && !achievementsByKey.has(`${u.achievement}.${u.step}`)) err(file, `${id}: Degrau ${u.achievement}.${u.step} não existe`);
        if (typeof item.animated !== 'boolean') err(file, `${id}: animated precisa ser bool`);
        if (item.animated && !(typeof item.animation === 'string' && item.animation.length > 10)) err(file, `${id}: animado sem descrição da animação`);
      }
      if (f === 'molduras' || f === 'fundos') {
        if (typeof item.art_prompt !== 'string' || item.art_prompt.length < 80) err(file, `${id}: art_prompt curto demais`);
        if (typeof item.art_negative_prompt !== 'string' || !item.art_negative_prompt.startsWith(NEGATIVE_STD)) err(file, `${id}: art_negative_prompt precisa começar pelo padrão`);
      }
      checkTexts(file, id, [...LANGS.map((l) => [`name.${l}`, item.name?.[l]]), ['art_prompt', item.art_prompt]]);
    }
    summary[`cosmeticos.${f}`] = { itens: list.length };
  }
}

// ─── execução ───
const targets = only ? [only] : ['common', ...SPORTS];
for (const t of targets) {
  if (t === 'cosmeticos') continue;
  checkSport(t === 'common' ? null : t);
}
// Coleções: um pacote só lê o seu `colecoes-<nome>.json`; a validação completa lê o consolidado, se existir, senão cada um
if (only && only !== 'cosmeticos') {
  const scope = scopes.get(only);
  const consolidated = existsSync(join(ROOT, 'cartas/colecoes.json'));
  if (scope) checkCollections(consolidated ? 'cartas/colecoes.json' : `cartas/colecoes-${only}.json`, scope.collections, scope.cards, consolidated);
} else if (!only) {
  if (existsSync(join(ROOT, 'cartas/colecoes.json'))) {
    checkCollections('cartas/colecoes.json', allCollections.keys(), [...scopes.values()].flatMap((s) => s.cards));
  } else {
    for (const [name, scope] of scopes) checkCollections(`cartas/colecoes-${name}.json`, scope.collections, scope.cards);
  }
}
if (!only || only === 'cosmeticos') checkCosmetics();

if (!only) {
  const existing = readdirSync(join(ROOT, 'conquistas')).filter((f) => f.endsWith('.json'));
  for (const f of existing) if (!targets.includes(f.replace('.json', ''))) warn(`conquistas/${f}`, 'arquivo de esporte desconhecido');
}

console.log(JSON.stringify(summary, null, 2));
for (const w of warnings) console.log(`AVISO ${w}`);
for (const e of errors) console.log(`ERRO  ${e}`);
console.log(`\n${errors.length} erro(s), ${warnings.length} aviso(s)`);
process.exit(errors.length ? 1 : 0);
