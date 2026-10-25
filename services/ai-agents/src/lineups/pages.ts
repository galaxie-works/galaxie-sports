/**
 * Leitura da página oficial do plano, do nosso lado (decisão do dono do produto, 24/10: a grade de
 * canais quase nunca está nos trechos da busca; ela está na página do plano). Regras:
 *
 * - só domínios oficiais da plataforma (`website` e `official_domains`); redirecionou para fora, para;
 * - educado com o site: respeita o robots.txt, User-Agent do projeto (identificável, sem dado de
 *   pessoa), poucas requisições com intervalo por host, cache por URL com validade (a revisita é mensal);
 * - nada de login, formulário nem burlar bloqueio, captcha ou paywall: a página que pede isso fica
 *   `blocked` e a grade, não verificada;
 * - ordem: HTML estático → JSON embutido na página → navegador headless (só se o conteúdo não aparecer
 *   sem JavaScript e houver navegador configurado);
 * - proveniência: URL, data da leitura e hash do conteúdo (mudou o hash, a grade vira mudança).
 */
import { createHash } from 'node:crypto';
import {
  getLineupPage,
  saveLineupPage,
  type Database,
  type LineupPageContent,
  type LineupPageStatus,
  type LineupPageVia,
} from '@galaxie/db';
import { hostOf, registrableDomain } from '@galaxie/where-to-watch';
import { isPublicHttpUrl } from '../wtw/fetcher.js';
import { isOfficialUrl, type PlatformOfficial } from './validate.js';

/** O mesmo formato do User-Agent usado com a Wikimedia: projeto e repositório, sem e-mail. */
export const LINEUP_USER_AGENT =
  'GalaxieSports/1.0 (https://github.com/galaxie-works/galaxie-sports; grade de canais)';
const UA_TOKEN = 'galaxiesports';
/** Validade do cache de uma página (a revisita da grade é mensal). */
export const LINEUP_PAGE_TTL_DAYS = 25;
/** Botões que abrem a lista de canais de um plano (o navegador clica neles). */
export const EXPAND_GRADE_RE =
  /lista de canais|ver canais|ver (a )?grade|grade de canais|lista de canales|ver canales|grilla|ver grilla|channel list/i;

// ─── robots.txt ──────────────────────────────────────────────────────────────────────────────────

export interface RobotsRules {
  allow: string[];
  disallow: string[];
  /** Crawl-delay em segundos, se houver. */
  crawlDelay: number | null;
}

/** Regras do robots.txt para o nosso User-Agent (o grupo com o nosso nome; senão o `*`). */
export function parseRobots(txt: string, token = UA_TOKEN): RobotsRules {
  const groups: { agents: string[]; rules: RobotsRules }[] = [];
  let cur: { agents: string[]; rules: RobotsRules } | null = null;
  let lastWasAgent = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!m) continue;
    const key = m[1]!.toLowerCase();
    const value = m[2]!.trim();
    if (key === 'user-agent') {
      if (!cur || !lastWasAgent) {
        cur = { agents: [], rules: { allow: [], disallow: [], crawlDelay: null } };
        groups.push(cur);
      }
      cur.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!cur) continue;
    if (key === 'allow' && value) cur.rules.allow.push(value);
    else if (key === 'disallow' && value) cur.rules.disallow.push(value);
    else if (key === 'crawl-delay' && Number.isFinite(Number(value))) cur.rules.crawlDelay = Number(value);
  }
  const mine = groups.find((g) => g.agents.some((a) => a !== '*' && token.includes(a.replace(/\W/g, ''))));
  return (
    (mine ?? groups.find((g) => g.agents.includes('*')))?.rules ?? {
      allow: [],
      disallow: [],
      crawlDelay: null,
    }
  );
}

const ruleRegex = (rule: string) =>
  new RegExp(
    `^${rule
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\\\$$/, '$')}`,
  );

/** O caminho (com a query) pode ser lido? A regra mais longa vence; empate, `Allow`. */
export function robotsAllows(rules: RobotsRules, pathAndQuery: string): boolean {
  let best: { len: number; allow: boolean } | null = null;
  for (const [list, allow] of [
    [rules.disallow, false],
    [rules.allow, true],
  ] as const)
    for (const r of list)
      if (
        ruleRegex(r).test(pathAndQuery) &&
        (!best || r.length > best.len || (r.length === best.len && allow))
      )
        best = { len: r.length, allow };
  return best?.allow ?? true;
}

// ─── conteúdo ────────────────────────────────────────────────────────────────────────────────────

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

const decode = (s: string) =>
  s.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1]?.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : ' ';
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });

/** HTML → texto em linhas (blocos viram quebras), sem scripts nem estilos. */
export function htmlToLines(html: string): string {
  return decode(
    html
      .replace(/<(script|style|noscript|template|svg)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(br|hr)\b[^>]*>/gi, '\n')
      .replace(/<\/(p|div|li|h[1-6]|tr|td|th|section|article|header|footer|ul|ol|dt|dd|button|a)>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .split('\n')
    .map((l) => l.replace(/[ \t\u00a0]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

/** Textos de JSON embutido na página (`__NEXT_DATA__`, `application/json`, `ld+json`, estado inicial). */
export function embeddedJsonText(html: string): string[] {
  const out: string[] = [];
  const push = (raw: string) => {
    try {
      const strings: string[] = [];
      const walk = (v: unknown) => {
        if (typeof v === 'string') {
          if (v.trim() && v.length <= 300 && !/^https?:\/\//.test(v)) strings.push(v.trim());
        } else if (Array.isArray(v)) v.forEach(walk);
        else if (v && typeof v === 'object') Object.values(v).forEach(walk);
      };
      walk(JSON.parse(raw));
      if (strings.length) out.push(strings.join('\n'));
    } catch {
      // não é JSON válido: ignora
    }
  };
  for (const m of html.matchAll(
    /<script[^>]*type=["']application\/(?:ld\+)?json["'][^>]*>([\s\S]*?)<\/script>/gi,
  ))
    push(m[1]!);
  for (const m of html.matchAll(
    /window\.__(?:INITIAL_STATE|NUXT|APOLLO_STATE|PRELOADED_STATE)__\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/gi,
  ))
    push(m[1]!);
  return out;
}

/** Login, formulário de senha, captcha ou desafio anti-robô: não burlamos. */
export function looksBlocked(html: string, finalUrl: string): boolean {
  return (
    /type=["']?password/i.test(html) ||
    /g-recaptcha|h-captcha|hcaptcha|cf-challenge|cf_chl_|captcha-delivery|px-captcha|are you a robot|verify you are human/i.test(
      html,
    ) ||
    /\/(login|signin|sign-in|entrar|iniciar-sesion|auth)(\/|$|\?)/i.test(new URL(finalUrl).pathname)
  );
}

/** Hash do conteúdo extraído (texto e seções, normalizados). */
export function contentHashOf(content: LineupPageContent): string {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  return createHash('sha256')
    .update(
      [norm(content.text), ...content.sections.map((s) => `${s.label ?? ''}|${norm(s.text)}`)].join('\n'),
    )
    .digest('hex');
}

// ─── navegador (opcional) ────────────────────────────────────────────────────────────────────────

export interface RenderResult {
  finalUrl: string;
  status: number;
  /** Texto visível da página. */
  text: string;
  /** O que abriu ao clicar nos botões de lista de canais, com o plano do cartão de cada botão. */
  sections: { label: string | null; text: string }[];
  /** Conteúdo bloqueado (login, captcha): o navegador não insiste. */
  blocked: boolean;
}

/** Navegador headless (Playwright): ver `render.ts`. */
export interface PageRenderer {
  render(url: string, opts: { expand: RegExp; userAgent: string; timeoutMs: number }): Promise<RenderResult>;
  close(): Promise<void>;
}

// ─── leitor ──────────────────────────────────────────────────────────────────────────────────────

export interface PageRead {
  url: string;
  status: LineupPageStatus;
  via: LineupPageVia | null;
  finalUrl: string | null;
  httpStatus: number | null;
  content: LineupPageContent | null;
  hash: string | null;
  fetchedAt: Date;
  fromCache: boolean;
  /** O hash mudou desde a leitura anterior. */
  hashChanged: boolean;
  error?: string;
}

/** Onde guardar as leituras (o banco; nos testes, memória). */
export interface PageStore {
  get(url: string): Promise<{
    status: LineupPageStatus;
    via: LineupPageVia | null;
    finalUrl: string | null;
    httpStatus: number | null;
    contentHash: string | null;
    content: LineupPageContent | null;
    fetchedAt: Date;
  } | null>;
  save(input: {
    url: string;
    platformId?: string | null;
    status: LineupPageStatus;
    via?: LineupPageVia | null;
    httpStatus?: number | null;
    finalUrl?: string | null;
    contentHash?: string | null;
    content?: LineupPageContent | null;
    error?: string | null;
    fetchedAt: Date;
  }): Promise<{ hashChanged: boolean }>;
}

export const dbPageStore = (db: Database): PageStore => ({
  get: (url) => getLineupPage(db, url),
  save: async (input) => ({ hashChanged: (await saveLineupPage(db, input)).hashChanged }),
});

export const memoryPageStore = (): PageStore & { rows: Map<string, unknown> } => {
  const rows = new Map<string, Parameters<PageStore['save']>[0]>();
  return {
    rows,
    get: async (url) => {
      const r = rows.get(url);
      return r
        ? {
            status: r.status,
            via: r.via ?? null,
            finalUrl: r.finalUrl ?? null,
            httpStatus: r.httpStatus ?? null,
            contentHash: r.contentHash ?? null,
            content: r.content ?? null,
            fetchedAt: r.fetchedAt,
          }
        : null;
    },
    save: async (input) => {
      const prev = rows.get(input.url);
      rows.set(input.url, { ...prev, ...input, contentHash: input.contentHash ?? prev?.contentHash ?? null });
      return {
        hashChanged: !!(prev?.contentHash && input.contentHash && prev.contentHash !== input.contentHash),
      };
    },
  };
};

export interface OfficialPageReaderOptions {
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
  renderer?: PageRenderer | null;
  store?: PageStore | null;
  userAgent?: string;
  /** Intervalo mínimo entre requisições ao mesmo host (padrão 3 s; o Crawl-delay do site, se maior). */
  minIntervalMs?: number;
  /** Páginas buscadas por execução (cache não conta). Padrão 30. */
  maxPages?: number;
  ttlDays?: number;
  timeoutMs?: number;
  maxBytes?: number;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  log?: (m: string) => void;
}

export interface ReadOptions {
  platformId?: string | null;
  /** Ignora o cache. */
  force?: boolean;
  /** O conteúdo estático já tem o que interessa? Senão tenta o JSON embutido e o navegador. */
  enough?: (content: LineupPageContent) => boolean;
}

export class OfficialPageReader {
  private readonly fetchImpl: NonNullable<OfficialPageReaderOptions['fetch']>;
  private readonly ua: string;
  private readonly minInterval: number;
  private readonly maxPages: number;
  private readonly ttlMs: number;
  private readonly timeoutMs: number;
  private readonly maxBytes: number;
  private readonly now: () => Date;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly log: (m: string) => void;
  private readonly robots = new Map<string, Promise<RobotsRules>>();
  private readonly lastHit = new Map<string, number>();
  private fetched = 0;

  constructor(private readonly opts: OfficialPageReaderOptions = {}) {
    this.fetchImpl = opts.fetch ?? ((url, init) => fetch(url, init));
    this.ua = opts.userAgent ?? LINEUP_USER_AGENT;
    this.minInterval = opts.minIntervalMs ?? 3_000;
    this.maxPages = opts.maxPages ?? 30;
    this.ttlMs = (opts.ttlDays ?? LINEUP_PAGE_TTL_DAYS) * 86_400_000;
    this.timeoutMs = opts.timeoutMs ?? 15_000;
    this.maxBytes = opts.maxBytes ?? 3_000_000;
    this.now = opts.now ?? (() => new Date());
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.log = opts.log ?? (() => {});
  }

  /** Páginas buscadas nesta execução (sem contar o cache). */
  get pagesFetched(): number {
    return this.fetched;
  }

  private async rulesFor(origin: string): Promise<RobotsRules> {
    let p = this.robots.get(origin);
    if (!p) {
      p = this.politeGet(`${origin}/robots.txt`)
        .then(async (r) =>
          r.ok ? parseRobots(await r.text()) : { allow: [], disallow: [], crawlDelay: null },
        )
        // sem robots.txt (404) ou fora do ar: vale o padrão (tudo liberado)
        .catch(() => ({ allow: [], disallow: [], crawlDelay: null }));
      this.robots.set(origin, p);
    }
    return p;
  }

  /** GET sem seguir redirecionamento, com o User-Agent e o intervalo por host. */
  private async politeGet(url: string, crawlDelay: number | null = null): Promise<Response> {
    const host = hostOf(url) ?? url;
    const wait = Math.max(this.minInterval, (crawlDelay ?? 0) * 1000);
    const last = this.lastHit.get(host);
    const elapsed = last === undefined ? Infinity : Date.now() - last;
    if (elapsed < wait) await this.sleep(wait - elapsed);
    this.lastHit.set(host, Date.now());
    return this.fetchImpl(url, {
      method: 'GET',
      redirect: 'manual',
      headers: { 'user-agent': this.ua, accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5' },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
  }

  private async readBody(res: Response): Promise<string> {
    const buf = new Uint8Array(await res.arrayBuffer());
    return new TextDecoder('utf-8').decode(buf.subarray(0, this.maxBytes));
  }

  private async finish(
    url: string,
    platform: { platformId?: string | null },
    r: Omit<PageRead, 'url' | 'fetchedAt' | 'fromCache' | 'hashChanged' | 'hash'>,
  ): Promise<PageRead> {
    const fetchedAt = this.now();
    const hash = r.content && r.status === 'ok' ? contentHashOf(r.content) : null;
    const saved = await this.opts.store?.save({
      url,
      platformId: platform.platformId ?? null,
      status: r.status,
      via: r.via,
      httpStatus: r.httpStatus,
      finalUrl: r.finalUrl,
      contentHash: hash,
      content: r.status === 'ok' ? r.content : null,
      error: r.error ?? null,
      fetchedAt,
    });
    return { ...r, url, hash, fetchedAt, fromCache: false, hashChanged: saved?.hashChanged ?? false };
  }

  /** Lê uma página oficial da plataforma (do cache, se ainda valer). */
  async read(url: string, platform: PlatformOfficial, opts: ReadOptions = {}): Promise<PageRead> {
    const base = { via: null, finalUrl: null, httpStatus: null, content: null } as const;
    if (!isPublicHttpUrl(url) || !isOfficialUrl(url, platform))
      return {
        ...base,
        url,
        status: 'off_domain',
        hash: null,
        fetchedAt: this.now(),
        fromCache: false,
        hashChanged: false,
      };
    const cached = opts.force ? null : await this.opts.store?.get(url);
    if (cached && cached.status === 'ok' && this.now().getTime() - cached.fetchedAt.getTime() < this.ttlMs)
      return {
        url,
        status: cached.status,
        via: cached.via,
        finalUrl: cached.finalUrl,
        httpStatus: cached.httpStatus,
        content: cached.content,
        hash: cached.contentHash,
        fetchedAt: cached.fetchedAt,
        fromCache: true,
        hashChanged: false,
      };
    if (this.fetched >= this.maxPages)
      return {
        ...base,
        url,
        status: 'error',
        hash: null,
        fetchedAt: this.now(),
        fromCache: false,
        hashChanged: false,
        error: `limite de ${this.maxPages} página(s) por execução`,
      };
    this.fetched++;
    const enough = opts.enough ?? ((c: LineupPageContent) => c.text.length > 500);
    try {
      // 1. HTML estático, seguindo redirecionamentos só dentro dos domínios oficiais
      let current = url;
      let res: Response | null = null;
      let rules: RobotsRules | null = null;
      for (let hop = 0; hop <= 3; hop++) {
        const u = new URL(current);
        rules = await this.rulesFor(u.origin);
        if (!robotsAllows(rules, `${u.pathname}${u.search}`))
          return this.finish(url, opts, { ...base, finalUrl: current, status: 'robots' });
        res = await this.politeGet(current, rules.crawlDelay);
        const loc = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
        if (!loc) break;
        const next = new URL(loc, current).toString();
        if (!isPublicHttpUrl(next) || !isOfficialUrl(next, platform))
          return this.finish(url, opts, {
            ...base,
            finalUrl: next,
            httpStatus: res.status,
            status: 'off_domain',
          });
        current = next;
        res = null;
      }
      if (!res)
        return this.finish(url, opts, {
          ...base,
          finalUrl: current,
          status: 'error',
          error: 'redirecionamentos demais',
        });
      if ([401, 402, 403, 407].includes(res.status))
        return this.finish(url, opts, {
          ...base,
          finalUrl: current,
          httpStatus: res.status,
          status: 'blocked',
        });
      if (!res.ok)
        return this.finish(url, opts, {
          ...base,
          finalUrl: current,
          httpStatus: res.status,
          status: 'error',
          error: `HTTP ${res.status}`,
        });
      const html = await this.readBody(res);
      if (looksBlocked(html, current))
        return this.finish(url, opts, {
          ...base,
          finalUrl: current,
          httpStatus: res.status,
          status: 'blocked',
        });
      const staticContent: LineupPageContent = { text: htmlToLines(html), sections: [] };
      if (enough(staticContent))
        return this.finish(url, opts, {
          finalUrl: current,
          httpStatus: res.status,
          status: 'ok',
          via: 'static',
          content: staticContent,
        });
      // 2. JSON que a própria página traz embutido
      const json = embeddedJsonText(html);
      const withJson: LineupPageContent = {
        text: staticContent.text,
        sections: json.map((text) => ({ label: null, text })),
      };
      if (json.length && enough(withJson))
        return this.finish(url, opts, {
          finalUrl: current,
          httpStatus: res.status,
          status: 'ok',
          via: 'embedded_json',
          content: withJson,
        });
      // 3. navegador headless, só se configurado
      if (!this.opts.renderer)
        return this.finish(url, opts, {
          finalUrl: current,
          httpStatus: res.status,
          status: 'needs_render',
          via: null,
          content: withJson,
        });
      await this.politeWait(current, rules?.crawlDelay ?? null);
      const r = await this.opts.renderer.render(current, {
        expand: EXPAND_GRADE_RE,
        userAgent: this.ua,
        timeoutMs: Math.max(this.timeoutMs, 45_000),
      });
      if (r.blocked)
        return this.finish(url, opts, {
          ...base,
          finalUrl: r.finalUrl,
          httpStatus: r.status,
          status: 'blocked',
        });
      if (!isOfficialUrl(r.finalUrl, platform))
        return this.finish(url, opts, {
          ...base,
          finalUrl: r.finalUrl,
          httpStatus: r.status,
          status: 'off_domain',
        });
      return this.finish(url, opts, {
        finalUrl: r.finalUrl,
        httpStatus: r.status,
        status: 'ok',
        via: 'render',
        content: { text: r.text, sections: r.sections },
      });
    } catch (err) {
      return this.finish(url, opts, {
        ...base,
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async politeWait(url: string, crawlDelay: number | null): Promise<void> {
    const host = hostOf(url) ?? url;
    const wait = Math.max(this.minInterval, (crawlDelay ?? 0) * 1000);
    const last = this.lastHit.get(host);
    const elapsed = last === undefined ? Infinity : Date.now() - last;
    if (elapsed < wait) await this.sleep(wait - elapsed);
    this.lastHit.set(host, Date.now());
  }

  /**
   * Para onde o site oficial redireciona (rebrand): segue até 5 redirecionamentos com GET, respeitando o
   * robots.txt. Devolve a URL final quando o domínio registrável mudou; senão null.
   */
  async rebrandTarget(website: string): Promise<string | null> {
    if (!isPublicHttpUrl(website)) return null;
    const startHost = hostOf(website);
    if (!startHost) return null;
    let current = website;
    try {
      for (let hop = 0; hop < 5; hop++) {
        const u = new URL(current);
        const rules = await this.rulesFor(u.origin);
        if (!robotsAllows(rules, `${u.pathname}${u.search}`)) return null;
        const res = await this.politeGet(current, rules.crawlDelay);
        const loc = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
        if (!loc) break;
        const next = new URL(loc, current).toString();
        if (!isPublicHttpUrl(next)) return null;
        current = next;
      }
    } catch {
      return null;
    }
    const endHost = hostOf(current);
    if (!endHost || registrableDomain(endHost) === registrableDomain(startHost)) return null;
    this.log(`site ${startHost} redireciona para ${endHost}`);
    return `${new URL(current).origin}/`;
  }
}
