/**
 * Item do menu da página atual quando o caminho dela não está no menu: um jogo do Brasileirão acende
 * "Futebol", um estádio acende o país. A página informa (pelo PageHeader) o caminho do pai de topo; a
 * sidebar lê daqui. Sem página informando, nada (vale só o caminho da URL).
 */

let section: string | null = null;
const listeners = new Set<() => void>();

export function setActiveSection(next: string | null) {
  if (next === section) return;
  section = next;
  listeners.forEach((l) => l());
}

export function subscribeActiveSection(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const getActiveSection = () => section;
export const getActiveSectionServer = (): string | null => null;
