import { describe, expect, it } from 'vitest';

import {
  awaitsDecision,
  emailDomain,
  emailMatchesDomains,
  findInLineup,
  flattenLineup,
  isTargetId,
  lineupFiltersQuery,
  lineupView,
  matchesFilters,
  parseAdminTab,
  parseDomains,
  parseLineupFilters,
  parseProposed,
  parseRequestFilters,
  planCurrentAt,
  proposedView,
  type LibraryEntry,
  type LineupLike,
} from './types';

const ID = (n: number) => `01a20000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const review = (extra: Record<string, unknown> = {}) => ({
  reviewStatus: 'approved',
  sources: [{ url: 'https://operadora.example/planos', seen_at: '2026-10-20T12:00:00Z', kind: 'research' }],
  proposedChange: null,
  reviewedBy: null,
  reviewedAt: null,
  seenAt: '2026-10-20T12:00:00Z',
  ...extra,
});

const raw: LineupLike = {
  platform: {
    ...review(),
    id: ID(1),
    name: 'Operadora Exemplo',
    kind: 'pay_tv_operator',
    country: 'BR',
    website: 'https://operadora.example',
    logoAssetId: null,
    broadcasterId: null,
  },
  plans: [
    {
      plan: {
        ...review(),
        id: ID(11),
        name: 'Plano Essencial',
        priceText: 'R$ 89,90',
        url: null,
        validFrom: null,
        validTo: '2026-12-31',
      },
      channels: [{ ...review(), planId: ID(11), channelId: 'canal-exemplo', access: 'included' }],
      services: [
        {
          ...review({
            reviewStatus: 'approved',
            proposedChange: { access: 'addon', seen_at: '2026-10-24' },
            sources: [
              {
                url: null,
                seen_at: '2026-10-24T00:00:00Z',
                kind: 'operator',
                note: 'informado pela operadora',
              },
            ],
          }),
          planId: ID(11),
          serviceId: 'streaming-exemplo',
          access: 'included',
        },
      ],
    },
  ],
};
const library = new Map<string, LibraryEntry>([
  [
    'canal-exemplo',
    { id: 'canal-exemplo', name: 'Canal Exemplo', kind: 'pay_tv', logoUrl: 'https://cdn.example/c.png' },
  ],
  [
    'streaming-exemplo',
    { id: 'streaming-exemplo', name: 'Streaming Exemplo', kind: 'streaming', logoUrl: null },
  ],
]);
const lineup = lineupView(raw, library);

describe('grade como vai ao navegador', () => {
  it('nomes e logos da biblioteca, ids dos vínculos e os campos que a operadora pode corrigir', () => {
    expect(lineup.platform).toMatchObject({
      type: 'platform',
      name: 'Operadora Exemplo',
      country: 'BR',
      kind: 'pay_tv_operator',
      fields: { name: 'Operadora Exemplo', website: 'https://operadora.example' },
    });
    const plan = lineup.plans[0]!;
    expect(plan.fields).toEqual({ name: 'Plano Essencial', priceText: 'R$ 89,90', url: null });
    expect(plan.channels[0]).toMatchObject({
      id: `${ID(11)}:canal-exemplo`,
      name: 'Canal Exemplo',
      logoUrl: 'https://cdn.example/c.png',
      fields: { access: 'included' },
    });
    expect(plan.channels[0]!.sources[0]).toEqual({
      url: 'https://operadora.example/planos',
      seenAt: '2026-10-20T12:00:00.000Z',
      operator: false,
      note: null,
    });
  });

  it('fonte da operadora, mudança encontrada e item sem nome na biblioteca', () => {
    const service = lineup.plans[0]!.services[0]!;
    expect(service.sources[0]).toMatchObject({ url: null, operator: true });
    expect(service.pendingChange).toEqual({ access: 'addon', seen_at: '2026-10-24' });
    expect(awaitsDecision(service)).toBe(true);
    expect(awaitsDecision(lineup.plans[0]!.channels[0]!)).toBe(false);
    const orphan = lineupView(raw, new Map()).plans[0]!.channels[0]!;
    expect(orphan.name).toBe('canal-exemplo');
  });

  it('achata a grade e acha um item só pelo tipo e id certos', () => {
    expect(flattenLineup(lineup).map((i) => [i.type, i.planName])).toEqual([
      ['platform', null],
      ['plan', null],
      ['plan_channel', 'Plano Essencial'],
      ['plan_service', 'Plano Essencial'],
    ]);
    expect(findInLineup(lineup, 'plan_channel', `${ID(11)}:canal-exemplo`)?.name).toBe('Canal Exemplo');
    expect(findInLineup(lineup, 'plan_service', `${ID(11)}:canal-exemplo`)).toBeNull();
    expect(findInLineup(lineup, 'plan', ID(999))).toBeNull();
  });

  it('vigência do plano', () => {
    expect(planCurrentAt(lineup.plans[0]!, '2026-10-24')).toBe(true);
    expect(planCurrentAt(lineup.plans[0]!, '2027-01-01')).toBe(false);
  });

  it('ids de item no formato do banco', () => {
    expect(isTargetId('plan', ID(1))).toBe(true);
    expect(isTargetId('plan', `${ID(1)}:x`)).toBe(false);
    expect(isTargetId('plan_channel', `${ID(1)}:canal-exemplo`)).toBe(true);
    expect(isTargetId('plan_channel', `nao-uuid:canal`)).toBe(false);
    expect(isTargetId('plan_service', `${ID(1)}:`)).toBe(false);
    expect(isTargetId('platform', 42)).toBe(false);
  });
});

describe('correção proposta pela operadora', () => {
  it('fica só com os campos do tipo, aparados, sem vazios nem valor igual ao atual', () => {
    expect(
      parseProposed(
        'plan',
        { name: '  Plano  Exemplo   Max ', priceText: 'R$ 89,90', id: 'x' },
        {
          name: 'Plano Essencial',
          priceText: 'R$ 89,90',
        },
      ),
    ).toEqual({ name: 'Plano Exemplo Max' });
    expect(parseProposed('platform', { website: 'https://novo.example' })).toEqual({
      website: 'https://novo.example',
    });
    expect(parseProposed('plan', { priceText: '   ' })).toBeNull();
    expect(parseProposed('plan', ['x'])).toBeNull();
    expect(parseProposed('platform', { name: 'a'.repeat(500) })!.name).toHaveLength(200);
  });

  it('acesso só incluso ou adicional; tirar da grade só onde dá', () => {
    expect(parseProposed('plan_channel', { access: 'addon' }, { access: 'included' })).toEqual({
      access: 'addon',
    });
    expect(parseProposed('plan_channel', { access: 'gratis' })).toBeNull();
    expect(parseProposed('plan_service', { removed: true, access: 'addon' })).toEqual({ removed: true });
    expect(parseProposed('platform', { removed: true })).toBeNull();
  });

  it('lê a correção gravada só com campos conhecidos', () => {
    expect(proposedView('plan_service', { access: 'addon', priceText: '1', name: 'x' })).toEqual({
      access: 'addon',
    });
    expect(proposedView('plan', { removed: true })).toEqual({ removed: true });
    expect(proposedView('plan', null)).toBeNull();
  });
});

describe('domínios de e-mail da operadora', () => {
  it('normaliza a lista digitada e separa os inválidos', () => {
    expect(parseDomains('@Operadora.example, *.tv.operadora.example\noperadora.example; nada')).toEqual({
      domains: ['operadora.example', 'tv.operadora.example'],
      invalid: ['nada'],
    });
    expect(parseDomains('')).toEqual({ domains: [], invalid: [] });
  });

  it('confere domínio e subdomínio; sem domínios cadastrados, não avisa', () => {
    const domains = ['operadora.example'];
    expect(emailMatchesDomains('ana@operadora.example', domains)).toBe(true);
    expect(emailMatchesDomains('Ana@TV.Operadora.example', domains)).toBe(true);
    expect(emailMatchesDomains('ana@agencia.example', domains)).toBe(false);
    expect(emailMatchesDomains('ana@naooperadora.example', domains)).toBe(false);
    expect(emailMatchesDomains('sem-arroba', domains)).toBe(false);
    expect(emailMatchesDomains('ana@agencia.example', [])).toBe(true);
    expect(emailDomain(' Ana@Operadora.Example ')).toBe('operadora.example');
  });
});

describe('filtros da URL', () => {
  it('revisão abre no que espera decisão; "todos" tira o filtro de situação', () => {
    expect(parseLineupFilters({})).toEqual({ country: null, platform: null, type: null, status: 'pending' });
    expect(
      parseLineupFilters(new URLSearchParams(`pais=br&plataforma=${ID(1)}&tipo=plan_channel&status=todos`)),
    ).toEqual({ country: 'BR', platform: ID(1), type: 'plan_channel', status: null });
    expect(
      parseLineupFilters({ pais: 'Brasil', plataforma: 'x', tipo: 'canal', status: 'reviewed' }),
    ).toEqual({
      country: null,
      platform: null,
      type: null,
      status: 'reviewed',
    });
  });

  it('ida e volta pela query', () => {
    const f = parseLineupFilters({ pais: 'AR', status: 'approved' });
    expect(parseLineupFilters(new URLSearchParams(lineupFiltersQuery(f).slice(1)))).toEqual(f);
    expect(
      parseLineupFilters(new URLSearchParams(lineupFiltersQuery({ ...f, status: null }).slice(1))).status,
    ).toBeNull();
  });

  it('abas e fila de pedidos', () => {
    expect(parseAdminTab({ aba: 'pedidos' })).toBe('pedidos');
    expect(parseAdminTab({ aba: 'qualquer' })).toBe('revisao');
    expect(parseRequestFilters({})).toEqual({ status: 'open' });
    expect(parseRequestFilters({ status: 'todos' })).toEqual({ status: null });
  });

  it('aplica país, plataforma, tipo e situação (pendente inclui mudança encontrada)', () => {
    const platform = { id: ID(1), country: 'BR' };
    const channel = lineup.plans[0]!.channels[0]!;
    const service = lineup.plans[0]!.services[0]!;
    const all = { country: null, platform: null, type: null, status: null };
    expect(
      matchesFilters(channel, platform, { ...all, country: 'BR', type: 'plan_channel', status: 'approved' }),
    ).toBe(true);
    expect(matchesFilters(channel, platform, { ...all, country: 'AR' })).toBe(false);
    expect(matchesFilters(channel, platform, { ...all, type: 'plan' })).toBe(false);
    expect(matchesFilters(channel, platform, { ...all, status: 'pending' })).toBe(false);
    expect(matchesFilters(service, platform, { ...all, status: 'pending' })).toBe(true);
  });
});
