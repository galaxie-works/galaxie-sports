// Dados de exemplo do vai e vem do mercado (#832) para a prévia do Builder e os testes: clubes e jogadores
// fictícios, nenhuma transferência real.
import type { GsTransfer, GsTransferKind, GsTransferList } from './core/model.js';

/** Tipo como a API classifica (`transferKind` de @galaxie/contracts), só para os textos de exemplo. */
function kindOf(type: string): { kind: GsTransferKind | null; fee: string | null } {
  if (/back/i.test(type)) return { kind: 'loan_return', fee: null };
  if (/loan/i.test(type)) return { kind: 'loan', fee: null };
  if (/free/i.test(type)) return { kind: 'free', fee: null };
  if (/[€$£]/.test(type)) return { kind: 'fee', fee: type };
  return { kind: 'transfer', fee: null };
}

const DAY_MS = 86_400_000;
const day = (now: Date, offset: number) =>
  new Date(now.getTime() - offset * DAY_MS).toISOString().slice(0, 10);

/** Escudo genérico (SVG em data URI) na cor do clube. */
function shield(color: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><path d="M16 2 4 6v9c0 7.5 5.1 13 12 15 6.9-2 12-7.5 12-15V6z" fill="${color}"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const AURORA = { id: '0199a5c0-0000-7000-8000-0000000000a1', name: 'Clube Aurora', logo: shield('#1d4ed8') };
const ESTRELA = {
  id: '0199a5c0-0000-7000-8000-0000000000a2',
  name: 'Estrela do Sul',
  logo: shield('#dc2626'),
};
const SERRA = { id: '0199a5c0-0000-7000-8000-0000000000a3', name: 'Atlético Serra', logo: shield('#15803d') };
const FORA = { id: null, name: 'Porto Atlântico FC', logo: null };
const LESTE = { id: null, name: 'Dínamo do Leste', logo: null };

const person = (n: number, name: string) => ({
  id: `0199a5c0-0000-7000-8000-0000000007${String(n).padStart(2, '0')}`,
  name,
  photo: null,
});

/** Todas as transferências de exemplo da liga, da mais recente para trás. */
function sample(now: Date): Omit<GsTransfer, 'direction' | 'kind' | 'fee'>[] {
  return [
    { person: person(1, 'Rafael Monteiro'), date: day(now, 3), type: 'Loan', from: FORA, to: AURORA },
    { person: person(2, 'Diego Albuquerque'), date: day(now, 9), type: '€ 4.2M', from: AURORA, to: LESTE },
    { person: person(3, 'Lucas Fontoura'), date: day(now, 15), type: 'Free', from: SERRA, to: AURORA },
    {
      person: person(4, 'Matheus Viana'),
      date: day(now, 26),
      type: 'Back from Loan',
      from: ESTRELA,
      to: AURORA,
    },
    { person: person(5, 'Thiago Barreto'), date: day(now, 40), type: '€ 1.5M', from: AURORA, to: ESTRELA },
    { person: person(6, 'Gabriel Nunes'), date: day(now, 52), type: 'Transfer', from: LESTE, to: SERRA },
    { person: person(7, 'André Siqueira'), date: day(now, 70), type: 'Loan', from: ESTRELA, to: FORA },
  ];
}

/**
 * Resposta de `/v1/teams/{id}/transfers` ou `/v1/competitions/{id}/transfers` com os dados de exemplo
 * (filtrada por `direction`, `days` e `limit` como a API); null quando a rota é outra.
 */
export function transfersPreviewBody(url: URL, now: Date): GsTransferList | null {
  const path = url.pathname.replace(/\/+$/, '');
  const m = /\/v1\/(teams|competitions)\/([^/]+)\/transfers$/.exec(path);
  if (!m) return null;
  const team = m[1] === 'teams';
  const id = decodeURIComponent(m[2]!);
  const q = url.searchParams;
  const direction = q.get('direction') ?? 'all';
  const days = Number(q.get('days')) || 180;
  const limit = Number(q.get('limit')) || 20;
  const since = day(now, days);
  const mine = new Set(team ? [id] : [AURORA.id, ESTRELA.id, SERRA.id]);
  const data: GsTransfer[] = [];
  for (const x of sample(now)) {
    if (!x.date || x.date < since) continue;
    const arrived = !!x.to.id && mine.has(x.to.id);
    const left = !!x.from.id && mine.has(x.from.id);
    if (direction === 'in' ? !arrived : direction === 'out' ? !left : !arrived && !left) continue;
    data.push({
      ...x,
      direction: direction === 'out' ? 'out' : arrived ? 'in' : 'out',
      ...kindOf(x.type ?? ''),
    });
  }
  const club = [AURORA, ESTRELA, SERRA].find((c) => c.id === id);
  return {
    scope: team
      ? { type: 'team', id, name: club?.name ?? AURORA.name, logo: club?.logo ?? AURORA.logo }
      : { type: 'competition', id, name: 'Liga Exemplo', logo: null },
    since,
    data: data.slice(0, limit),
  };
}
