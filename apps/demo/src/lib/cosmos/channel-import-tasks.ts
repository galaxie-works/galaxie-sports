/**
 * Lista de canais de PDF, print ou planilha (#1008), no servidor: confere o arquivo, transforma a planilha em texto
 * (o PDF e a imagem vão como anexo), chama a função pela carteira (`runCosmosTask`) e devolve os nomes. Nada é
 * gravado aqui: o cliente revisa e envia pela ação de sempre (`uploadChannels`).
 */
import { activeFunctionMinCredits, parseModelJson, readCosmosSettings, runCosmosTask } from '@galaxie/cosmos';

import { builderDb } from '@/lib/builder/store';
import type { ClientContext } from '@/lib/client/session';
import type { Locale } from '@/lib/i18n/config';

import {
  CHANNEL_IMPORT_FUNCTION,
  channelImportPrompt,
  IMPORT_MAX_BYTES,
  IMPORT_MAX_OUTPUT_TOKENS,
  imageMediaType,
  importKind,
  parseChannelImportAnswer,
  SHEET_MAX_CHARS,
  sniffMatches,
  type ChannelImport,
} from './channel-import';
import { widgetTaskAccess, type WidgetTaskError } from './widget-tasks';
import { xlsxText } from './xlsx-text';

export type ChannelImportError =
  WidgetTaskError | 'fileType' | 'fileTooLarge' | 'fileEmpty' | 'fileUnreadable';

/** Mesma regra das outras funções do painel: `settings.manage` com a Cosmos contratada. */
export const channelImportAccess = widgetTaskAccess;

export async function channelImportMinimum(): Promise<number | null> {
  return activeFunctionMinCredits(builderDb(), CHANNEL_IMPORT_FUNCTION);
}

const LANGUAGE: Record<Locale, string> = {
  'pt-BR': 'Brazilian Portuguese',
  'es-AR': 'Spanish',
  en: 'English',
};

export async function importChannels(
  ctx: ClientContext,
  file: { name: string; bytes: Uint8Array },
  country: string | null,
  locale: Locale,
): Promise<{ ok: true; result: ChannelImport } | { ok: false; error: ChannelImportError }> {
  const denied = channelImportAccess(ctx);
  if (denied) return { ok: false, error: denied };
  const kind = importKind(file.name);
  if (!kind) return { ok: false, error: 'fileType' };
  if (!file.bytes.length) return { ok: false, error: 'fileEmpty' };
  if (file.bytes.length > IMPORT_MAX_BYTES) return { ok: false, error: 'fileTooLarge' };
  if (!sniffMatches(kind, file.bytes, file.name)) return { ok: false, error: 'fileType' };

  let sheet: string | null = null;
  if (kind === 'sheet') sheet = new TextDecoder().decode(file.bytes).slice(0, SHEET_MAX_CHARS);
  if (kind === 'xlsx') sheet = xlsxText(Buffer.from(file.bytes), SHEET_MAX_CHARS);
  if ((kind === 'sheet' || kind === 'xlsx') && !sheet?.trim()) return { ok: false, error: 'fileUnreadable' };
  const data = kind === 'pdf' || kind === 'image' ? Buffer.from(file.bytes).toString('base64') : null;
  const attachments =
    kind === 'pdf'
      ? [{ mediaType: 'application/pdf' as const, data: data!, name: 'grade.pdf' }]
      : kind === 'image'
        ? [{ mediaType: imageMediaType(file.name)!, data: data! }]
        : undefined;

  const prompt = channelImportPrompt({ sheet, country, language: LANGUAGE[locale] });
  const db = builderDb();
  const r = await runCosmosTask(
    db,
    {
      tenantId: ctx.tenant!.id,
      userId: ctx.userId,
      functionName: CHANNEL_IMPORT_FUNCTION,
      scope: 'channels',
      system: prompt.system,
      message: prompt.message,
      maxOutputTokens: IMPORT_MAX_OUTPUT_TOKENS,
      ...(attachments ? { attachments } : {}),
      metadata: { kind },
      evaluate: async (text) => {
        const result = parseChannelImportAnswer(parseModelJson(text));
        return { usable: result !== null, value: result! };
      },
      ...(ctx.role === 'admin' ? { staff: { route: '/cliente/canais#cosmos-import' } } : {}),
    },
    { settings: await readCosmosSettings(db) },
  );
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, result: r.value };
}
