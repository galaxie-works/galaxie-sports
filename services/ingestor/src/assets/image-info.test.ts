import { describe, expect, it } from 'vitest';
import { fakePng } from '../../test/helpers.js';
import { imageInfo } from './image-info.js';

describe('imageInfo', () => {
  it('lê dimensões de PNG', () => {
    expect(imageInfo(fakePng(150, 120))).toEqual({ contentType: 'image/png', width: 150, height: 120 });
  });

  it('lê SVG por width/height ou viewBox', () => {
    const svg = (attrs: string) =>
      new TextEncoder().encode(
        `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" ${attrs}></svg>`,
      );
    expect(imageInfo(svg('width="640" height="480"'))).toEqual({
      contentType: 'image/svg+xml',
      width: 640,
      height: 480,
    });
    expect(imageInfo(svg('viewBox="0 0 900 600"'))).toEqual({
      contentType: 'image/svg+xml',
      width: 900,
      height: 600,
    });
    expect(imageInfo(svg('width="100%" viewBox="0,0,30,20"'))).toEqual({
      contentType: 'image/svg+xml',
      width: 30,
      height: 20,
    });
  });

  it('lê GIF e JPEG', () => {
    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x10, 0x00, 0x20, 0x00]);
    expect(imageInfo(gif)).toEqual({ contentType: 'image/gif', width: 16, height: 32 });
    // SOI, APP0 (tamanho 4), SOF0 com altura 50 e largura 70
    const jpeg = new Uint8Array([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x32, 0x00, 0x46,
      0x03,
    ]);
    expect(imageInfo(jpeg)).toEqual({ contentType: 'image/jpeg', width: 70, height: 50 });
  });

  it('lê WebP sem perdas (VP8L) e com perdas (VP8)', () => {
    const lossless = new Uint8Array([
      82, 73, 70, 70, 36, 0, 0, 0, 87, 69, 66, 80, 86, 80, 56, 76, 23, 0, 0, 0, 47, 43, 193, 49, 0, 7, 16,
      253, 143, 254, 7, 0,
    ]);
    expect(imageInfo(lossless)).toEqual({ contentType: 'image/webp', width: 300, height: 200 });
    const lossy = new Uint8Array([
      82, 73, 70, 70, 196, 0, 0, 0, 87, 69, 66, 80, 86, 80, 56, 32, 184, 0, 0, 0, 240, 16, 0, 157, 1, 42, 44,
      1, 200, 0, 62, 109,
    ]);
    expect(imageInfo(lossy)).toEqual({ contentType: 'image/webp', width: 300, height: 200 });
  });

  it('usa o Content-Type para o que não reconhece', () => {
    expect(imageInfo(new Uint8Array([1, 2, 3]), 'image/x-icon; charset=binary')).toEqual({
      contentType: 'image/x-icon',
      width: null,
      height: null,
    });
  });
});
