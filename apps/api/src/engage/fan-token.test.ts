import { describe, expect, it } from 'vitest';
import { fanCan, fanCapabilities } from './fan-rules.js';
import { FAN_TOKEN_PREFIX, FanTokenSigner, type FanTokenClaims } from './fan-token.js';

const SECRET = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);
const claims: Omit<FanTokenClaims, 'exp'> = {
  tenantId: '0190f1c0-0000-7000-8000-000000000001',
  accountId: '0190f1c0-0000-7000-8000-0000000000a1',
  profileId: '0190f1c0-0000-7000-8000-0000000000b1',
  ageBand: '13_17',
  country: 'BR',
  locale: 'pt-BR',
  holderAdult: 'yes',
  surface: 'store_app',
};

describe('FanTokenSigner', () => {
  it('emite gft_ e devolve os mesmos campos na verificação', () => {
    let now = 1_800_000_000_000;
    const signer = new FanTokenSigner({ secret: SECRET, now: () => now });
    const { token, expiresAt } = signer.issue(claims, 900);
    expect(token.startsWith(FAN_TOKEN_PREFIX)).toBe(true);
    expect(expiresAt.getTime()).toBe(now + 900_000);
    expect(signer.verify(token)).toEqual({ ...claims, exp: now / 1000 + 900 });
    now += 900_000;
    expect(signer.verify(token)).toBeNull();
  });

  it('recusa assinatura de outro segredo, corpo alterado e formato estranho', () => {
    const signer = new FanTokenSigner({ secret: SECRET });
    const other = new FanTokenSigner({ secret: OTHER });
    const { token } = other.issue(claims);
    expect(signer.verify(token)).toBeNull();
    const mine = signer.issue(claims).token;
    const [body, sig] = mine.slice(FAN_TOKEN_PREFIX.length).split('.');
    const forged = JSON.parse(Buffer.from(body!, 'base64url').toString());
    forged.t = '0190f1c0-0000-7000-8000-000000000002';
    forged.b = '18plus';
    const tampered = `${FAN_TOKEN_PREFIX}${Buffer.from(JSON.stringify(forged)).toString('base64url')}.${sig}`;
    expect(signer.verify(tampered)).toBeNull();
    expect(signer.verify(`${mine}.x`)).toBeNull();
    expect(signer.verify(mine.replace(FAN_TOKEN_PREFIX, 'gst_'))).toBeNull();
    expect(signer.verify('gft_')).toBeNull();
  });

  it('troca de segredo: o anterior só verifica, o novo assina', () => {
    const before = new FanTokenSigner({ secret: OTHER });
    const old = before.issue(claims).token;
    const rotated = new FanTokenSigner({ secret: SECRET, previousSecret: OTHER });
    expect(rotated.verify(old)?.profileId).toBe(claims.profileId);
    expect(before.verify(rotated.issue(claims).token)).toBeNull();
    expect(new FanTokenSigner({ secret: SECRET }).verify(old)).toBeNull();
  });

  it('segredo obrigatório e com 32 caracteres ou mais', () => {
    expect(FanTokenSigner.fromEnv({})).toBeNull();
    expect(FanTokenSigner.fromEnv({ FAN_TOKEN_SECRET: '  ' })).toBeNull();
    expect(() => new FanTokenSigner({ secret: 'curto' })).toThrow(/FAN_TOKEN_SECRET/);
    expect(() => new FanTokenSigner({ secret: SECRET, previousSecret: 'curto' })).toThrow(
      /FAN_TOKEN_SECRET_PREVIOUS/,
    );
    expect(FanTokenSigner.fromEnv({ FAN_TOKEN_SECRET: SECRET })).toBeInstanceOf(FanTokenSigner);
  });
});

describe('faixas etárias (D1)', () => {
  it('under13 não usa nada social; 13_17 lê e palpita; 18plus tudo', () => {
    expect(fanCapabilities('under13')).toEqual([]);
    expect(fanCapabilities('13_17')).toEqual(['read', 'predict']);
    expect(fanCapabilities('18plus')).toEqual(['read', 'predict', 'write', 'redeem']);
    expect(fanCan('13_17', 'write')).toBe(false);
    expect(fanCan('13_17', 'redeem')).toBe(false);
  });
});
