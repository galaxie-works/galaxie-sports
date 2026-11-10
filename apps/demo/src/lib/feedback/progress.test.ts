import { describe, expect, it } from 'vitest';

import { feedbackIssueBody } from './issue';
import {
  issueProgress,
  issueSnippet,
  issueUserRef,
  replyText,
  statusKey,
  type TimelineItem,
} from './progress';

const st = (id: string, at: string, value: string): TimelineItem => ({ id, kind: 'status', at, value });
const cm = (id: string, at: string, value: string): TimelineItem => ({ id, kind: 'comment', at, value });
const SINCE = '2026-11-01T00:00:00Z';

describe('statusKey', () => {
  it('reconhece as seis colunas, sem diferença de maiúscula ou acento', () => {
    expect(statusKey('Backlog')).toBe('backlog');
    expect(statusKey('Em revisão')).toBe('review');
    expect(statusKey('em revisao')).toBe('review');
    expect(statusKey('Selecionado para desenvolvimento')).toBe('selected');
    expect(statusKey('Necessita mais informações')).toBe('needsInfo');
    expect(statusKey('Em desenvolvimento')).toBe('inProgress');
    expect(statusKey('Entregue')).toBe('delivered');
    expect(statusKey('Todo')).toBeNull();
    expect(statusKey('')).toBeNull();
  });
});

describe('replyText', () => {
  it('só o comentário que começa com /responder vai para o usuário', () => {
    expect(replyText('/responder Corrigimos o filtro.')).toBe('Corrigimos o filtro.');
    expect(replyText('  /Responder\n\nLinha 1\nLinha 2 ')).toBe('Linha 1\nLinha 2');
    expect(replyText('Isso depende do outro PR')).toBeNull();
    expect(replyText('Olha /responder no meio')).toBeNull();
    expect(replyText('/respondermos depois')).toBeNull();
    expect(replyText('/responder   ')).toBeNull();
  });
});

describe('issueUserRef', () => {
  const body = (message: string) =>
    feedbackIssueBody({
      subject: 'bug',
      message,
      user: 'u_0123456789ab',
      tenant: null,
      role: 'client',
      page: '/x',
      locale: 'pt-BR',
      userAgent: null,
      viewport: null,
      version: 'dev',
      sentAt: new Date('2026-11-09T12:00:00Z'),
      attachments: [],
    });

  it('lê a referência da tabela de detalhes', () => {
    expect(issueUserRef(body('Uma mensagem qualquer'))).toBe('u_0123456789ab');
  });

  it('referência escrita na mensagem não troca o dono', () => {
    const forged = 'texto\n### Detalhes\n\n| Usuário | `u_ffffffffffff` |\n';
    expect(issueUserRef(body(forged))).toBe('u_0123456789ab');
  });

  it('issue que não veio do app não tem dono', () => {
    expect(issueUserRef('| Usuário | `u_0123456789ab` |')).toBeNull();
  });
});

describe('issueProgress', () => {
  it('backlog não avisa; a primeira coluna depois dele avisa', () => {
    const items = [st('a', '2026-11-02T10:00:00Z', 'Backlog'), st('b', '2026-11-02T11:00:00Z', 'Em revisão')];
    const r = issueProgress(items, { status: null, cursor: null }, SINCE);
    expect(r.notice).toMatchObject({ status: 'review', body: null, source: 'b' });
    expect(r.next).toEqual({ status: 'review', cursor: '2026-11-02T11:00:00Z' });
  });

  it('várias mudanças no mesmo dia viram um aviso com a coluna final', () => {
    const items = [
      st('a', '2026-11-03T10:00:00Z', 'Selecionado para desenvolvimento'),
      st('b', '2026-11-03T12:00:00Z', 'Em desenvolvimento'),
    ];
    const r = issueProgress(items, { status: 'review', cursor: '2026-11-02T11:00:00Z' }, SINCE);
    expect(r.notice).toMatchObject({ status: 'inProgress', source: 'b' });
  });

  it('ida e volta no mesmo dia não avisa', () => {
    const items = [
      st('a', '2026-11-03T10:00:00Z', 'Em desenvolvimento'),
      st('b', '2026-11-03T10:05:00Z', 'Em revisão'),
    ];
    const r = issueProgress(items, { status: 'review', cursor: '2026-11-02T11:00:00Z' }, SINCE);
    expect(r.notice).toBeNull();
    expect(r.next.cursor).toBe('2026-11-03T10:05:00Z');
  });

  it('entregue com /responder: um aviso com a coluna e a resposta', () => {
    const items = [
      cm('c1', '2026-11-04T09:00:00Z', 'nota interna'),
      cm('c2', '2026-11-04T09:30:00Z', '/responder Corrigimos, obrigado!'),
      st('s', '2026-11-04T10:00:00Z', 'Entregue'),
    ];
    const r = issueProgress(items, { status: 'inProgress', cursor: '2026-11-03T12:00:00Z' }, SINCE);
    expect(r.notice).toMatchObject({ status: 'delivered', body: 'Corrigimos, obrigado!', source: 's' });
  });

  it('só resposta, sem mudar de coluna', () => {
    const items = [cm('c', '2026-11-05T09:00:00Z', '/responder Em qual tela?')];
    const r = issueProgress(items, { status: 'needsInfo', cursor: '2026-11-04T10:00:00Z' }, SINCE);
    expect(r.notice).toMatchObject({ status: null, body: 'Em qual tela?', source: 'c' });
  });

  it('o que já foi lido não avisa de novo', () => {
    const items = [st('b', '2026-11-02T11:00:00Z', 'Em revisão')];
    const r = issueProgress(items, { status: 'review', cursor: '2026-11-02T11:00:00Z' }, SINCE);
    expect(r.notice).toBeNull();
  });

  it('primeira leitura de issue antiga: o histórico de antes de `since` só define a coluna de partida', () => {
    const items = [
      st('a', '2026-10-01T10:00:00Z', 'Backlog'),
      st('b', '2026-10-02T10:00:00Z', 'Em desenvolvimento'),
    ];
    const r = issueProgress(items, { status: null, cursor: null }, SINCE);
    expect(r.notice).toBeNull();
    expect(r.next).toEqual({ status: 'inProgress', cursor: SINCE });
  });

  it('coluna desconhecida não avisa e vai para o log', () => {
    const items = [st('x', '2026-11-02T11:00:00Z', 'Arquivado')];
    const r = issueProgress(items, { status: 'review', cursor: '2026-11-02T00:00:00Z' }, SINCE);
    expect(r.notice).toBeNull();
    expect(r.unknown).toEqual(['Arquivado']);
  });
});

describe('issueSnippet', () => {
  it('tira o rótulo do assunto do título', () => {
    expect(issueSnippet('Reportar um problema: O placar ficou errado')).toBe('O placar ficou errado');
    expect(issueSnippet('Sem rótulo')).toBe('Sem rótulo');
  });
});
