/**
 * Gabarito oficial de uma plataforma brasileira (fornecido pelo dono do produto, que trabalha nela, a
 * partir da página oficial de planos) e a página renderizada dela, em `test/fixtures/lineups/`. Nomes da
 * plataforma neutros; canais e streamings como publicados. Só para testes.
 */
import { readFileSync } from 'node:fs';
import type { LineupPageContent } from '@galaxie/db';
import type { CountryDirectory } from '@galaxie/where-to-watch';

const dir = new URL('../../test/fixtures/lineups/', import.meta.url);

export interface Gabarito {
  plataforma: string;
  moeda: string;
  planos: {
    nome: string;
    preco_mensal: number;
    streamings_inclusos: string[];
    canais: string[];
    sem_os_canais: string[];
  }[];
  complementos: {
    nome: string;
    tipo: 'streaming' | 'canal';
    ofertas: { preco_mensal: number; fidelidade_meses: number | null }[];
  }[];
}

export const readGabarito = (): Gabarito =>
  JSON.parse(readFileSync(new URL('gabarito-br-plataforma-a.json', dir), 'utf8')) as Gabarito;

export const readRenderedPage = (): LineupPageContent & { url: string; lida_em: string } =>
  JSON.parse(readFileSync(new URL('pagina-br-plataforma-a.json', dir), 'utf8')) as LineupPageContent & {
    url: string;
    lida_em: string;
  };

/** Nomes do gabarito → ids do dicionário (os que o dicionário conhece) e os que ficam de fora. */
export function gabaritoIds(names: readonly string[], d: CountryDirectory, day: string) {
  const ids = new Set<string>();
  const unknown: string[] = [];
  for (const n of names) {
    const r = d.resolve(n, day);
    if (r) ids.add(r.entry.id);
    else unknown.push(n);
  }
  return { ids: [...ids].sort(), unknown };
}
