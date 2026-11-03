/**
 * Cursor do espelho de assets em ops.sync_cursor (o mesmo `cursor-store` dos jobs de sync): uma linha por tipo de
 * asset (`assets|mirror|kind=team_logo`), com o último asset feito naquela volta pela fila. A execução seguinte (o
 * próximo horário do scheduler, ou a tarefa que retoma depois do deploy) continua dali; no fim da volta o cursor zera.
 *
 * O escopo entra na chave: `--caminho volley` e `--retentar-ausentes` andam em filas diferentes, com cursor próprio.
 */
import type { CursorStore } from '../jobs/runtime/cursor-store.js';
import type { MirrorCursorStore } from './asset-mirror.js';
import type { MirrorCursor, MirrorPosition } from './asset-store.js';

export const MIRROR_CURSOR_SPORT = 'assets';
export const MIRROR_CURSOR_ENDPOINT = 'mirror';

export interface MirrorCursorScope {
  pathPrefix?: string | undefined;
  includeMissing?: boolean | undefined;
}

/** Sufixo da chave pelo escopo (vazio no espelho padrão). */
export function mirrorScopeKey(scope: MirrorCursorScope = {}): string {
  const p = new URLSearchParams();
  if (scope.pathPrefix) p.set('caminho', scope.pathPrefix.replace(/^\/+|\/+$/g, ''));
  if (scope.includeMissing) p.set('ausentes', '1');
  return p.toString();
}

const keyOf = (kind: string, scope: string) => (scope ? `kind=${kind}&${scope}` : `kind=${kind}`);

function isPosition(v: unknown): v is MirrorPosition {
  const o = v as Partial<MirrorPosition> | null;
  return !!o && typeof o.createdAt === 'string' && typeof o.id === 'string';
}

/** O cursor do espelho sobre um CursorStore (Pg no serviço, memória nos testes). */
export function mirrorCursorStore(
  cursors: CursorStore,
  scope: MirrorCursorScope = {},
  now: () => Date = () => new Date(),
): MirrorCursorStore {
  const scopeKey = mirrorScopeKey(scope);
  /** Tipos com linha no banco: no fim da volta, todos zeram. */
  const known = new Set<string>();
  return {
    async load() {
      const out: MirrorCursor = {};
      for (const [key, state] of await cursors.list(MIRROR_CURSOR_SPORT, MIRROR_CURSOR_ENDPOINT)) {
        const params = new URLSearchParams(key);
        const kind = params.get('kind');
        params.delete('kind');
        if (!kind || params.toString() !== scopeKey) continue;
        known.add(kind);
        const after = state.cursor?.after;
        if (isPosition(after)) out[kind as keyof MirrorCursor] = after;
      }
      return out;
    },
    async save(cursor) {
      const at = now();
      for (const kind of new Set([...known, ...Object.keys(cursor)])) {
        known.add(kind);
        const after = cursor[kind as keyof MirrorCursor] ?? null;
        await cursors.complete(
          [{ sport: MIRROR_CURSOR_SPORT, endpoint: MIRROR_CURSOR_ENDPOINT, key: keyOf(kind, scopeKey) }],
          { after },
          at,
        );
      }
    },
  };
}
