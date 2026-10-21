/** Leitura pública do onde assistir (GET /v1/events/{id}/where-to-watch, docs/05 §4). */
import { and, eq, isNull } from 'drizzle-orm';
import { broadcastOption, event, type Database } from '@galaxie/db';
import type { BroadcastOptionRow } from './store.js';

/** Mensagem quando não há informação confiável — o evento continua existindo. */
export const UNKNOWN_MESSAGES: Record<string, string> = {
  'pt-BR': 'Não temos as informações de transmissão ainda.',
  'es-AR': 'Todavía no tenemos la información de transmisión.',
  'es-MX': 'Todavía no tenemos la información de transmisión.',
  'es-CO': 'Todavía no tenemos la información de transmisión.',
  'es-CL': 'Todavía no tenemos la información de transmisión.',
  'es-PE': 'Todavía no tenemos la información de transmisión.',
  'es-UY': 'Todavía no tenemos la información de transmisión.',
  'es-EC': 'Todavía no tenemos la información de transmisión.',
};

export function unknownMessage(locale: string): string {
  return (
    UNKNOWN_MESSAGES[locale] ??
    (locale.startsWith('es') ? UNKNOWN_MESSAGES['es-AR']! : UNKNOWN_MESSAGES['pt-BR']!)
  );
}

/** Ordem de exibição sugerida por meio (a ordenação final por direito de acesso é do cliente). */
export const MEDIUM_ORDER = [
  'free_tv',
  'youtube',
  'streaming_free',
  'pay_tv',
  'streaming_svod',
  'official_app',
  'radio',
] as const;

export interface PublicSource {
  publisher: string;
  url: string;
}

export interface PublicOption {
  row: BroadcastOptionRow;
  sources: PublicSource[];
}

export interface PublicWhereToWatch {
  eventId: string;
  country: string;
  status: 'resolved' | 'unknown';
  options: PublicOption[];
  updatedAt: Date | null;
}

/**
 * Opções publicadas (`confirmed`, versão vigente) de um evento × país. Com `region`, devolve as
 * nacionais + as daquela região; sem `region`, todas (cada uma com seu campo `region`).
 * Retorna null se o evento não existe.
 */
export async function getPublicWhereToWatch(
  db: Database,
  params: { eventId: string; country: string; region?: string | null },
): Promise<PublicWhereToWatch | null> {
  const [ev] = await db.select({ id: event.id }).from(event).where(eq(event.id, params.eventId));
  if (!ev) return null;
  const country = params.country.toUpperCase();
  const rows = await db
    .select()
    .from(broadcastOption)
    .where(
      and(
        eq(broadcastOption.eventId, params.eventId),
        eq(broadcastOption.countryCode, country),
        isNull(broadcastOption.supersededBy),
      ),
    );

  const region = params.region?.trim().toUpperCase() || null;
  const confirmed = rows.filter(
    (r) => r.status === 'confirmed' && (!region || r.region === null || r.region.toUpperCase() === region),
  );
  confirmed.sort(
    (a, b) =>
      MEDIUM_ORDER.indexOf(a.medium) - MEDIUM_ORDER.indexOf(b.medium) ||
      Number(b.confidence) - Number(a.confidence) ||
      a.providerName.localeCompare(b.providerName) ||
      (a.region ?? '').localeCompare(b.region ?? ''),
  );

  const options = confirmed.map((row) => {
    const seen = new Set<string>();
    const sources: PublicSource[] = [];
    for (const e of row.evidence) {
      if (e.stance === 'denies' || seen.has(e.url)) continue;
      seen.add(e.url);
      sources.push({ publisher: e.publisher ?? new URL(e.url).hostname, url: e.url });
    }
    return { row, sources };
  });

  const stamps = rows.flatMap((r) => [r.createdAt.getTime(), r.lastVerifiedAt.getTime()]);
  return {
    eventId: params.eventId,
    country,
    status: options.length ? 'resolved' : 'unknown',
    options,
    updatedAt: stamps.length ? new Date(Math.max(...stamps)) : null,
  };
}
