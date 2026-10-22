/**
 * Itens recentes da busca global, no localStorage (valem entre abas e visitas), um conjunto por idioma
 * (os rótulos da documentação mudam com ele). Sem storage (modo privado, bloqueado), ficam só em
 * memória nesta página.
 */
import type { SearchEntry } from './entries';

export const MAX_RECENTS = 6;
const STORAGE_KEY = 'galaxie:busca-recentes';
/** Idioma da página (`<html lang>`); trocar de idioma recarrega a página e relê os recentes. */
const storageKey = () =>
  `${STORAGE_KEY}:${typeof document === 'undefined' ? 'pt-BR' : document.documentElement.lang || 'pt-BR'}`;
const EMPTY: SearchEntry[] = [];

const listeners = new Set<() => void>();
let cache: SearchEntry[] | undefined;

function isEntry(value: unknown): value is SearchEntry {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.key === 'string' &&
    typeof v.kind === 'string' &&
    typeof v.href === 'string' &&
    v.href.startsWith('/') &&
    typeof v.label === 'string'
  );
}

function read(): SearchEntry[] {
  try {
    const raw = window.localStorage.getItem(storageKey());
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(isEntry).slice(0, MAX_RECENTS) : [];
  } catch {
    return [];
  }
}

function write(entries: SearchEntry[]) {
  cache = entries;
  try {
    window.localStorage.setItem(storageKey(), JSON.stringify(entries));
  } catch {
    // Sem storage: os recentes valem só nesta página.
  }
  listeners.forEach((l) => l());
}

export function subscribeRecents(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const getRecents = (): SearchEntry[] => (cache ??= read());
export const getRecentsServer = (): SearchEntry[] => EMPTY;

/** Põe o item no topo dos recentes (sem repetir). */
export function addRecent(entry: SearchEntry) {
  write([entry, ...getRecents().filter((e) => e.key !== entry.key)].slice(0, MAX_RECENTS));
}

export function clearRecents() {
  write([]);
}
