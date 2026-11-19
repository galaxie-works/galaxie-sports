import { describe, expect, it } from 'vitest';

import { parseInline, parseMarkdownBlocks, safeHref } from './cosmos-markdown';

describe('markdown das respostas da Cosmos (#1411)', () => {
  it('negrito, código, itálico e link viram pedaços, sem asteriscos', () => {
    expect(parseInline('Vi a tela de **Carteiras da Cosmos**, com `assistant.ask` e *calma*.')).toEqual([
      { type: 'text', text: 'Vi a tela de ' },
      { type: 'strong', text: 'Carteiras da Cosmos' },
      { type: 'text', text: ', com ' },
      { type: 'code', text: 'assistant.ask' },
      { type: 'text', text: ' e ' },
      { type: 'em', text: 'calma' },
      { type: 'text', text: '.' },
    ]);
    expect(parseInline('Abra [Pacotes](/settings/wallets).')).toEqual([
      { type: 'text', text: 'Abra ' },
      { type: 'link', text: 'Pacotes', href: '/settings/wallets' },
      { type: 'text', text: '.' },
    ]);
  });

  it('link fora do painel e sem https fica como texto', () => {
    expect(safeHref('//evil.example')).toBeNull();
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref('http://x.example')).toBeNull();
    expect(safeHref('https://galaxiesports.com/docs')).toBe('https://galaxiesports.com/docs');
    expect(parseInline('[clique](javascript:alert(1))')[0]).toEqual({ type: 'text', text: 'clique' });
  });

  it('separa títulos, listas e parágrafos', () => {
    const blocks = parseMarkdownBlocks(
      '### Pacotes\nCada pacote tem:\n\n- nome\n- créditos\n  e preço\n\n1. Abra a tela\n2. Toque em Novo\n\nPronto.',
    );
    expect(blocks).toEqual([
      { type: 'heading', text: 'Pacotes' },
      { type: 'paragraph', text: 'Cada pacote tem:' },
      { type: 'list', ordered: false, items: ['nome', 'créditos e preço'] },
      { type: 'list', ordered: true, items: ['Abra a tela', 'Toque em Novo'] },
      { type: 'paragraph', text: 'Pronto.' },
    ]);
  });
});
