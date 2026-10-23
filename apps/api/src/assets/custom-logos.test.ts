import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { competition, participant } from '@galaxie/db';
import { MemoryResponseCache, type CachedResponse } from '../cache/store.js';
import {
  StaticCustomLogos,
  VariantResponseCache,
  logoIdSql,
  logosVariant,
  teamLogoId,
  type CustomLogos,
} from './custom-logos.js';

const entry = (body: string, tags = ['team:1']): CachedResponse => ({
  status: 200,
  body,
  etag: `"${body}"`,
  tags,
  storedAt: Date.now(),
});

class Toggle implements CustomLogos {
  constructor(public v = '') {}
  enabled() {
    return this.v.startsWith('logos:acervo');
  }
  variant() {
    return this.v;
  }
}

describe('versão da flag na chave do cache', () => {
  it('nunca mexida e desligada não muda as chaves de hoje', () => {
    expect(logosVariant(false, null)).toBe('');
    expect(new StaticCustomLogos(false).variant()).toBe('');
    expect(logosVariant(true, null)).toBe('logos:acervo');
  });

  it('cada troca no painel gera uma versão nova, ligada ou desligada', () => {
    const t1 = new Date('2026-10-23T10:00:00Z');
    const t2 = new Date('2026-10-23T10:05:00Z');
    expect(logosVariant(true, t1)).toBe(`logos:acervo@${t1.getTime()}`);
    expect(logosVariant(false, t2)).toBe(`logos:fornecedor@${t2.getTime()}`);
    expect(logosVariant(true, t1)).not.toBe(logosVariant(true, t2));
  });

  it('a troca da flag isola as respostas; o purge por tag vale para todas as versões', async () => {
    const inner = new MemoryResponseCache();
    const toggle = new Toggle();
    const cache = new VariantResponseCache(inner, toggle);
    await cache.set('k', entry('fornecedor'), 60);
    toggle.v = 'logos:acervo@1';
    expect(await cache.get('k')).toBeUndefined();
    await cache.set('k', entry('acervo'), 60);
    expect((await cache.get('k'))?.body).toBe('acervo');
    toggle.v = '';
    expect((await cache.get('k'))?.body).toBe('fornecedor');
    expect(await cache.purgeTags(['team:1'])).toBe(2);
    expect(await cache.get('k')).toBeUndefined();
  });
});

describe('logo efetivo nas consultas', () => {
  const dialect = new PgDialect();
  it('desligada: só o logo do fornecedor', () => {
    expect(teamLogoId(false)).toBe(participant.logoAssetId);
    expect(dialect.sqlToQuery(logoIdSql('p', false)).sql).toBe('p.logo_asset_id');
  });

  it('ligada: o do acervo quando houver', () => {
    const team = teamLogoId(true);
    expect(team).not.toBe(participant.logoAssetId);
    expect(dialect.sqlToQuery(logoIdSql('c', true)).sql).toBe(
      'coalesce(c.custom_logo_asset_id, c.logo_asset_id)',
    );
    expect(competition.customLogoAssetId.name).toBe('custom_logo_asset_id');
  });
});
