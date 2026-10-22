/**
 * Trilha de navegação (breadcrumb): o caminho que o usuário de fato percorreu nesta aba, guardado no
 * sessionStorage (cada aba tem a sua). Sem storage (modo privado, bloqueado), vale só em memória.
 *
 * Regras de uma visita:
 * 1. Página que já está na trilha: corta a trilha de volta até ela (clique num item, Voltar/Avançar).
 *    Mudança só de query string (ex.: temporada) cai aqui e substitui o último item.
 * 2. Destino de topo clicado na sidebar (esportes, países, Explorar, ajustes): começa trilha nova.
 * 3. Senão: acrescenta no fim. A trilha guarda no máximo MAX_TRAIL itens (descarta os mais antigos).
 */

export type TrailKind =
  | 'país'
  | 'competição'
  | 'time'
  | 'evento'
  | 'clássico'
  | 'pessoa'
  | 'local'
  | 'esporte'
  | 'explorar'
  | 'ao vivo'
  | 'docs'
  | 'ajustes';

/** O que a página informa ao abrir. */
export interface TrailVisit {
  /** Caminho com query string (para voltar exatamente à mesma visão). */
  path: string;
  label: string;
  kind: TrailKind;
}

export interface TrailEntry extends TrailVisit {
  /** Posição real na trilha (1 = início), mesmo depois de descartar os itens mais antigos. */
  depth: number;
}

export interface TrailState {
  entries: TrailEntry[];
  /** Destino de topo clicado na sidebar que ainda não abriu (regra 2). */
  pendingRoot: string | null;
}

export const MAX_TRAIL = 6;
const STORAGE_KEY = 'galaxie:trilha';

/** Caminho sem query string nem hash: é o que identifica a página. */
export const pathnameOf = (path: string) => path.split(/[?#]/)[0] ?? path;

function isEntry(value: unknown): value is TrailEntry {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.path === 'string' &&
    typeof v.label === 'string' &&
    typeof v.kind === 'string' &&
    typeof v.depth === 'number'
  );
}

function read(): TrailEntry[] {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isEntry).slice(-MAX_TRAIL) : [];
  } catch {
    return [];
  }
}

function write(entries: TrailEntry[]) {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Sem storage: a trilha segue só em memória.
  }
}

let state: TrailState | null = null;
const listeners = new Set<() => void>();

function current(): TrailState {
  state ??= { entries: read(), pendingRoot: null };
  return state;
}

function set(next: TrailState) {
  const prev = current();
  state = next;
  if (next.entries !== prev.entries) write(next.entries);
  listeners.forEach((l) => l());
}

export function subscribeTrail(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const getTrailSnapshot = (): TrailState => current();

/** Esvazia a trilha (ex.: ao trocar de idioma, os rótulos guardados ficariam no idioma anterior). */
export function clearTrail() {
  set({ entries: [], pendingRoot: null });
}
export const getTrailServerSnapshot = (): TrailState | null => null;

/** Aplica as regras de uma visita (função pura: a mesma conta serve para desenhar e para gravar). */
export function applyVisit(trail: TrailState, visit: TrailVisit): TrailEntry[] {
  const target = pathnameOf(visit.path);
  if (trail.pendingRoot !== null && pathnameOf(trail.pendingRoot) === target) return [{ ...visit, depth: 1 }];
  const index = trail.entries.findIndex((e) => pathnameOf(e.path) === target);
  if (index >= 0) return [...trail.entries.slice(0, index), { ...visit, depth: trail.entries[index]!.depth }];
  const depth = (trail.entries.at(-1)?.depth ?? 0) + 1;
  return [...trail.entries, { ...visit, depth }].slice(-MAX_TRAIL);
}

/**
 * Itens anteriores à página atual, para quando o rótulo dela ainda não chegou (esqueleto carregando):
 * se a página já está na trilha, o que vem antes dela; senão, a trilha toda.
 */
export function ancestorsOf(trail: TrailState, path: string): TrailEntry[] {
  const target = pathnameOf(path);
  if (trail.pendingRoot !== null && pathnameOf(trail.pendingRoot) === target) return [];
  const index = trail.entries.findIndex((e) => pathnameOf(e.path) === target);
  return index >= 0 ? trail.entries.slice(0, index) : trail.entries;
}

/** Registra a página atual na trilha (idempotente: repetir a mesma visita não muda nada). */
export function visitTrail(visit: TrailVisit) {
  const trail = current();
  const entries = applyVisit(trail, visit);
  const last = trail.entries.at(-1);
  const unchanged =
    trail.pendingRoot === null &&
    entries.length === trail.entries.length &&
    last !== undefined &&
    last.path === visit.path &&
    last.label === visit.label &&
    last.kind === visit.kind;
  if (unchanged) return;
  set({ entries, pendingRoot: null });
}

/**
 * Clique num destino de topo da sidebar: a próxima visita a `href` começa uma trilha nova. Se o
 * usuário já está nessa página (não haverá navegação), reinicia a trilha agora.
 */
export function startTrailAt(href: string) {
  const trail = current();
  const last = trail.entries.at(-1);
  if (last && pathnameOf(last.path) === pathnameOf(href)) {
    set({ entries: [{ ...last, depth: 1 }], pendingRoot: null });
    return;
  }
  set({ entries: trail.entries, pendingRoot: href });
}

/**
 * `onClick` para os links de topo (sidebar, menu do usuário). Ignora cliques com modificador ou do
 * botão do meio: esses abrem outra aba e não navegam nesta.
 */
export function topLevelClick(href: string) {
  return (event: {
    button: number;
    metaKey: boolean;
    ctrlKey: boolean;
    shiftKey: boolean;
    altKey: boolean;
  }) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    startTrailAt(href);
  };
}

/**
 * Rótulo, origem (caminho do item anterior) e profundidade da página `pathname` na trilha, para a
 * medição de atividade. Se a página ainda não se registrou, calcula onde ela vai entrar (sem rótulo).
 */
export function trailPosition(pathname: string): {
  label: string | null;
  from: string | null;
  depth: number;
} {
  const trail = current();
  const index = trail.entries.findIndex((e) => pathnameOf(e.path) === pathname);
  const entry = trail.entries[index];
  if (entry) return { label: entry.label, from: trail.entries[index - 1]?.path ?? null, depth: entry.depth };
  const before = ancestorsOf(trail, pathname);
  return { label: null, from: before.at(-1)?.path ?? null, depth: (before.at(-1)?.depth ?? 0) + 1 };
}
