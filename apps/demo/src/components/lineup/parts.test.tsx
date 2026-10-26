// @vitest-environment happy-dom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ItemLogo, loadableLogoUrl, logoInitials } from './parts';

afterEach(cleanup);

describe('loadableLogoUrl', () => {
  it('aceita http(s) e caminho da própria demo', () => {
    expect(loadableLogoUrl('https://assets.exemplo.test/broadcasters/ab.svg')).toBe(
      'https://assets.exemplo.test/broadcasters/ab.svg',
    );
    expect(loadableLogoUrl('/logo.png')).toBe('/logo.png');
  });

  it('recusa a origem gravada do acervo, outros esquemas e vazio', () => {
    expect(loadableLogoUrl('acervo-oficial://1-2')).toBeNull();
    expect(loadableLogoUrl('commons://File:Logo.svg')).toBeNull();
    expect(loadableLogoUrl('javascript:alert(1)')).toBeNull();
    expect(loadableLogoUrl('//outro.exemplo/x.png')).toBeNull();
    expect(loadableLogoUrl(null)).toBeNull();
  });
});

describe('ItemLogo', () => {
  it('sem logo: as iniciais', () => {
    const { container } = render(<ItemLogo name="Canal Exemplo" url={null} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toBe('CE');
  });

  it('origem que não é URL pública: as iniciais, sem imagem quebrada', () => {
    const { container } = render(<ItemLogo name="Canal Teste" url="acervo-oficial://12-34" />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toBe('CT');
  });

  it('imagem que não carrega: troca pelas iniciais', () => {
    const { container } = render(<ItemLogo name="Operadora Exemplo" url="https://x.exemplo.test/404.png" />);
    const img = container.querySelector('img')!;
    expect(img.getAttribute('src')).toBe('https://x.exemplo.test/404.png');
    fireEvent.error(img);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('[data-slot="logo-fallback"]')?.textContent).toBe('OE');
  });

  it('URL nova depois de uma que falhou: tenta a imagem de novo', () => {
    const { container, rerender } = render(<ItemLogo name="Canal" url="https://x.exemplo.test/a.png" />);
    fireEvent.error(container.querySelector('img')!);
    rerender(<ItemLogo name="Canal" url="https://x.exemplo.test/b.png" />);
    expect(container.querySelector('img')?.getAttribute('src')).toBe('https://x.exemplo.test/b.png');
  });

  it('iniciais de até duas palavras', () => {
    expect(logoInitials('canal  teste extra')).toBe('CT');
  });
});
