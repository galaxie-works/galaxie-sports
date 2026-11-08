import { describe, expect, it } from 'vitest';

import { codeCell, feedbackIssueBody, feedbackIssueTitle, fenced } from './issue';

const base = {
  subject: 'bug' as const,
  message: 'O placar travou',
  user: 'u_0123456789ab',
  tenant: 't_ba9876543210',
  role: 'client',
  page: '/eventos/1',
  locale: 'pt-BR',
  userAgent: 'Mozilla/5.0',
  viewport: '1440x900',
  version: 'abc',
  sentAt: new Date('2026-11-07T01:00:00Z'),
  attachments: [],
};

describe('título', () => {
  it('assunto + primeiros 50 caracteres', () => {
    expect(feedbackIssueTitle('content', 'x'.repeat(60))).toBe(
      `Sugerir correção de um conteúdo: ${'x'.repeat(50)}…`,
    );
  });
});

describe('corpo', () => {
  it('ficha com as referências opacas, a hora de Brasília e o rótulo', () => {
    const body = feedbackIssueBody(base);
    expect(body).toContain('| Usuário | `u_0123456789ab` |');
    expect(body).toContain('| Tenant | `t_ba9876543210` |');
    expect(body).toContain('06/11/2026, 22:00 (Brasília)');
    expect(body).toContain('| Assunto | Reportar um problema |');
  });

  it('a mensagem fica num bloco de texto que ela não consegue fechar', () => {
    const evil =
      'oi\n~~~\n![x](https://rastreio.exemplo/p.gif) @alguem <!-- x --> outra/repo#1\n| a | b |\n~~~~~';
    const body = feedbackIssueBody({ ...base, message: evil });
    const block = fenced(evil);
    expect(block.startsWith('~~~~~~text\n')).toBe(true);
    expect(block.endsWith('\n~~~~~~')).toBe(true);
    expect(body).toContain(block);
    // fora do bloco nada do usuário vira imagem
    const outside = body.replace(block, '');
    expect(outside).not.toContain('rastreio');
  });

  it('células de navegador e tela não escapam do code nem da tabela', () => {
    expect(codeCell('a`b|c\nd')).toBe("`a'b/c d`");
    expect(codeCell(null)).toBe('—');
  });

  it('anexos viram imagem com texto alternativo limpo', () => {
    const body = feedbackIssueBody({
      ...base,
      attachments: [
        { url: 'https://sports.exemplo/api/feedback/anexo/2026-11/x.png?e=1&s=a', name: 'print](x)[.png' },
      ],
    });
    expect(body).toContain(
      '![print(x).png](https://sports.exemplo/api/feedback/anexo/2026-11/x.png?e=1&s=a)',
    );
  });
});
