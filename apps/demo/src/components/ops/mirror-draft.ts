/**
 * Rascunho da tabela de períodos do espelho (Ajustes → Operação → Espelho): o que a pessoa digita em cada coluna de
 * tier, a validação de cada campo e o texto de MIRROR_PERIODS_<API> que vai para o servidor (que valida de novo).
 */
import {
  MIRROR_PERIOD_MAX_DAYS,
  MIRROR_PERIOD_MIN_DAYS,
  formatMirrorPeriods,
  mirrorConfig,
  mirrorItems,
  mirrorPeriodsKey,
  type MirrorPeriod,
} from '@galaxie/runtime-config';

export interface DraftCell {
  on: boolean;
  /** Dias como digitados (guardados também com a coluna desligada, para religar com o mesmo valor). */
  days: string;
}

export type MirrorDraft = Record<string, DraftCell[]>;

/** Rascunho a partir do valor efetivo da flag (painel, .env ou padrão). */
export function initialDraft(api: string, value: string | null): MirrorDraft {
  const cfg = mirrorConfig((key) => (key === mirrorPeriodsKey(api) ? value : null)).api(api);
  const out: MirrorDraft = {};
  for (const def of mirrorItems(api))
    out[def.id] = cfg.periods(def.id).map((p, i) => ({ on: p !== null, days: String(p ?? def.defaults[i]) }));
  return out;
}

const validDays = (text: string): number | null => {
  if (!/^\d+$/.test(text.trim())) return null;
  const n = Number(text);
  return n >= MIRROR_PERIOD_MIN_DAYS && n <= MIRROR_PERIOD_MAX_DAYS ? n : null;
};

export interface DraftState {
  /** Períodos por item (coluna inválida conta como desligada na estimativa). */
  periods: Map<string, MirrorPeriod[]>;
  /** Campos inválidos: `id#coluna`. */
  invalid: Set<string>;
  /** Texto canônico da flag (só o que difere do padrão). */
  text: string;
}

export function draftState(api: string, draft: MirrorDraft): DraftState {
  const periods = new Map<string, MirrorPeriod[]>();
  const invalid = new Set<string>();
  for (const def of mirrorItems(api)) {
    const cells = draft[def.id] ?? def.defaults.map((d) => ({ on: true, days: String(d) }));
    periods.set(
      def.id,
      cells.map((c, i) => {
        if (!c.on) return null;
        const n = validDays(c.days);
        if (n === null) invalid.add(`${def.id}#${i}`);
        return n;
      }),
    );
  }
  return { periods, invalid, text: formatMirrorPeriods(api, periods) };
}
