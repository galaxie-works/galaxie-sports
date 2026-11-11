/**
 * Tema do Builder a partir do brandbook (#1004). Duas etapas com o mesmo arquivo (o PDF não fica guardado entre
 * elas): `etapa=estimar` devolve o custo estimado; `etapa=criar`, depois que o cliente confirma, reserva, lê o PDF e
 * devolve as versões clara e escura do tema. Nada é salvo: o editor abre preenchido e quem salva é o cliente.
 *
 * Rota (e não ação do servidor) porque o PDF vai até 20 MB, acima do teto das ações.
 */
import {
  BRANDBOOK_MAX_BYTES,
  isPdf,
  quoteBrandbook,
  readCosmosSettings,
  runBrandbook,
  type BrandbookErrorCode,
} from '@galaxie/cosmos';

import { builderDb } from '@/lib/builder/store';
import { can } from '@/lib/client/permissions';
import { readClientContext } from '@/lib/client/session';
import { getRequestLocale } from '@/lib/i18n/server';

/** Maior que o tempo máximo da leitura no provedor (150 s) e menor que o prazo da reserva (300 s). */
export const maxDuration = 200;

type ErrorCode =
  | BrandbookErrorCode
  | 'unauthorized'
  | 'staff'
  | 'module'
  | 'role'
  | 'bad_request'
  | 'too_large'
  | 'not_pdf'
  | 'quote_changed';

const STATUS: Partial<Record<ErrorCode, number>> = {
  unauthorized: 401,
  staff: 403,
  module: 403,
  role: 403,
  bad_request: 400,
  not_pdf: 415,
  too_large: 413,
  quote_changed: 409,
  unavailable: 503,
  failed: 502,
  unreadable: 422,
};

const fail = (code: ErrorCode) => Response.json({ ok: false, error: code }, { status: STATUS[code] ?? 402 });

export async function POST(request: Request) {
  const ctx = await readClientContext();
  if (!ctx?.tenant) return fail('unauthorized');
  // a equipe Galaxie não gasta créditos do cliente; a leitura do brandbook ainda não tem o caminho da equipe
  if (ctx.role === 'admin') return fail('staff');
  if (!ctx.tenant.modules.includes('cosmos_ai')) return fail('module');
  if (!can(ctx, 'cosmos.assistant.ask')) return fail('role');

  const step = new URL(request.url).searchParams.get('etapa');
  if (step !== 'estimar' && step !== 'criar') return fail('bad_request');
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > BRANDBOOK_MAX_BYTES + 64 * 1024) return fail('too_large');
  const form = await request.formData().catch(() => null);
  const file = form?.get('arquivo');
  if (!(file instanceof File)) return fail('bad_request');
  if (file.size > BRANDBOOK_MAX_BYTES) return fail('too_large');
  const pdf = new Uint8Array(await file.arrayBuffer());
  if (!isPdf(pdf)) return fail('not_pdf');

  const db = builderDb();
  const settings = await readCosmosSettings(db);
  const quote = await quoteBrandbook(db, { tenantId: ctx.tenant.id, pdf, settings });
  if (!quote) return fail('unavailable');
  if (step === 'estimar') return Response.json({ ok: true, credits: quote.credits, pages: quote.pages });

  // o cliente confirmou um valor; se o preço mudou no meio (outro arquivo, outro modelo), pede de novo
  if (Number(form!.get('creditos')) !== quote.credits) return fail('quote_changed');
  const result = await runBrandbook(db, {
    tenantId: ctx.tenant.id,
    userId: ctx.userId,
    pdf,
    fileName: file.name.slice(0, 120) || 'brandbook.pdf',
    locale: await getRequestLocale(),
    quote,
    settings,
    signal: request.signal,
  });
  if (!result.ok) return fail(result.error);
  return Response.json({
    ok: true,
    light: result.themes.light,
    dark: result.themes.dark,
    adjusted: result.themes.adjusted,
    notes: result.extract.notes,
    fonts: [result.extract.headingFont, result.extract.bodyFont].filter(Boolean),
    charged: result.charged,
  });
}
