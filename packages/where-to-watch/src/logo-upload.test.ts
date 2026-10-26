import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  LOGO_UPLOAD_MAX_BYTES,
  LogoUploadError,
  logoUploadStorageKey,
  sanitizeSvg,
  validateLogoUpload,
} from './logo-upload.js';

/** PNG mínimo: assinatura + IHDR com as dimensões pedidas (o resto do arquivo não é lido). */
function png(width: number, height: number): Uint8Array {
  const buf = new Uint8Array(64);
  buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(buf.buffer);
  view.setUint32(8, 13);
  buf.set([0x49, 0x48, 0x44, 0x52], 12);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return buf;
}

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (err) {
    return err instanceof LogoUploadError ? err.code : 'other';
  }
  return null;
};

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><path d="M0 0h10v10z"/></svg>';

describe('validateLogoUpload', () => {
  it('PNG pelo conteúdo, com as dimensões do IHDR', () => {
    const v = validateLogoUpload(png(256, 128));
    expect(v).toMatchObject({ contentType: 'image/png', width: 256, height: 128 });
  });

  it('PNG abaixo do mínimo ou gigante: recusado', () => {
    expect(code(() => validateLogoUpload(png(127, 400)))).toBe('too_small');
    expect(code(() => validateLogoUpload(png(5000, 400)))).toBe('too_big_dimensions');
  });

  it('o tipo vem do conteúdo, não da extensão: JPEG, GIF, HTML e texto são recusados', () => {
    expect(code(() => validateLogoUpload(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0])))).toBe(
      'unsupported_type',
    );
    expect(code(() => validateLogoUpload(enc('GIF89a.....')))).toBe('unsupported_type');
    expect(code(() => validateLogoUpload(enc('<html><body><svg></svg></body></html>')))).toBe(
      'unsupported_type',
    );
    // "PNG" sem o cabeçalho IHDR
    expect(code(() => validateLogoUpload(png(256, 256).slice(0, 12)))).toBe('unsupported_type');
  });

  it('vazio e acima do tamanho máximo', () => {
    expect(code(() => validateLogoUpload(new Uint8Array()))).toBe('empty');
    expect(code(() => validateLogoUpload(new Uint8Array(LOGO_UPLOAD_MAX_BYTES + 1)))).toBe('too_large');
  });

  it('SVG com declaração XML, BOM e comentário: aceito, com as dimensões do viewBox', () => {
    const v = validateLogoUpload(enc(`\uFEFF<?xml version="1.0"?>\n<!-- logo -->\n${SVG}`));
    expect(v).toMatchObject({ contentType: 'image/svg+xml', width: 200, height: 100 });
    expect(dec(v.body)).toBe(SVG);
  });
});

describe('sanitizeSvg', () => {
  const clean = (s: string) => sanitizeSvg(s).markup;

  it('tira <script>, <foreignObject> e animações com o conteúdo', () => {
    const out = clean(
      `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><script/><path d="M0 0"/>` +
        `<foreignObject><div xmlns="http://www.w3.org/1999/xhtml"><img src="x" onerror="alert(1)"/></div></foreignObject>` +
        `<a href="#x"><set attributeName="href" to="javascript:alert(1)"/></a></svg>`,
    );
    expect(out).toBe('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>');
  });

  it('tira eventos on*, em qualquer caixa', () => {
    const out = clean(
      `<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><path ONCLICK="x()" onMouseOver='y()' d="M0 0"/></svg>`,
    );
    expect(out).not.toMatch(/on\w+=/i);
    expect(out).toContain('<path d="M0 0"/>');
  });

  it('href só local (#id): externo, javascript: e data: saem, mesmo escondidos em entidades', () => {
    const out = clean(
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">` +
        `<defs><path id="p" d="M0 0"/></defs>` +
        `<use href="#p"/><use xlink:href="https://mal.exemplo/x.svg#p"/>` +
        `<use href="&#106;avascript:alert(1)"/><use xlink:href="data:image/svg+xml;base64,AAAA"/></svg>`,
    );
    expect(out).toContain('<use href="#p"/>');
    expect(out).not.toMatch(/mal\.exemplo|javascript|data:/i);
    expect(out.match(/<use/g)).toHaveLength(4);
  });

  it('url() externo em estilo e em atributo sai; url(#id) fica', () => {
    const out = clean(
      `<svg xmlns="http://www.w3.org/2000/svg"><linearGradient id="g"/>` +
        `<rect fill="url(#g)" width="1" height="1"/>` +
        `<rect fill="url(https://mal.exemplo/a)" style="background:url(https://mal.exemplo/b)" width="1" height="1"/></svg>`,
    );
    expect(out).toContain('fill="url(#g)"');
    expect(out).not.toContain('mal.exemplo');
  });

  it('<style> com @import ou url() externo: recusado; estilo local fica', () => {
    expect(
      clean(
        `<svg xmlns="http://www.w3.org/2000/svg"><style>.a{fill:red}</style><path class="a" d="M0 0"/></svg>`,
      ),
    ).toContain('<style>.a{fill:red}</style>');
    expect(
      code(() =>
        sanitizeSvg(`<svg><style>@import url(https://mal.exemplo/x.css);</style><path d="M0"/></svg>`),
      ),
    ).toBe('invalid_svg');
    expect(
      code(() =>
        sanitizeSvg(`<svg><style><![CDATA[.a{background:url(//mal.exemplo)}]]></style><path d="M0"/></svg>`),
      ),
    ).toBe('invalid_svg');
  });

  it('escape CSS não esconde @import nem url() externo (em <style>, style e atributo)', () => {
    expect(
      code(() =>
        sanitizeSvg(
          `<svg xmlns="http://www.w3.org/2000/svg"><style>@im\\70 ort "https://mal.exemplo/x.css";</style><path d="M0"/></svg>`,
        ),
      ),
    ).toBe('invalid_svg');
    const out = clean(
      `<svg xmlns="http://www.w3.org/2000/svg">` +
        `<rect style="fill:u\\72l(https://mal.exemplo/a)" width="1" height="1"/>` +
        `<rect fill="u\\72l(https://mal.exemplo/b)" width="1" height="1"/></svg>`,
    );
    expect(out).not.toContain('mal.exemplo');
    expect(out).not.toContain('\\');
  });

  it('DOCTYPE/ENTITY, raiz que não é svg, marcação malformada e nada desenhável: recusado', () => {
    expect(code(() => sanitizeSvg(`<!DOCTYPE svg [<!ENTITY x "y">]><svg><path d="M0"/></svg>`))).toBe(
      'invalid_svg',
    );
    expect(code(() => sanitizeSvg(`<html><svg><path d="M0"/></svg></html>`))).toBe('invalid_svg');
    expect(code(() => sanitizeSvg(`<svg><path d="M0"></svg>`))).toBe('invalid_svg');
    expect(code(() => sanitizeSvg(`<svg><path d=M0/></svg>`))).toBe('invalid_svg');
    expect(code(() => sanitizeSvg(`<svg><title>só texto</title></svg>`))).toBe('invalid_svg');
  });

  it('metadados de editor (outros namespaces) saem; o xmlns do SVG é garantido', () => {
    const out = clean(
      `<svg xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" sodipodi:docname="x" width="64px" height="32">` +
        `<sodipodi:namedview id="n"/><path d="M0 0"/></svg>`,
    );
    expect(out).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" width="64px" height="32"><path d="M0 0"/></svg>',
    );
    expect(sanitizeSvg(out)).toMatchObject({ width: 64, height: 32 });
  });
});

describe('logoUploadStorageKey', () => {
  it('padrão dos logos: prefixo da entidade + 16 primeiros hex do sha256 + extensão do tipo', () => {
    const sha = createHash('sha256').update('logo').digest('hex');
    expect(logoUploadStorageKey('broadcaster', sha, 'image/svg+xml')).toBe(
      `broadcasters/${sha.slice(0, 16)}.svg`,
    );
    expect(logoUploadStorageKey('platform', sha, 'image/png')).toBe(`platforms/${sha.slice(0, 16)}.png`);
  });
});
