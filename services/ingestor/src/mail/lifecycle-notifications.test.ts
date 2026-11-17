import { describe, expect, it } from 'vitest';
import {
  composeLifecycleMail,
  dueLifecycleNotifications,
  moduleLabel,
  parseReminderDays,
  recipientEmails,
  type NotifiableTenant,
} from './lifecycle-notifications.js';
import { mailLocale } from './texts.js';

const NOW = new Date('2026-11-16T04:15:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
const settings = { trialReminderDays: [23, 29], moduleTrialReminderDaysBefore: 2 };

const trial = (sinceDays: number, endsInDays: number): NotifiableTenant => ({
  id: 't1',
  slug: 'marca',
  state: 'trial',
  stateSince: daysAgo(sinceDays),
  trialEndsAt: daysAgo(-endsInDays),
});

describe('quem recebe o quê no ciclo de vida (F3, decisão 11)', () => {
  it('lê os dias dos lembretes do painel', () => {
    expect(parseReminderDays('23,29')).toEqual([23, 29]);
    expect(parseReminderDays(' 29 , 23,23, x, 0')).toEqual([23, 29]);
    expect(parseReminderDays('')).toEqual([]);
  });

  it('o dia N do trial conta da entrada em trial: antes do dia 23 nada, no dia 23 o lembrete 23', () => {
    expect(dueLifecycleNotifications(trial(10, 20), NOW, settings)).toEqual([]);
    // state_since há 22 dias = dia 23 do trial
    const due = dueLifecycleNotifications(trial(22, 8), NOW, settings);
    expect(due).toEqual([
      {
        tenantId: 't1',
        kind: 'trial_reminder',
        ref: '23',
        send: true,
        vars: { day: 23, days: 8, date: daysAgo(-8) },
      },
    ]);
  });

  it('com dois lembretes devidos de uma vez, só o mais tardio é enviado; o outro fica só registrado', () => {
    const due = dueLifecycleNotifications(trial(28, 1), NOW, settings);
    expect(due.map((d) => [d.ref, d.send])).toEqual([
      ['23', false],
      ['29', true],
    ]);
    expect(due[1]!.vars.days).toBe(1);
  });

  it('trial sem prazo ou já vencido não manda lembrete (o vencido vira trial_expired pelo relógio)', () => {
    expect(dueLifecycleNotifications({ ...trial(25, 1), trialEndsAt: null }, NOW, settings)).toEqual([]);
    expect(dueLifecycleNotifications(trial(31, -1), NOW, settings)).toEqual([]);
  });

  it('trial vencido, suspensão e cancelamento avisam só quando a mudança é recente', () => {
    const expired: NotifiableTenant = { ...trial(0, 0), state: 'trial_expired', stateSince: NOW };
    expect(dueLifecycleNotifications(expired, NOW, settings)).toEqual([
      { tenantId: 't1', kind: 'trial_expired', ref: '', send: true, vars: { date: NOW } },
    ]);
    const old: NotifiableTenant = { ...expired, stateSince: daysAgo(10) };
    expect(dueLifecycleNotifications(old, NOW, settings)).toEqual([]);
    const suspended: NotifiableTenant = { ...expired, state: 'suspended', stateSince: daysAgo(1) };
    expect(dueLifecycleNotifications(suspended, NOW, settings)).toEqual([
      {
        tenantId: 't1',
        kind: 'suspended',
        ref: daysAgo(1).toISOString(),
        send: true,
        vars: { date: daysAgo(1) },
      },
    ]);
    const cancelled: NotifiableTenant = { ...expired, state: 'cancelled', stateSince: daysAgo(2) };
    expect(dueLifecycleNotifications(cancelled, NOW, settings).map((d) => d.kind)).toEqual(['cancelled']);
    // active e past_due não têm aviso de estado
    expect(dueLifecycleNotifications({ ...expired, state: 'active' }, NOW, settings)).toEqual([]);
    expect(dueLifecycleNotifications({ ...expired, state: 'past_due' }, NOW, settings)).toEqual([]);
  });

  it('teste de módulo acabando: só dentro da janela, só do tenant, só com acesso', () => {
    const active: NotifiableTenant = { ...trial(100, 0), state: 'active', trialEndsAt: null };
    const trials = [
      { tenantId: 't1', module: 'chat', endsAt: daysAgo(-1.5) },
      { tenantId: 't1', module: 'communities', endsAt: daysAgo(-5) },
      { tenantId: 't1', module: 'shopping', endsAt: daysAgo(1) },
      { tenantId: 'outro', module: 'chat', endsAt: daysAgo(-1) },
    ];
    expect(dueLifecycleNotifications(active, NOW, settings, trials)).toEqual([
      {
        tenantId: 't1',
        kind: 'module_trial_ending',
        ref: 'chat',
        send: true,
        vars: { days: 2, date: daysAgo(-1.5), module: 'chat' },
      },
    ]);
    expect(dueLifecycleNotifications({ ...active, state: 'suspended' }, NOW, settings, trials)).toEqual([]);
  });

  it('recebem os Donos e o Financeiro, um por e-mail, Dono primeiro', () => {
    expect(
      recipientEmails([
        { email: 'Fin@Exemplo.test', role: 'billing' },
        { email: 'dono@exemplo.test', role: 'owner' },
        { email: 'dono@exemplo.test', role: 'billing' },
        { email: null, role: 'owner' },
        { email: 'dev@exemplo.test', role: 'developer' },
      ]),
    ).toEqual(['dono@exemplo.test', 'fin@exemplo.test']);
  });

  it('o texto sai no idioma da organização, com o prazo, e o botão leva à loja quando ela existe', () => {
    const due = dueLifecycleNotifications(trial(28, 1), NOW, settings)[1]!;
    const links = {
      console: 'https://console.example/client',
      store: 'https://console.example/client/plans',
    };
    const pt = composeLifecycleMail(
      due,
      { tenantName: 'Marca' },
      { email: 'a@b.test', name: 'Ana Lima' },
      'pt-BR',
      links,
      null,
    );
    expect(pt.subject).toBe('O teste da marca Marca termina amanhã');
    expect(pt.text).toContain('Olá, Ana!');
    expect(pt.text).toContain('dia 29 do teste');
    expect(pt.text).toContain('Ver planos e módulos: https://console.example/client/plans');
    const en = composeLifecycleMail(
      { ...due, vars: { ...due.vars, days: 7 } },
      { tenantName: 'Brand' },
      { email: 'a@b.test', name: null },
      'en',
      { console: links.console, store: null },
      null,
    );
    expect(en.subject).toBe("Brand's trial ends in 7 days");
    expect(en.text).toContain('Hi!');
    expect(en.text).toContain('Open the console: https://console.example/client');
    const es = composeLifecycleMail(
      {
        tenantId: 't1',
        kind: 'module_trial_ending',
        ref: 'chat',
        send: true,
        vars: { days: 2, date: NOW, module: 'chat' },
      },
      { tenantName: 'Marca' },
      { email: 'a@b.test', name: 'Luis' },
      'es',
      { console: null, store: null },
      moduleLabel({ modules: { chat: { name: 'Chat ao vivo' } } } as never, 'chat'),
    );
    expect(moduleLabel(null, 'chat')).toBe('chat');
    expect(es.subject).toBe('La prueba del módulo Chat ao vivo termina en 2 días');
    expect(es.text).not.toContain('http');
  });

  it('o idioma da organização vira um dos três', () => {
    expect(mailLocale('es-AR')).toBe('es');
    expect(mailLocale('es-MX')).toBe('es');
    expect(mailLocale('en-US')).toBe('en');
    expect(mailLocale('pt-BR')).toBe('pt-BR');
    expect(mailLocale(null)).toBe('pt-BR');
  });
});
