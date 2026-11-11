import { revalidatePath } from 'next/cache';

import { SETTINGS_VIEWS } from './panel-tabs';
import { settingsHref } from './settings-items';

/** Páginas de Ajustes que leem o painel de Operação (#1069), mais o Início, que junta o que pede ação. */
export const SYSTEM_PATHS: readonly string[] = [
  settingsHref('home'),
  ...(Object.keys(SETTINGS_VIEWS) as (keyof typeof SETTINGS_VIEWS)[]).map(settingsHref),
];

/** Depois de gravar uma flag, um job ou uma tarefa: todas as páginas mostram o valor novo. */
export function revalidateSystem(): void {
  for (const path of SYSTEM_PATHS) revalidatePath(path);
}
