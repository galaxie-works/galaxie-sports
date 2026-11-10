import { revalidatePath } from 'next/cache';

/** Áreas de Ajustes que leem o painel de Operação (o Sistema de antes, dividido no #1001). */
export const SYSTEM_PATHS = [
  '/ajustes/operacao',
  '/ajustes/fornecedor',
  '/ajustes/ia',
  '/ajustes/sistema',
] as const;

/** Depois de gravar uma flag, um job ou uma tarefa: as quatro áreas mostram o valor novo. */
export function revalidateSystem(): void {
  for (const path of SYSTEM_PATHS) revalidatePath(path);
}
