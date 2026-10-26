/**
 * Cliente da API do MediaWiki (Wikimedia Commons e Wikidata) seguindo a etiqueta da Wikimedia:
 * - User-Agent que identifica o projeto e o repositório, sem e-mail nem dado de pessoa;
 * - requisições em série, com intervalo mínimo entre elas;
 * - `maxlag=5` em toda leitura: com o servidor atrasado, espera o `Retry-After` e tenta de novo;
 * - 429/5xx com backoff exponencial;
 * - tempo-limite em toda requisição (conexão pendurada não trava o CLI) e nova tentativa com backoff em erro de
 *   rede (ECONNRESET, DNS, tempo esgotado).
 * https://www.mediawiki.org/wiki/API:Etiquette · https://meta.wikimedia.org/wiki/User-Agent_policy
 */

import type { ExtMetadata } from './license.js';

export const WIKIMEDIA_USER_AGENT =
  'GalaxieSports/1.0 (https://github.com/galaxie-works/galaxie-sports; acervo de fotos da F1)';
export const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
export const WIKIDATA_API = 'https://www.wikidata.org/w/api.php';

export interface WikimediaClientOptions {
  fetch?: typeof globalThis.fetch;
  userAgent?: string;
  /** Intervalo mínimo entre requisições (ms). Padrão 1 s. */
  minIntervalMs?: number;
  maxRetries?: number;
  /** Tentativas quando o servidor responde `maxlag` (padrão 10, com espera crescente). */
  maxLagRetries?: number;
  /** No Wikidata, o atraso inclui o do query service e dura mais: desiste antes (padrão 3) e cai na Commons. */
  wikidataMaxLagRetries?: number;
  /** Tempo-limite de cada requisição, corpo incluído (ms). Padrão 60 s. */
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  log?: (msg: string) => void;
}

export class WikimediaError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = 'WikimediaError';
  }
}

type Json = Record<string, unknown>;

type Text = { value?: string };
/** Entidade do `wbgetentities` (só os campos que lemos). */
interface EntityJson {
  labels?: Record<string, Text>;
  aliases?: Record<string, Text[]>;
  descriptions?: Record<string, Text>;
  claims?: Record<string, unknown[]>;
}

export class WikimediaClient {
  private readonly fetchFn: typeof globalThis.fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private last = 0;
  /** Requisições feitas (para o relatório). */
  requests = 0;

  constructor(private readonly options: WikimediaClientOptions = {}) {
    this.fetchFn = options.fetch ?? ((url, init) => fetch(url, init));
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  /** Requisição no ritmo da etiqueta (intervalo mínimo), com o User-Agent e o tempo-limite. */
  private async send(url: string | URL, accept: string): Promise<Response> {
    const wait = this.last + (this.options.minIntervalMs ?? 1000) - Date.now();
    if (wait > 0) await this.sleep(wait);
    this.last = Date.now();
    this.requests += 1;
    return this.fetchFn(url, {
      headers: { 'user-agent': this.options.userAgent ?? WIKIMEDIA_USER_AGENT, accept },
      signal: AbortSignal.timeout(this.options.timeoutMs ?? 60_000),
    });
  }

  /**
   * Erro de rede (conexão caída, DNS, tempo esgotado, corpo cortado): espera e tenta de novo; esgotadas as
   * tentativas, vira `WikimediaError` (quem chama trata como a Wikimedia fora). Erro da própria API sobe direto.
   */
  private async retryNetwork(
    err: unknown,
    attempt: number,
    maxRetries: number,
    where: string,
  ): Promise<void> {
    if (err instanceof WikimediaError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    if (attempt >= maxRetries)
      throw new WikimediaError(`Wikimedia: falha de rede em ${where} (${message})`, null);
    this.options.log?.(`rede: ${message} em ${where}; nova tentativa`);
    await this.sleep(2 ** attempt * 1000);
  }

  /** GET na API (`action=query` etc.) com `format=json`, `formatversion=2` e `maxlag=5`. */
  async get(api: string, params: Record<string, string | number>): Promise<Json> {
    const url = new URL(api);
    for (const [k, v] of Object.entries({ ...params, format: 'json', formatversion: 2, maxlag: 5 }))
      url.searchParams.set(k, String(v));
    const maxRetries = this.options.maxRetries ?? 5;
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      let body: Json;
      try {
        res = await this.send(url, 'application/json');
        body = res.ok ? ((await res.json()) as Json) : {};
      } catch (err) {
        await this.retryNetwork(err, attempt, maxRetries, api);
        continue;
      }
      const retryAfter = Number(res.headers.get('retry-after')) || 0;
      if (res.status === 429 || res.status >= 500) {
        if (attempt >= maxRetries)
          throw new WikimediaError(`Wikimedia: HTTP ${res.status} em ${api}`, res.status);
        await this.sleep(Math.max(retryAfter * 1000, 2 ** attempt * 1000));
        continue;
      }
      if (!res.ok) throw new WikimediaError(`Wikimedia: HTTP ${res.status} em ${api}`, res.status);
      const error = body.error as { code?: string; info?: string } | undefined;
      if (error?.code === 'maxlag') {
        // o Wikidata soma o atraso do query service: espera mais a cada vez (5, 10, 15... até 60 s)
        if (
          attempt >=
          (api === WIKIDATA_API
            ? (this.options.wikidataMaxLagRetries ?? 3)
            : (this.options.maxLagRetries ?? 10))
        )
          throw new WikimediaError('Wikimedia: servidor atrasado (maxlag)', 200);
        const wait = Math.min(60, Math.max(retryAfter || 5, 5 * (attempt + 1)));
        this.options.log?.(`maxlag: esperando ${wait} s`);
        await this.sleep(wait * 1000);
        continue;
      }
      if (error) throw new WikimediaError(`Wikimedia: ${error.code}: ${error.info}`, 200);
      return body;
    }
  }

  /** Baixa um arquivo (miniatura da Commons) com o mesmo User-Agent e o mesmo ritmo. */
  async download(url: string): Promise<{ body: Uint8Array; contentType: string | null }> {
    const maxRetries = this.options.maxRetries ?? 5;
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await this.send(url, 'image/*');
        if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
          const retryAfter = Number(res.headers.get('retry-after')) || 0;
          await this.sleep(Math.max(retryAfter * 1000, 2 ** attempt * 1000));
          continue;
        }
        if (!res.ok) throw new WikimediaError(`Wikimedia: HTTP ${res.status} ao baixar ${url}`, res.status);
        return {
          body: new Uint8Array(await res.arrayBuffer()),
          contentType: res.headers.get('content-type'),
        };
      } catch (err) {
        await this.retryNetwork(err, attempt, maxRetries, url);
      }
    }
  }

  // ─── Wikidata ─────────────────────────────────────────────────────────────────────────────────

  /** Itens do Wikidata pelo nome (rótulo e apelidos), em inglês. */
  async searchItems(name: string, limit = 7): Promise<string[]> {
    const body = await this.get(WIKIDATA_API, {
      action: 'wbsearchentities',
      search: name,
      language: 'en',
      type: 'item',
      limit,
    });
    return ((body.search as { id: string }[] | undefined) ?? []).map((s) => s.id);
  }

  /** Afirmações (claims) dos itens, só as propriedades pedidas. */
  async claims(ids: string[], props: string[]): Promise<Map<string, Record<string, unknown[]>>> {
    const out = new Map<string, Record<string, unknown[]>>();
    for (const [id, e] of await this.entities(ids, { props: 'claims' })) {
      const claims: Record<string, unknown[]> = {};
      for (const p of props) claims[p] = e.claims?.[p] ?? [];
      out.set(id, claims);
    }
    return out;
  }

  /**
   * `wbgetentities` em lotes de 50. A API corta a resposta acima de 12 MB sem dar erro ("This result was
   * truncated", e os itens a mais somem): 50 países com todas as afirmações passam disso. Lote cortado é refeito em
   * metades; um item que sozinho não cabe fica de fora.
   */
  private async entities(ids: string[], params: Record<string, string>): Promise<Map<string, EntityJson>> {
    const out = new Map<string, EntityJson>();
    const fetchBatch = async (batch: string[]): Promise<void> => {
      const body = await this.get(WIKIDATA_API, { action: 'wbgetentities', ids: batch.join('|'), ...params });
      const entities = (body.entities ?? {}) as Record<string, EntityJson>;
      if (JSON.stringify(body.warnings ?? '').includes('truncated') && batch.length > 1) {
        const half = Math.ceil(batch.length / 2);
        await fetchBatch(batch.slice(0, half));
        await fetchBatch(batch.slice(half));
        return;
      }
      for (const [id, e] of Object.entries(entities)) out.set(id, e);
    };
    for (let i = 0; i < ids.length; i += 50) await fetchBatch(ids.slice(i, i + 50));
    return out;
  }

  /**
   * Rótulos, apelidos e descrição (nas línguas pedidas, a primeira é a da descrição) e as afirmações pedidas dos
   * itens. Os nomes vêm sem repetição: rótulos antes dos apelidos.
   */
  async items(
    ids: string[],
    props: string[],
    languages: string[] = ['en'],
  ): Promise<Map<string, WikidataItem>> {
    const out = new Map<string, WikidataItem>();
    const entities = await this.entities(ids, {
      props: props.length ? 'labels|aliases|descriptions|claims' : 'labels|aliases|descriptions',
      languages: languages.join('|'),
    });
    for (const [id, e] of entities) {
      const label = e.labels?.[languages[0]!]?.value ?? null;
      const names = [
        ...languages.map((l) => e.labels?.[l]?.value),
        ...languages.flatMap((l) => (e.aliases?.[l] ?? []).map((a) => a.value)),
      ].filter((v): v is string => !!v);
      const claims: Record<string, unknown[]> = {};
      for (const p of props) claims[p] = e.claims?.[p] ?? [];
      out.set(id, {
        label,
        names: [...new Set(names)],
        description: e.descriptions?.[languages[0]!]?.value ?? null,
        claims,
      });
    }
    return out;
  }

  /**
   * Afirmações de um item pelo `Special:EntityData` (JSON servido do cache do Wikidata, sem o `maxlag` da API):
   * o caminho quando a API do Wikidata está atrasada. Mesmo ritmo e backoff das outras leituras.
   */
  async entityClaims(id: string, props: string[]): Promise<Record<string, unknown[]> | null> {
    if (!/^Q\d+$/.test(id)) return null;
    const url = `https://www.wikidata.org/wiki/Special:EntityData/${id}.json`;
    const maxRetries = this.options.maxRetries ?? 5;
    for (let attempt = 0; ; attempt++) {
      let body: { entities?: Record<string, { claims?: Record<string, unknown[]> }> };
      try {
        const res = await this.send(url, 'application/json');
        if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
          const retryAfter = Number(res.headers.get('retry-after')) || 0;
          await this.sleep(Math.max(retryAfter * 1000, 2 ** attempt * 1000));
          continue;
        }
        if (res.status === 404) return null;
        if (!res.ok) throw new WikimediaError(`Wikimedia: HTTP ${res.status} em ${url}`, res.status);
        body = (await res.json()) as typeof body;
      } catch (err) {
        await this.retryNetwork(err, attempt, maxRetries, url);
        continue;
      }
      // redirecionamento: a chave é o id final
      const entity = Object.values(body.entities ?? {})[0];
      if (!entity) return null;
      const claims: Record<string, unknown[]> = {};
      for (const p of props) claims[p] = entity.claims?.[p] ?? [];
      return claims;
    }
  }

  // ─── Commons ──────────────────────────────────────────────────────────────────────────────────

  /** Arquivos de uma categoria da Commons (namespace 6), em ordem da API. */
  async categoryFiles(category: string, limit = 100): Promise<string[]> {
    const body = await this.get(COMMONS_API, {
      action: 'query',
      list: 'categorymembers',
      cmtitle: category.startsWith('Category:') ? category : `Category:${category}`,
      cmtype: 'file',
      cmlimit: Math.min(limit, 500),
    });
    const query = body.query as { categorymembers?: { title: string }[] } | undefined;
    return (query?.categorymembers ?? []).map((m) => m.title);
  }

  /** A categoria existe? (o nome do chassi nem sempre tem categoria própria) */
  async categoryExists(category: string): Promise<boolean> {
    const title = category.startsWith('Category:') ? category : `Category:${category}`;
    const body = await this.get(COMMONS_API, { action: 'query', titles: title });
    const pages = ((body.query as { pages?: { missing?: boolean }[] } | undefined)?.pages ?? []) as {
      missing?: boolean;
    }[];
    return pages.length > 0 && !pages[0]!.missing;
  }

  /**
   * Só o `extmetadata` dos arquivos (os campos de `fields`), em lotes de 50, pelo título pedido: a Commons pode
   * devolver o título normalizado (`normalized`), que volta mapeado para o original. Arquivo que sumiu fica fora.
   */
  async extMetadata(titles: string[], fields: string[]): Promise<Map<string, ExtMetadata>> {
    const out = new Map<string, ExtMetadata>();
    for (let i = 0; i < titles.length; i += 50) {
      const body = await this.get(COMMONS_API, {
        action: 'query',
        titles: titles.slice(i, i + 50).join('|'),
        prop: 'imageinfo',
        iiprop: 'extmetadata',
        iiextmetadatafilter: fields.join('|'),
        iiextmetadatalanguage: 'en',
      });
      const query = body.query as
        { pages?: CommonsPage[]; normalized?: { from: string; to: string }[] } | undefined;
      const original = new Map((query?.normalized ?? []).map((n) => [n.to, n.from]));
      for (const p of query?.pages ?? []) {
        const meta = p.imageinfo?.[0]?.extmetadata;
        if (meta) out.set(original.get(p.title) ?? p.title, meta);
      }
    }
    return out;
  }

  /** Dimensões, tipo, URL da miniatura e `extmetadata` (licença, autor, data) dos arquivos. */
  async imageInfo(titles: string[], thumbWidth: number): Promise<CommonsFile[]> {
    return (await this.imageInfoReport(titles, thumbWidth)).files;
  }

  /**
   * `imageInfo` com os títulos que a Commons diz não existirem (`missing`: apagado, por exemplo por violação de
   * direito autoral; `invalid`: título inválido). Arquivo apagado sai do participante na importação; resposta sem
   * nenhuma página (nem arquivo nem `missing`) é falha da fonte.
   */
  async imageInfoReport(
    titles: string[],
    thumbWidth: number,
  ): Promise<{ files: CommonsFile[]; missing: string[] }> {
    const out: CommonsFile[] = [];
    const missing: string[] = [];
    for (let i = 0; i < titles.length; i += 50) {
      const body = await this.get(COMMONS_API, {
        action: 'query',
        titles: titles.slice(i, i + 50).join('|'),
        prop: 'imageinfo|categories',
        iiprop: 'url|size|mime|extmetadata',
        iiurlwidth: thumbWidth,
        iiextmetadatalanguage: 'en',
        cllimit: 'max',
        clshow: '!hidden',
      });
      const pages = ((body.query as { pages?: unknown[] } | undefined)?.pages ?? []) as CommonsPage[];
      for (const p of pages) {
        if (p.missing || p.invalid) {
          missing.push(p.title);
          continue;
        }
        const info = p.imageinfo?.[0];
        if (!info) continue;
        out.push({
          title: p.title,
          pageUrl: info.descriptionurl,
          url: info.url,
          thumbUrl: info.thumburl ?? info.url,
          thumbWidth: info.thumbwidth ?? info.width,
          thumbHeight: info.thumbheight ?? info.height,
          width: info.width,
          height: info.height,
          mime: info.mime,
          extmetadata: info.extmetadata ?? {},
          categories: (p.categories ?? []).map((c) => c.title.replace(/^Category:/, '')),
        });
      }
    }
    return { files: out, missing };
  }
}

interface CommonsPage {
  title: string;
  missing?: boolean;
  invalid?: boolean;
  imageinfo?: {
    url: string;
    descriptionurl: string;
    thumburl?: string;
    thumbwidth?: number;
    thumbheight?: number;
    width: number;
    height: number;
    mime: string;
    extmetadata?: Record<string, { value?: unknown }>;
  }[];
  categories?: { title: string }[];
}

/** Item do Wikidata pelo `items()`: rótulo e descrição na primeira língua; nomes = rótulos + apelidos. */
export interface WikidataItem {
  label: string | null;
  names: string[];
  description: string | null;
  claims: Record<string, unknown[]>;
}

export interface CommonsFile {
  title: string;
  pageUrl: string;
  url: string;
  thumbUrl: string;
  thumbWidth: number;
  thumbHeight: number;
  width: number;
  height: number;
  mime: string;
  extmetadata: ExtMetadata;
  categories: string[];
}
