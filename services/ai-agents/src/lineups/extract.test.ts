import { loadWtwConfig } from '@galaxie/where-to-watch';
import { describe, expect, it } from 'vitest';
import { gabaritoIds, readGabarito, readRenderedPage } from '../testing/lineup-gabarito.js';
import { extractAddons, extractPlanGrade, planCards, unknownPlanLabels } from './extract.js';

const dir = loadWtwConfig().directory('BR');
const DAY = '2026-10-24';
const page = readRenderedPage();
const gabarito = readGabarito();
const plans = gabarito.planos.map((p) => p.nome);
const ctx = { dir, day: DAY, pageUrl: page.url, platformName: 'Plataforma A' };

describe('página oficial renderizada × gabarito do dono do produto', () => {
  it('acha o cartão de cada um dos 4 planos (inclusive o Plano TV, que a IA perdeu)', () => {
    const cards = planCards(page.text, plans);
    expect([...cards.keys()]).toEqual([
      'Plano Futebol',
      'Plano Streaming',
      'Plano TV',
      'Plano Futebol Total',
    ]);
    // o cartão do Plano Futebol não engole o do Plano Futebol Total nem a seção de complementos
    expect(cards.get('Plano Futebol')).not.toContain('R$ 219,90');
    expect(cards.get('Plano Futebol Total')).not.toContain('Premiere Fidelidade');
  });

  for (const g of gabarito.planos)
    it(`${g.nome}: preço cheio, inclusos e grade iguais ao gabarito (no que o dicionário conhece)`, () => {
      const out = extractPlanGrade(page, g.nome, plans, ctx);
      expect(out.price).toBe(g.preco_mensal);
      expect(out.gradeFrom).toBe('section');
      expect([...out.services].sort()).toEqual(gabaritoIds(g.streamings_inclusos, dir, DAY).ids);
      const channels = gabaritoIds(g.canais, dir, DAY);
      // todos os canais do gabarito que o dicionário conhece (Nsports é streaming no dicionário)
      expect(out.channels).toEqual(expect.arrayContaining(channels.ids.filter((id) => id !== 'n_sports')));
      // a mais, só TV aberta que está na lista aberta do plano (o gabarito dos planos TV e Total lista só os de esporte)
      for (const id of out.channels.filter((id) => !channels.ids.includes(id)))
        expect(dir.byIdOrNull(id)?.medium, `${g.nome}: ${id}`).toBe('free_tv');
      // nenhum canal que o gabarito diz que o plano NÃO tem
      for (const id of gabaritoIds(g.sem_os_canais, dir, DAY).ids)
        if (!channels.ids.includes(id)) expect(out.channels, `${g.nome} sem ${id}`).not.toContain(id);
    });

  it('Plano Futebol e Streaming: sem ESPN, SporTV nem BandSports lineares', () => {
    for (const plan of ['Plano Futebol', 'Plano Streaming']) {
      const out = extractPlanGrade(page, plan, plans, ctx);
      expect(out.channels).not.toContain('espn');
      expect(out.channels).not.toContain('sportv');
      expect(out.channels).toEqual(expect.arrayContaining(['globo', 'cazetv', 'ge_tv']));
    }
  });

  it('Premiere é streaming incluso no Plano Futebol e não está no Plano TV', () => {
    expect(extractPlanGrade(page, 'Plano Futebol', plans, ctx).services).toContain('premiere');
    expect(extractPlanGrade(page, 'Plano TV', plans, ctx).services).not.toContain('premiere');
  });

  it('sem a lista aberta, o cartão de marketing não vira grade', () => {
    const out = extractPlanGrade({ text: page.text, sections: [] }, 'Plano TV', plans, ctx);
    expect([out.gradeFrom, out.channels]).toEqual([null, []]);
    // inclusos e preço continuam do cartão
    expect(out.services.sort()).toEqual(['nfl_game_pass', 'prime_video']);
    expect(out.price).toBe(99.9);
  });

  it('catálogo de complementos: ofertas com preço e fidelidade; ESPN 6 é canal, só como complemento', () => {
    const { offers, unknown } = extractAddons(page, { dir, day: DAY });
    expect(
      offers
        .map((o) => [o.refId, o.kind, o.channel, o.price, o.commitmentMonths])
        .sort((a, b) => `${a[0]}`.localeCompare(`${b[0]}`) || Number(b[3]) - Number(a[3])),
    ).toEqual([
      ['disney_plus', 'service', null, 49.9, null],
      ['espn', 'channel', 'ESPN 6', 4.9, 12],
      ['hbo_max', 'service', null, 44.9, null],
      ['paramount_plus', 'service', null, 34.9, null],
      ['premiere', 'service', null, 59.9, null],
      ['premiere', 'service', null, 49.9, 12],
      ['sportynet', 'service', null, 29.9, null],
      ['telecine', 'service', null, 29.9, null],
    ]);
    // o dicionário conhece todos os complementos da página (o que não conhecesse iria para a curadoria)
    expect(unknown).toEqual([]);
    // conferência com o gabarito: todas as ofertas conhecidas, com o preço certo
    for (const c of readGabarito().complementos) {
      const id = dir.resolve(c.nome.replace(/\+$/, ''), DAY)?.entry.id;
      if (!id) continue;
      for (const o of c.ofertas)
        expect(
          offers.some(
            (x) => x.refId === id && x.price === o.preco_mensal && x.commitmentMonths === o.fidelidade_meses,
          ),
          `${c.nome} ${o.preco_mensal}`,
        ).toBe(true);
    }
  });

  it('rótulo de lista aberta que não é plano conhecido aparece como plano faltando', () => {
    expect(unknownPlanLabels(page, ['Plano Futebol', 'Plano Streaming', 'Plano Futebol Total'])).toEqual([
      'Plano TV',
    ]);
    expect(unknownPlanLabels(page, plans)).toEqual([]);
  });
});
