'use server';

/**
 * Ação da lista de canais de arquivo (#1008): o arquivo vira a lista de nomes. O envio continua na ação de sempre
 * (`uploadChannels`), depois que o cliente revisa.
 */
import { isWtwCountry } from '@/lib/channel-list/server';
import { readClientContext } from '@/lib/client/session';
import { getDictionary } from '@/lib/i18n/dictionary';
import { getRequestLocale } from '@/lib/i18n/server';
import { fill } from '@/lib/i18n/text';

import { IMAGE_MAX_BYTES, IMPORT_MAX_BYTES, PDF_PAGES_MAX, type ChannelImport } from './channel-import';
import { importChannels, type ChannelImportError } from './channel-import-tasks';

export type ChannelImportActionResult = { ok: true; result: ChannelImport } | { ok: false; error: string };

export async function importChannelsWithCosmos(form: FormData): Promise<ChannelImportActionResult> {
  const [ctx, locale] = await Promise.all([readClientContext(), getRequestLocale()]);
  const T = getDictionary(locale).client.cosmosChannels.errors;
  const message = (code: ChannelImportError) =>
    code === 'fileTooLarge'
      ? fill(T.fileTooLarge, { max: `${IMPORT_MAX_BYTES / 1024 / 1024} MB` })
      : code === 'imageTooLarge'
        ? fill(T.imageTooLarge, { max: `${IMAGE_MAX_BYTES / 1024 / 1024} MB` })
        : code === 'tooManyPages'
          ? fill(T.tooManyPages, { max: PDF_PAGES_MAX })
          : (T[code] ?? T.failed);
  if (!ctx?.tenant) return { ok: false, error: T.unauthorized };
  const file = form.get('file');
  if (!(file instanceof File)) return { ok: false, error: T.fileEmpty };
  if (file.size > IMPORT_MAX_BYTES) return { ok: false, error: message('fileTooLarge') };
  const country = form.get('country');
  const r = await importChannels(
    ctx,
    { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) },
    typeof country === 'string' && isWtwCountry(country) ? country : null,
    locale,
  );
  return r.ok ? r : { ok: false, error: message(r.error) };
}
