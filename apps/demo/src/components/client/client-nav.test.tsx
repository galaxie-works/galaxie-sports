// @vitest-environment happy-dom
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { I18nProvider } from '@/lib/i18n/client';
import { LOCALES, type Locale } from '@/lib/i18n/config';
import { clientDictionary } from '@/lib/i18n/dictionary';
import { compareAlpha } from '@/lib/alphabetical';

import { ClientNavSheet, ClientSideNav } from './client-nav';
import {
  CLIENT_NAV,
  clientNavGroups,
  navRequirement,
  sectionsForState,
  STATES_WITH_NOTICE_ONLY,
} from './client-nav-shared';

afterEach(cleanup);

const wrap = (node: React.ReactElement, locale: Locale = 'pt-BR') => (
  <I18nProvider locale={locale} messages={clientDictionary(locale)}>
    {node}
  </I18nProvider>
);

describe('clientNavGroups', () => {
  it.each(LOCALES)('%s: grupos na ordem do estudo, áreas em ordem alfabética, sem grupo vazio', (locale) => {
    const nav = clientDictionary(locale).client.nav;
    const groups = clientNavGroups(nav);
    expect(groups.map((g) => g.id)).toEqual([
      'account',
      'content',
      'engagement',
      'intelligence',
      'integrations',
    ]);
    for (const g of groups) {
      const labels = g.items.map((i) => i.label);
      expect(labels).toEqual([...labels].sort(compareAlpha));
    }
    // nenhuma rota some na troca das abas pelo menu
    expect(groups.flatMap((g) => g.items.map((i) => i.href)).sort()).toEqual(
      CLIENT_NAV.map((i) => i.href).sort(),
    );
  });

  it('pt-BR: Conta e Conteúdo na ordem alfabética do idioma', () => {
    const groups = clientNavGroups(clientDictionary('pt-BR').client.nav);
    expect(groups[0]!.items.map((i) => i.label)).toEqual([
      'Chaves publicáveis',
      'Planos e módulos',
      'Usuários e cargos',
      'Visão geral',
    ]);
    expect(groups[1]!.items.map((i) => i.label)).toEqual([
      'Builder',
      'Grade e ofertas',
      'Minha lista de canais',
      'Temas',
    ]);
  });
});

describe('áreas por estado da conta (F3, decisão 8)', () => {
  it('trial, active e past_due abrem tudo; teste vencido e suspensa só Planos e módulos e Chaves', () => {
    for (const state of ['trial', 'active', 'past_due'] as const) expect(sectionsForState(state)).toBeNull();
    expect([...sectionsForState('trial_expired')!].sort()).toEqual(['keys', 'plans']);
    expect([...sectionsForState('suspended')!].sort()).toEqual(['keys', 'plans']);
  });

  it('em revisão, recusada, cancelada e em criação: só a visão geral, onde a tela do estado aparece', () => {
    for (const state of STATES_WITH_NOTICE_ONLY) expect(sectionsForState(state)).toEqual(['overview']);
    expect([...STATES_WITH_NOTICE_ONLY].sort()).toEqual(['cancelled', 'draft', 'pending_review', 'rejected']);
  });

  it.each(LOCALES)('%s: os 9 estados têm crachá e os avisos têm título e texto', (locale) => {
    const tenant = clientDictionary(locale).client.tenant;
    expect(Object.keys(tenant.states).sort()).toEqual([
      'active',
      'cancelled',
      'draft',
      'past_due',
      'pending_review',
      'rejected',
      'suspended',
      'trial',
      'trial_expired',
    ]);
    for (const state of [
      'draft',
      'pending_review',
      'rejected',
      'trial_expired',
      'past_due',
      'suspended',
      'cancelled',
    ] as const) {
      expect(tenant.stateNotice[state].title, `${locale} ${state}`).toBeTruthy();
      expect(tenant.stateNotice[state].body, `${locale} ${state}`).toBeTruthy();
    }
  });
});

describe('áreas por cargo e módulo (#1018, #1019)', () => {
  it('só as áreas visíveis aparecem; grupo sem área some', () => {
    const groups = clientNavGroups(clientDictionary('pt-BR').client.nav, ['overview']);
    expect(groups.map((g) => g.id)).toEqual(['account']);
    expect(groups[0]!.items.map((i) => i.id)).toEqual(['overview']);
  });

  it('chaves exigem keys.view, domínios domains.view e a equipe members.view', () => {
    expect(navRequirement('keys')).toEqual({ action: 'keys.view' });
    expect(navRequirement('domains')).toEqual({ action: 'domains.view' });
    expect(navRequirement('webhooks')).toEqual({ action: 'webhooks.view' });
    expect(navRequirement('builder')).toEqual({ action: 'builder.view' });
    expect(navRequirement('members')).toEqual({ action: 'members.view' });
    expect(navRequirement('overview')).toEqual({});
  });

  it('Cosmos AI exige cosmos.view (saldo e extrato não aparecem para Moderador nem Voluntário)', () => {
    expect(navRequirement('cosmos')).toEqual({ action: 'cosmos.view' });
  });

  it('a fila de moderação abre para quem modera uma sala só (escopo)', () => {
    expect(navRequirement('moderation')).toEqual({ action: 'moderation.queue.view', scoped: true });
  });
});

describe('ClientSideNav', () => {
  it('cada área é um link de verdade e a atual leva aria-current', () => {
    render(wrap(<ClientSideNav active="webhooks" />));
    const nav = screen.getByRole('navigation', { name: 'Áreas do painel do cliente' });
    const links = within(nav).getAllByRole('link');
    expect(links.map((l) => l.getAttribute('href')).sort()).toEqual(CLIENT_NAV.map((i) => i.href).sort());
    const current = within(nav).getByRole('link', { name: 'Webhooks' });
    expect(current.getAttribute('aria-current')).toBe('page');
    expect(links.filter((l) => l.getAttribute('aria-current') === 'page')).toHaveLength(1);
  });

  it('os grupos são botões que abrem e fecham (Enter/Espaço do botão nativo)', () => {
    render(wrap(<ClientSideNav active="overview" />));
    const group = screen.getByRole('button', { name: 'Conteúdo' });
    expect(group.tagName).toBe('BUTTON');
    expect(group.getAttribute('aria-expanded')).toBe('true');
    act(() => group.click());
    expect(group.getAttribute('aria-expanded')).toBe('false');
    act(() => group.click());
    expect(group.getAttribute('aria-expanded')).toBe('true');
    // o grupo da rota atual está aberto
    expect(screen.getByRole('button', { name: 'Conta' }).getAttribute('aria-expanded')).toBe('true');
  });

  it.each(LOCALES)('%s: rótulos no idioma da tela', (locale) => {
    render(wrap(<ClientSideNav active="overview" />, locale));
    const nav = clientDictionary(locale).client.nav;
    expect(screen.getByRole('navigation', { name: nav.label })).toBeTruthy();
    expect(screen.getByRole('button', { name: nav.groups.integrations })).toBeTruthy();
    expect(screen.getByRole('link', { name: nav.overview })).toBeTruthy();
  });
});

describe('ClientNavSheet', () => {
  it('o botão do topo diz a área atual e abre a gaveta com o mesmo menu', () => {
    render(wrap(<ClientNavSheet active="keys" />));
    const trigger = screen.getByRole('button', { name: 'Abrir o menu: Chaves publicáveis' });
    act(() => trigger.click());
    const dialog = screen.getByRole('dialog');
    const link = within(dialog).getByRole('link', { name: 'Chaves publicáveis' });
    expect(link.getAttribute('aria-current')).toBe('page');
    act(() => within(dialog).getByRole('link', { name: 'Webhooks' }).click());
    // a gaveta fecha ao navegar (o botão do topo volta a fechado; a saída anima)
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });
});
