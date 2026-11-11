import { describe, expect, it } from 'vitest';

import { confirmedWithMatchChannels, type PrecedenceOption } from './match-precedence.js';

const option = (over: Partial<PrecedenceOption> = {}): PrecedenceOption => ({
  broadcasterId: 'sportv',
  channelName: 'SporTV',
  region: null,
  status: 'confirmed',
  producedBy: 'pipeline',
  ...over,
});
const channel = (broadcasterId: string, channelName: string | null) => ({ broadcasterId, channelName });

describe('confirmedWithMatchChannels', () => {
  it('a opção nacional leva o canal confirmado do jogo; a emissora com opção não é promovida', () => {
    const { published, toPromote } = confirmedWithMatchChannels([option()], [channel('sportv', 'SporTV 2')]);
    expect(published.map((r) => r.channelName)).toEqual(['SporTV 2']);
    expect(toPromote).toEqual([]);
  });

  it('a opção regional fica com o nome dela', () => {
    const { published } = confirmedWithMatchChannels(
      [option({ region: 'SP', channelName: 'Afiliada SP' })],
      [channel('sportv', 'SporTV 2')],
    );
    expect(published.map((r) => r.channelName)).toEqual(['Afiliada SP']);
  });

  it('canal do jogo de emissora sem opção entra sozinho', () => {
    const { published, toPromote } = confirmedWithMatchChannels([], [channel('espn', 'ESPN 4')]);
    expect(published).toEqual([]);
    expect(toPromote).toEqual([channel('espn', 'ESPN 4')]);
  });

  it('opção só provável não publica e não segura a promoção', () => {
    const { published, toPromote } = confirmedWithMatchChannels(
      [option({ status: 'probable' })],
      [channel('sportv', 'SporTV 2')],
    );
    expect(published).toEqual([]);
    expect(toPromote).toEqual([channel('sportv', 'SporTV 2')]);
  });

  it('`keep` recorta o que aparece, e a emissora recortada não volta pela promoção', () => {
    const { published, toPromote } = confirmedWithMatchChannels(
      [option({ region: 'RJ', channelName: 'Afiliada RJ' })],
      [channel('sportv', 'SporTV 2')],
      (r) => r.region === 'SP',
    );
    expect(published).toEqual([]);
    expect(toPromote).toEqual([]);
  });
});
