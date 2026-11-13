import type { Dictionary } from '@/lib/i18n/dictionary';
import { fill } from '@/lib/i18n/text';

type QuotaTexts = Dictionary['cosmos']['quotas'];

/** Nome da sala ou do produto na tela: `chat` → "Chat ao vivo (todas as salas)", `community:abc` → "Comunidade · abc". */
export function quotaScopeLabel(T: QuotaTexts, scope: string): string {
  const [product, id] = scope.split(':') as [keyof QuotaTexts['products'], string | undefined];
  if (!(product in T.products)) return scope;
  return id ? fill(T.room[product], { id }) : T.products[product];
}
