import { describe, expect, it } from 'vitest';
import {
  logoFiles,
  matchOrg,
  normalizeName,
  registrableDomain,
  siteHost,
  type WikidataOrg,
} from './platform-logos.js';

describe('site oficial', () => {
  it('host sem www, com ou sem protocolo; o que não é http fica de fora', () => {
    expect(siteHost('https://www.operadora.com.br/para-voce')).toBe('operadora.com.br');
    expect(siteHost('operadora.example')).toBe('operadora.example');
    expect(siteHost('http://WWW2.Exemplo.TV/')).toBe('exemplo.tv');
    expect(siteHost('ftp://exemplo.test')).toBeNull();
    expect(siteHost(null)).toBeNull();
  });

  it('domínio registrável com o segundo nível dos ccTLDs da região', () => {
    expect(registrableDomain('tv.servico.com')).toBe('servico.com');
    expect(registrableDomain('premium.emissora.com.br')).toBe('emissora.com.br');
    expect(registrableDomain('play.operadora.com.ar')).toBe('operadora.com.ar');
    expect(registrableDomain('exemplo.cl')).toBe('exemplo.cl');
    expect(registrableDomain('app.exemplo.cl')).toBe('exemplo.cl');
  });

  it('nome sem acento, caixa e pontuação, com o + por extenso', () => {
    expect(normalizeName('Serviço+')).toBe('servico plus');
    expect(normalizeName('SERVICO PLUS')).toBe('servico plus');
    expect(normalizeName('Operadora  TV!')).toBe('operadora tv');
  });
});

describe('logo do item do Wikidata (P154)', () => {
  const snak = (file: string, extra: object = {}) => ({ mainsnak: { datavalue: { value: file } }, ...extra });

  it('o preferido e o vigente primeiro; o obsoleto fica de fora', () => {
    expect(
      logoFiles([
        snak('Antigo.svg', { qualifiers: { P582: [{}] } }),
        snak('Atual.svg'),
        snak('Errado.svg', { rank: 'deprecated' }),
        snak('Preferido.svg', { rank: 'preferred' }),
      ]),
    ).toEqual(['Preferido.svg', 'Atual.svg', 'Antigo.svg']);
    expect(logoFiles(undefined)).toEqual([]);
  });
});

describe('qual item é a plataforma', () => {
  const org = (id: string, names: string[], websites: string[], logos = [`${id}.svg`]): WikidataOrg => ({
    id,
    names,
    websites,
    logos,
  });

  it('o mesmo host do site oficial', () => {
    const match = matchOrg({ name: 'Operadora Exemplo', website: 'https://www.operadora.example/home' }, [
      org('Q1', ['Outra'], ['https://outra.example']),
      org('Q2', ['Operadora Exemplo S.A.'], ['https://operadora.example/']),
    ]);
    expect(match).toMatchObject({ org: { id: 'Q2' }, by: 'site' });
  });

  it('mesmo domínio só com o nome igual: o subdomínio de outro serviço não conta', () => {
    const emissora = org('Q10', ['Emissora'], ['https://emissora.example']);
    // premium.emissora.example é outro produto: não leva o logo da emissora
    expect(matchOrg({ name: 'Premium', website: 'https://premium.emissora.example' }, [emissora])).toBeNull();
    const servico = org('Q11', ['Serviço+', 'Servico Plus'], ['https://tv.servico.example']);
    expect(
      matchOrg({ name: 'SERVIÇO+', website: 'https://www.servico.example/br/servico-plus/' }, [servico]),
    ).toMatchObject({ org: { id: 'Q11' }, by: 'domain_and_name' });
  });

  it('sem site para conferir ou sem logo no item: nada', () => {
    const q = org('Q3', ['Operadora Exemplo'], ['https://operadora.example']);
    expect(matchOrg({ name: 'Operadora Exemplo', website: null }, [q])).toBeNull();
    expect(
      matchOrg({ name: 'Operadora Exemplo', website: 'https://operadora.example' }, [{ ...q, logos: [] }]),
    ).toBeNull();
  });
});
