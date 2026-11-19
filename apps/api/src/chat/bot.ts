/**
 * Detecção de robô no Chat ao vivo (#1290). O anti-flood (#1287) segura enxurrada e repetição por pessoa; aqui ficam
 * os sinais de máquina e de rede de contas, pela decisão do Wagner (18/11): caso claro trava o envio e vai para a fila
 * humana; dúvida só sinaliza (publica com `suspect`, vai para a Cosmos e a fila).
 *
 * - **Ritmo de máquina**: as últimas `CADENCE_SAMPLES` mensagens da pessoa com intervalos quase iguais (variação
 *   abaixo de `CADENCE_MAX_CV`) e curtos (média até `CADENCE_MAX_GAP_MS`) é sinal. Só **trava** (caso claro) quando é
 *   mecânico de verdade: desvio abaixo de `CLEAR_MAX_SD_MS`, média de pelo menos `CLEAR_MIN_GAP_MS` (rajada é trabalho
 *   do anti-flood) e fora do degrau do modo lento (quem reenvia assim que o modo lento libera manda a cada N s exatos,
 *   e é gente). Quem verificou a idade com documento (`verified`, #1109) nunca é travado. A trava vale
 *   `BOT_BLOCK_MS` em todas as salas do cliente.
 * - **Vários Perfis da mesma Conta na mesma sala** (dúvida): `ACCOUNT_PROFILES` ou mais em `SIGNAL_WINDOW_MS`.
 * - **O mesmo link por Perfis diferentes** (dúvida): `LINK_PROFILES` ou mais Perfis com o mesmo link (domínio e
 *   caminho) em `SIGNAL_WINDOW_MS`. Link fora da lista o filtro já barra.
 *
 * Texto igual entre Perfis diferentes não é sinal: torcida organizada canta o mesmo grito.
 *
 * Limitação: a trava vive no Valkey; a moderação decidir que era pessoa não destrava antes dos 30 min.
 */
import type { Redis } from 'ioredis';

export const CADENCE_SAMPLES = 8;
export const CADENCE_MAX_CV = 0.08;
export const CADENCE_MAX_GAP_MS = 20_000;
export const CLEAR_MAX_SD_MS = 250;
export const CLEAR_MIN_GAP_MS = 1_000;
/** Folga acima do modo lento em que o ritmo regular é de gente reenviando no limite. */
export const SLOW_MODE_SLACK_MS = 3_000;
export const BOT_BLOCK_MS = 30 * 60_000;
export const SIGNAL_WINDOW_MS = 10 * 60_000;
export const ACCOUNT_PROFILES = 3;
export const LINK_PROFILES = 3;
/** Links por mensagem que entram na conta. */
const MAX_LINKS = 5;
/** Pessoas e chaves acompanhadas na versão em memória antes de uma faxina. */
const MEMORY_SWEEP_AT = 20_000;

export type BotSignal = 'bot_cadence' | 'bot_shared_account' | 'bot_shared_link';

export interface BotInput {
  tenantId: string;
  roomId: string;
  profileId: string;
  accountId: string;
  /** Links da mensagem já normalizados (domínio e caminho). */
  links: readonly string[];
  /** Verificou a idade com documento: nunca travado, só sinalizado. */
  verified: boolean;
  /** Modo lento da sala em ms (0 = sem). */
  slowModeMs: number;
  now: number;
}

export interface BotVerdict {
  /** Está travado: em quantos ms volta (0 = livre). */
  blockedMs: number;
  /** Travou agora, por esta mensagem (abrir caso na fila). */
  blockedNow: boolean;
  signals: BotSignal[];
}

interface Cadence {
  signal: boolean;
  clear: boolean;
}

/** Ritmo de máquina: o sinal (intervalos curtos e quase iguais) e o caso claro (mecânico de verdade). */
export function cadenceOf(times: readonly number[], slowModeMs = 0): Cadence {
  const none = { signal: false, clear: false };
  if (times.length < CADENCE_SAMPLES) return none;
  const sorted = [...times].sort((a, b) => a - b).slice(-CADENCE_SAMPLES);
  const gaps = sorted.slice(1).map((t, i) => t - sorted[i]!);
  const mean = gaps.reduce((s, g) => s + g, 0) / gaps.length;
  if (mean <= 0 || mean > CADENCE_MAX_GAP_MS) return none;
  const sd = Math.sqrt(gaps.reduce((s, g) => s + (g - mean) ** 2, 0) / gaps.length);
  if (sd / mean >= CADENCE_MAX_CV) return none;
  const slowStep = slowModeMs > 0 && mean <= slowModeMs + SLOW_MODE_SLACK_MS;
  return { signal: true, clear: sd < CLEAR_MAX_SD_MS && mean >= CLEAR_MIN_GAP_MS && !slowStep };
}

/** Sinal de ritmo de máquina (compatível com os testes de unidade). */
export const machineCadence = (times: readonly number[]): boolean => cadenceOf(times).signal;

function verdict(input: BotInput, times: number[], accountProfiles: number, linkProfiles: number[]) {
  const signals: BotSignal[] = [];
  const cadence = cadenceOf(times, input.slowModeMs);
  if (cadence.signal) signals.push('bot_cadence');
  if (accountProfiles >= ACCOUNT_PROFILES) signals.push('bot_shared_account');
  if (linkProfiles.some((n) => n >= LINK_PROFILES)) signals.push('bot_shared_link');
  return { block: cadence.clear && !input.verified, signals };
}

// KEYS: bloqueio, tempos, perfis da conta na sala, perfis de cada link… ARGV: agora, amostras, janela, perfil.
// Os conjuntos são ZSET com o horário: cada Perfil sai sozinho depois da janela (o TTL da chave só limpa o resto)
const CHECK_SCRIPT = `
local left = redis.call('PTTL', KEYS[1])
if left > 0 then return {left} end
local now = tonumber(ARGV[1])
local win = tonumber(ARGV[3])
redis.call('LPUSH', KEYS[2], ARGV[1])
redis.call('LTRIM', KEYS[2], 0, tonumber(ARGV[2]) - 1)
redis.call('PEXPIRE', KEYS[2], win)
local out = {0, redis.call('LRANGE', KEYS[2], 0, -1)}
for i = 3, #KEYS do
  redis.call('ZADD', KEYS[i], now, ARGV[4])
  redis.call('ZREMRANGEBYSCORE', KEYS[i], '-inf', now - win)
  redis.call('PEXPIRE', KEYS[i], win)
  out[#out + 1] = redis.call('ZCARD', KEYS[i])
end
return out`;

// KEYS: bloqueio, tempos. ARGV: bloqueio ms. Só quem grava o bloqueio (NX) abre o caso.
const BLOCK_SCRIPT = `
if redis.call('SET', KEYS[1], '1', 'NX', 'PX', tonumber(ARGV[1])) then
  redis.call('DEL', KEYS[2])
  return 1
end
return 0`;

export class RedisBotGuard implements BotGuard {
  constructor(
    private readonly redis: Redis,
    private readonly prefix = 'gs:',
  ) {}

  async check(input: BotInput): Promise<BotVerdict> {
    // hash tag por cliente: as chaves do mesmo script ficam no mesmo slot num cluster
    const base = `${this.prefix}chat:bot:{${input.tenantId}}`;
    const who = `${base}:p:${input.profileId}`;
    const links = [...new Set(input.links)].slice(0, MAX_LINKS);
    const res = (await this.redis.eval(
      CHECK_SCRIPT,
      3 + links.length,
      `${who}:block`,
      `${who}:t`,
      `${base}:a:${input.roomId}:${input.accountId}`,
      ...links.map((l) => `${base}:l:${l}`),
      input.now,
      CADENCE_SAMPLES,
      SIGNAL_WINDOW_MS,
      input.profileId,
    )) as [number, string[]?, ...number[]];
    if (Number(res[0]) > 0) return { blockedMs: Number(res[0]), blockedNow: false, signals: [] };
    const times = (res[1] ?? []).map(Number);
    const [accountProfiles = 0, ...linkCounts] = res.slice(2).map(Number);
    const v = verdict(input, times, accountProfiles, linkCounts);
    if (!v.block) return { blockedMs: 0, blockedNow: false, signals: v.signals };
    const won = Number(await this.redis.eval(BLOCK_SCRIPT, 2, `${who}:block`, `${who}:t`, BOT_BLOCK_MS));
    if (won === 1) return { blockedMs: BOT_BLOCK_MS, blockedNow: true, signals: v.signals };
    // outra instância travou no mesmo instante: esta só recusa (o caso é dela)
    const left = Number(await this.redis.pttl(`${who}:block`));
    return { blockedMs: left > 0 ? left : BOT_BLOCK_MS, blockedNow: false, signals: v.signals };
  }
}

export interface BotGuard {
  check(input: BotInput): Promise<BotVerdict>;
}

/** O mesmo desenho em memória, local à instância (desenvolvimento e testes). */
export class MemoryBotGuard implements BotGuard {
  private readonly blocks = new Map<string, number>();
  private readonly times = new Map<string, number[]>();
  private readonly sets = new Map<string, Map<string, number>>();

  async check(input: BotInput): Promise<BotVerdict> {
    const { now } = input;
    if (this.blocks.size + this.times.size + this.sets.size > MEMORY_SWEEP_AT) this.sweep(now);
    const who = `${input.tenantId}:${input.profileId}`;
    const until = this.blocks.get(who) ?? 0;
    if (until > now) return { blockedMs: until - now, blockedNow: false, signals: [] };
    this.blocks.delete(who);
    const times = [now, ...(this.times.get(who) ?? []).filter((t) => now - t < SIGNAL_WINDOW_MS)].slice(
      0,
      CADENCE_SAMPLES,
    );
    this.times.set(who, times);
    const count = (key: string) => {
      const set = this.sets.get(key) ?? new Map<string, number>();
      for (const [p, at] of set) if (now - at >= SIGNAL_WINDOW_MS) set.delete(p);
      set.set(input.profileId, now);
      this.sets.set(key, set);
      return set.size;
    };
    const accountProfiles = count(`${input.tenantId}:a:${input.roomId}:${input.accountId}`);
    const links = [...new Set(input.links)].slice(0, MAX_LINKS).map((l) => count(`${input.tenantId}:l:${l}`));
    const v = verdict(input, times, accountProfiles, links);
    if (!v.block) return { blockedMs: 0, blockedNow: false, signals: v.signals };
    this.blocks.set(who, now + BOT_BLOCK_MS);
    this.times.delete(who);
    return { blockedMs: BOT_BLOCK_MS, blockedNow: true, signals: v.signals };
  }

  private sweep(now: number): void {
    for (const [k, until] of this.blocks) if (until <= now) this.blocks.delete(k);
    for (const [k, list] of this.times)
      if (!list.some((t) => now - t < SIGNAL_WINDOW_MS)) this.times.delete(k);
    for (const [k, set] of this.sets)
      if (![...set.values()].some((t) => now - t < SIGNAL_WINDOW_MS)) this.sets.delete(k);
  }
}

/**
 * Links da mensagem para o sinal de link repetido: o domínio (como o filtro leu) e o caminho, se houver, sem
 * consulta nem âncora (`site.com/promo?x=1` e `site.com/promo` são o mesmo link).
 */
export function botLinks(text: string, hosts: readonly string[]): string[] {
  const lower = text.toLowerCase();
  const out = new Set<string>();
  for (const host of hosts.slice(0, MAX_LINKS)) {
    const at = lower.indexOf(host);
    const path = at >= 0 ? (/^\/[^\s?#]*/.exec(lower.slice(at + host.length))?.[0] ?? '') : '';
    out.add(`${host}${path.replace(/\/+$/, '')}`.slice(0, 200));
  }
  return [...out];
}
