import type { FanCheer } from '@galaxie/contracts';
import { checkChant } from '@galaxie/knowledge';

/** Campos do perfil semântico (`semantic.team_profile`) usados para o grito da torcida. */
export interface CheerSource {
  rallyingCries: string[] | null | undefined;
  copyHints: unknown;
  sources: string[] | null | undefined;
}

type CopyHints = Record<string, { cheer?: unknown } | undefined>;

/** Só gritos curtos: qualquer veredito de `checkChant` (erro ou aviso de "parece letra") descarta. */
const isShortCheer = (s: unknown): s is string => typeof s === 'string' && !!s.trim() && !checkChant(s);

/**
 * Grito da torcida para o card do evento: primeiro `copy_hints.<locale>.cheer` (locale exato e depois o
 * idioma, como em `/v1/teams/{id}/semantic` — pt-BR não cai para espanhol), depois `rallying_cries`
 * (grito público do clube, sem locale). Letras de hino ou canção nunca são servidas: o texto precisa
 * passar por `checkChant` sem erro nem aviso. `source_url` = primeira fonte do perfil, quando houver.
 */
export function pickCheer(profile: CheerSource | null | undefined, locale: string): FanCheer | null {
  if (!profile) return null;
  const hints = (profile.copyHints ?? {}) as CopyHints;
  const candidates: unknown[] = [];
  for (const l of [locale, locale.split('-')[0]!]) {
    const cheer = hints[l]?.cheer;
    if (Array.isArray(cheer)) {
      candidates.push(...cheer);
      break;
    }
  }
  candidates.push(...(profile.rallyingCries ?? []));
  const text = candidates.find(isShortCheer);
  if (!text) return null;
  const source = profile.sources?.find((u) => /^https?:\/\//.test(u));
  return source ? { text: text.trim(), source_url: source } : { text: text.trim() };
}
