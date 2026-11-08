import * as z from 'zod';
import { AssetUrl, LocaleQuery } from './common.js';

// ─── Vai e vem do mercado: transferências de um time ou de um campeonato (#832) ─────────────────

/** Entradas (`in`), saídas (`out`) ou as duas (`all`). */
export const TRANSFER_DIRECTIONS = ['all', 'in', 'out'] as const;
export type TransferDirection = (typeof TRANSFER_DIRECTIONS)[number];

/**
 * Tipo da transferência, a partir do texto do fornecedor: `loan` (empréstimo), `loan_return` (volta de
 * empréstimo), `free` (sem custo), `fee` (com valor, em `fee`), `transfer` (definitiva, sem valor
 * publicado). null quando o fornecedor não diz.
 */
export const TRANSFER_KINDS = ['loan', 'loan_return', 'free', 'fee', 'transfer'] as const;
export type TransferKind = (typeof TRANSFER_KINDS)[number];

export const TransfersQuery = LocaleQuery.extend({
  direction: z
    .enum(TRANSFER_DIRECTIONS)
    .default('all')
    .meta({ description: 'Entradas (`in`), saídas (`out`) ou as duas (`all`, padrão).' }),
  days: z.coerce
    .number()
    .int()
    .min(1)
    .max(3650)
    .default(180)
    .meta({ description: 'Período: as transferências dos últimos N dias (1–3650, padrão 180).' }),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .default(20)
    .meta({ description: 'Máximo de transferências (1–100, padrão 20), das mais recentes para trás.' }),
});
export type TransfersQuery = z.input<typeof TransfersQuery>;

const TransferClub = z
  .object({
    id: z.uuid().nullable().meta({ description: 'null quando o clube não está no catálogo.' }),
    name: z.string(),
    logo: AssetUrl,
  })
  .meta({ id: 'TransferClub' });

export const Transfer = z
  .object({
    person: z.object({ id: z.uuid(), name: z.string(), photo: AssetUrl }),
    date: z.iso.date().nullable(),
    direction: z.enum(['in', 'out']).meta({
      description:
        'Do ponto de vista do recorte: `in` = chegou ao time (ou a um time do campeonato), `out` = saiu. ' +
        'Uma troca entre dois times do mesmo campeonato conta como `in` (com `direction=out`, como `out`).',
    }),
    kind: z.enum(TRANSFER_KINDS).nullable(),
    fee: z
      .string()
      .nullable()
      .meta({ description: 'Valor como o fornecedor publica, quando `kind` = `fee`.', example: '€ 2.5M' }),
    type: z.string().nullable().meta({ description: 'Texto original do fornecedor.', example: 'Loan' }),
    from: TransferClub,
    to: TransferClub,
  })
  .meta({ id: 'Transfer' });
export type Transfer = z.infer<typeof Transfer>;

export const TransferList = z
  .object({
    scope: z.object({
      type: z.enum(['team', 'competition']),
      id: z.uuid(),
      name: z.string(),
      logo: AssetUrl,
    }),
    since: z.iso.date().meta({ description: 'Início do período pedido (`days`).' }),
    data: z.array(Transfer).meta({ description: 'Da mais recente para a mais antiga.' }),
  })
  .meta({ id: 'TransferList' });
export type TransferList = z.infer<typeof TransferList>;

/** Texto do fornecedor ("Loan", "Free", "€ 2.5M", "Back from Loan", "N/A") → tipo e valor. */
export function transferKind(type: string | null | undefined): {
  kind: TransferKind | null;
  fee: string | null;
} {
  const t = type?.trim() ?? '';
  if (!t || /^n\/?a$/i.test(t) || t === '-') return { kind: null, fee: null };
  if (/back|return|end of loan|fim de empr/i.test(t)) return { kind: 'loan_return', fee: null };
  if (/loan|empr[eé]stimo|pr[eé]stamo/i.test(t)) return { kind: 'loan', fee: null };
  if (/free|livre|libre/i.test(t)) return { kind: 'free', fee: null };
  if (/[€$£]|\d/.test(t)) return { kind: 'fee', fee: t };
  if (/transfer|definitiv/i.test(t)) return { kind: 'transfer', fee: null };
  return { kind: null, fee: null };
}
