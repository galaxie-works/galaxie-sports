import { describe, expect, it } from 'vitest';
import {
  cleanFigmaSvg,
  decodeXmlText,
  fixMojibake,
  officialLogoFile,
  parseFigmaChannelFrames,
} from './official-logos.js';

/** Export do Figma de um símbolo: fundo da página, frame escuro do acervo e borda tracejada em volta. */
const EXPORT = `<svg width="64" height="48" viewBox="0 0 64 48" fill="none" xmlns="http://www.w3.org/2000/svg">
<rect width="64" height="48" fill="#F5F5F5"/>
<g id="Channel Logos">
<g clip-path="url(#clip0_335_3346)">
<rect x="-904" y="-4740" width="1192" height="14964" rx="24" fill="#1B1B1B"/>
<g id="Content">
<g id="Middle">
<g id="A">
<g id="Rows">
<g id="Row">
<g id="A/Am&#195;&#169;rica TV">
<rect x="-23.5" y="-23.5" width="111" height="167" rx="3.5" stroke="#00AEEF" stroke-dasharray="10 5"/>
<g id="Theme=Dark">
<g id="Logo">
<path id="Vector" d="M0 16H64V32H0Z" fill="url(#paint0_linear_335_3346)"/>
<rect id="img" width="10" height="10" fill="url(#pattern0_335_3346)"/>
</g>
</g>
</g>
</g>
</g>
</g>
</g>
</g>
</g>
</g>
<defs>
<linearGradient id="paint0_linear_335_3346" x1="0" y1="0" x2="64" y2="0" gradientUnits="userSpaceOnUse">
<stop stop-color="#0224FF"/>
<stop offset="1" stop-color="#00DC4E"/>
</linearGradient>
<pattern id="pattern0_335_3346" patternContentUnits="objectBoundingBox" width="1" height="1">
<use xlink:href="#image0_335_3346" transform="scale(0.01)"/>
</pattern>
<clipPath id="clip0_335_3346">
<rect x="-904" y="-4740" width="1192" height="14964" rx="24" fill="white"/>
</clipPath>
<image id="image0_335_3346" width="100" height="100" xlink:href="data:image/png;base64,AAAA"/>
</defs>
</svg>
`;

describe('SVG exportado do acervo', () => {
  it('fica só o símbolo, sem o fundo da página, o frame do acervo e a borda tracejada', () => {
    const { svg, componentName } = cleanFigmaSvg(EXPORT);
    expect(componentName).toBe('A/América TV');
    expect(svg).toMatch(/^<svg width="64" height="48" viewBox="0 0 64 48" fill="none"/);
    expect(svg).toContain('<g id="Theme=Dark">');
    expect(svg).toContain('d="M0 16H64V32H0Z"');
    expect(svg).not.toContain('#F5F5F5');
    expect(svg).not.toContain('#1B1B1B');
    expect(svg).not.toContain('stroke-dasharray');
    expect(svg).not.toContain('clip0_335_3346');
  });

  it('mantém as definições usadas pelo símbolo, inclusive as indiretas (padrão → imagem)', () => {
    const { svg } = cleanFigmaSvg(EXPORT);
    expect(svg).toContain('<linearGradient id="paint0_linear_335_3346"');
    expect(svg).toContain('<pattern id="pattern0_335_3346"');
    expect(svg).toContain('<image id="image0_335_3346"');
    expect(svg).toContain('xmlns:xlink="http://www.w3.org/1999/xlink"');
    // o resultado é estável (mesmo conteúdo = mesma chave no bucket)
    expect(cleanFigmaSvg(EXPORT).svg).toBe(svg);
  });

  it('recusa SVG sem o grupo do componente', () => {
    expect(() => cleanFigmaSvg('<svg width="1" height="1"><rect/></svg>')).toThrow(/símbolo/);
    expect(() => cleanFigmaSvg('nada')).toThrow(/<svg>/);
  });

  it('nomes: entidades e UTF-8 lido como Latin-1 voltam ao texto certo', () => {
    expect(decodeXmlText('A&amp;E')).toBe('A&E');
    expect(fixMojibake(decodeXmlText('Se&#195;&#177;al Colombia'))).toBe('Señal Colombia');
    expect(fixMojibake('Telefé')).toBe('Telefé');
    expect(fixMojibake('ESPN')).toBe('ESPN');
  });

  it('arquivo do símbolo na pasta exportada', () => {
    expect(officialLogoFile('335:20142')).toBe('335-20142.svg');
  });
});

describe('metadados do frame do acervo (get_metadata)', () => {
  const XML = `<canvas id="335:3346" name="Canais" x="0" y="0" width="0" height="0">
  <frame id="335:3347" name="Channel Logos" x="0" y="0" width="1192" height="14964">
    <frame id="335:3348" name="Content" x="0" y="0" width="1192" height="15348">
      <frame id="335:3349" name="Top" x="0" y="0" width="1192" height="152">
        <instance id="335:3350" name="_Header" x="0" y="0" width="1192" height="152" />
      </frame>
      <frame id="335:3351" name="Middle" x="0" y="200" width="1192" height="15084">
        <frame id="335:3352" name="A" x="0" y="0" width="1192" height="860">
          <instance id="335:3353" name="_Category" x="0" y="0" width="1192" height="84" />
          <frame id="335:3354" name="Rows" x="0" y="116" width="1192" height="744">
            <frame id="335:3355" name="Row" x="0" y="0" width="1192" height="168">
              <frame id="335:3417" name="A/A&amp;E" x="200" y="0" width="112" height="168">
                <symbol id="335:3418" name="Theme=Light" x="24" y="24" width="64" height="48" />
                <symbol id="335:3421" name="Theme=Dark" x="24" y="96" width="64" height="48" />
              </frame>
              <frame id="335:18878" name="E/El Siete" x="336" y="0" width="112" height="168">
                <symbol id="335:18879" name="Theme=Light" x="24" y="24" width="64" height="48" />
                <symbol id="335:18898" name="Theme=El siete, Property 2=Canal 7 de Mendoza, Property 3=Dark" x="24" y="96" width="64" height="48" />
              </frame>
              <frame id="336:1" name="B/Baby TV HD" x="472" y="0" width="112" height="168">
                <symbol id="336:2" name="Theme=Default" x="24" y="24" width="64" height="48" />
              </frame>
              <frame id="336:10" name="T/Teledoce" x="608" y="0" width="112" height="168">
                <symbol id="336:11" name="Theme=Default" x="24" y="24" width="64" height="48" />
                <symbol id="336:12" name="Theme=Default" x="24" y="96" width="64" height="48" />
              </frame>
            </frame>
          </frame>
        </frame>
      </frame>
    </frame>
  </frame>
</canvas>`;

  it('cada frame com símbolos é um componente, com a letra e as versões clara e escura', () => {
    expect(parseFigmaChannelFrames(XML)).toEqual([
      { node: '335:3417', name: 'A/A&E', letter: 'A', light: '335:3418', dark: '335:3421' },
      { node: '335:18878', name: 'E/El Siete', letter: 'A', light: '335:18879', dark: '335:18898' },
      { node: '336:1', name: 'B/Baby TV HD', letter: 'A', light: '336:2', dark: null },
      // dois "Theme=Default": a linha de cima é a clara, a de baixo, a escura
      { node: '336:10', name: 'T/Teledoce', letter: 'A', light: '336:11', dark: '336:12' },
    ]);
  });
});
