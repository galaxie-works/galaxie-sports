// @vitest-environment happy-dom
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { I18nProvider } from '@/lib/i18n/client';
import { LOCALES, type Locale } from '@/lib/i18n/config';
import { clientDictionary } from '@/lib/i18n/dictionary';
import { compareAlpha } from '@/lib/alphabetical';

import { CLIENT_NAV, ClientNavSheet, ClientSideNav, clientNavGroups, navRequirement } from './client-nav';

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
    expect(groups.map((g) => g.id)).toEqual(['account', 'content', 'integrations']);
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

describe('áreas por cargo e módulo (#1018, #1019)', () => {
  it('só as áreas visíveis aparecem; grupo sem área some', () => {
    const groups = clientNavGroups(clientDictionary('pt-BR').client.nav, ['overview']);
    expect(groups.map((g) => g.id)).toEqual(['account']);
    expect(groups[0]!.items.map((i) => i.id)).toEqual(['overview']);
  });

  it('configuração exige settings.manage e a equipe exige members.view', () => {
    expect(navRequirement('keys')).toEqual({ action: 'settings.manage' });
    expect(navRequirement('members')).toEqual({ action: 'members.view' });
    expect(navRequirement('overview')).toEqual({});
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
