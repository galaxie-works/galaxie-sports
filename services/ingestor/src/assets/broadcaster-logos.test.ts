import { describe, expect, it } from 'vitest';
import { BROADCASTER_LOGO_PREFIX, logoSourceAllowed, logoStorageKey } from './broadcaster-logos.js';

describe('logos da biblioteca de emissoras', () => {
  it('só baixa de origens https da allowlist (arquivos da Wikimedia Commons)', () => {
    expect(logoSourceAllowed('https://upload.wikimedia.org/wikipedia/commons/a/a1/Logo_Emissora_A.svg')).toBe(
      true,
    );
    expect(logoSourceAllowed('http://upload.wikimedia.org/wikipedia/commons/a/a1/x.png')).toBe(false);
    expect(logoSourceAllowed('https://emissora-a.example/logo.png')).toBe(false);
    expect(logoSourceAllowed('https://upload.wikimedia.org.example.com/x.png')).toBe(false);
    expect(logoSourceAllowed('nao é url')).toBe(false);
  });

  it('chave pelo conteúdo (sha256), com a extensão do tipo da imagem e sem nome de marca', () => {
    const sha = 'ab'.repeat(32);
    expect(logoStorageKey(sha, 'image/png')).toBe(`${BROADCASTER_LOGO_PREFIX}/abababababababab.png`);
    expect(logoStorageKey(sha, 'image/svg+xml')).toBe('broadcasters/abababababababab.svg');
    expect(logoStorageKey(sha, 'application/octet-stream')).toBe('broadcasters/abababababababab.bin');
  });
});
