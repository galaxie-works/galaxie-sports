import { beforeAll, describe, expect, it } from 'vitest';
import { loadKnowledge } from '../load.js';
import {
  AFFINITY_TYPES,
  COMPETITION_CONTEXTS,
  COPY_INTENTS,
  COPY_LOCALES,
  MOMENTUMS,
  type ToneIntensity,
} from '../types.js';
import { copyTemplatesFromKnowledge } from './library.js';
import {
  copyPermission,
  renderCopy,
  selectCopy,
  type CopyRequest,
  type CopyTemplate,
} from './select-copy.js';

let library: CopyTemplate[];
beforeAll(async () => {
  library = copyTemplatesFromKnowledge(await loadKnowledge());
});

const base: CopyRequest = { locale: 'pt-BR', sport: 'football', intent: 'cheer', tone: 4 };
const TONES: ToneIntensity[] = [1, 2, 3, 4];

describe('copyPermission', () => {
  it('afinidade inferida: só informativa, tom 1', () => {
    for (const type of AFFINITY_TYPES)
      expect(copyPermission(type, 'inferred')).toMatchObject({ allowedIntents: ['inform'], maxTone: 1 });
  });
  it('afinidade sem origem conhecida é tratada como inferida', () => {
    expect(copyPermission('heart', null).allowedIntents).toEqual(['inform']);
  });
  it('rival declarado permite rivalidade, mas nunca torcida pelo rival', () => {
    const p = copyPermission('rival', 'explicit');
    expect(p.allowedIntents).toContain('rivalry');
    expect(p.allowedIntents).not.toContain('cheer');
  });
  it('coração declarado vai até o tom 4; sem afinidade, sem identidade', () => {
    expect(copyPermission('heart', 'explicit')).toMatchObject({ maxTone: 4 });
    expect(copyPermission(null, null).allowedIntents).not.toContain('cheer');
    expect(copyPermission(null, null).allowedIntents).not.toContain('rivalry');
  });
});

describe('selectCopy — copy_permission (critério de aceite da #43)', () => {
  it('rival inferido NUNCA recebe copy de rivalidade, em nenhum locale/tom/momento/contexto', () => {
    let checked = 0;
    for (const locale of COPY_LOCALES)
      for (const intent of COPY_INTENTS)
        for (const tone of TONES)
          for (const momentum of [null, ...MOMENTUMS])
            for (const context of [null, ...COMPETITION_CONTEXTS]) {
              const sel = selectCopy(
                {
                  locale,
                  sport: 'football',
                  intent,
                  tone,
                  momentum,
                  context,
                  affinityType: 'rival',
                  affinitySource: 'inferred',
                },
                library,
              );
              checked++;
              if (!sel) continue;
              expect(sel.template.intent).toBe('inform');
              expect(sel.template.tone).toBe(1);
              expect(sel.template.affinityType).toBeNull();
            }
    expect(checked).toBeGreaterThan(10_000);
  });

  it('time do coração inferido recebe só copy informativa', () => {
    const sel = selectCopy(
      { ...base, affinityType: 'heart', affinitySource: 'inferred', momentum: 'today' },
      library,
    );
    expect(sel).toMatchObject({ intent: 'inform', downgraded: true });
    expect(sel!.template.key).toBe('pt-BR.inform-1-today');
    expect(renderCopy(sel!.template.template, { team: 'Palmeiras' })).toBe('Palmeiras joga hoje');
  });

  it('time do coração declarado recebe identidade forte', () => {
    const sel = selectCopy(
      {
        ...base,
        intent: 'anticipate',
        affinityType: 'heart',
        affinitySource: 'explicit',
        momentum: 'today',
        vars: { team: 'Palmeiras', nickname: 'Verdão' },
      },
      library,
    );
    expect(sel).toMatchObject({ intent: 'anticipate', downgraded: false, text: 'É hoje! Vai, Verdão!' });
  });

  it('rival declarado recebe rivalidade lúdica ("secar") no Brasil', () => {
    const sel = selectCopy(
      {
        ...base,
        intent: 'rivalry',
        tone: 3,
        affinityType: 'rival',
        affinitySource: 'explicit',
        vars: { rival: 'Corinthians' },
      },
      library,
    );
    expect(sel?.text).toBe('Corinthians em campo hoje. Dia de secar!');
  });

  it('rivalidade é rebaixada para inform quando o rival não foi declarado', () => {
    const sel = selectCopy(
      { ...base, intent: 'rivalry', tone: 3, affinityType: null, affinitySource: null },
      library,
    );
    expect(sel?.intent).toBe('inform');
  });

  it('tom é limitado pela afinidade (apoio declarado: até 3)', () => {
    const sel = selectCopy(
      { ...base, tone: 4, affinityType: 'support', affinitySource: 'explicit' },
      library,
    );
    expect(sel!.template.tone).toBeLessThanOrEqual(3);
    expect(sel!.downgraded).toBe(true);
  });

  it('prefere o template específico do contexto (clássico, final)', () => {
    const derby = selectCopy(
      {
        ...base,
        tone: 3,
        context: 'derby',
        affinityType: 'heart',
        affinitySource: 'explicit',
        vars: { team: 'Grêmio', rival: 'Internacional', nickname: 'Tricolor' },
      },
      library,
    );
    expect(derby?.text).toBe('Grêmio x Internacional: dia de clássico. Vai, Tricolor!');
    const final = selectCopy(
      {
        ...base,
        locale: 'es-AR',
        intent: 'decisive',
        context: 'final',
        affinityType: 'heart',
        affinitySource: 'explicit',
        vars: { team: 'Boca', nickname: 'Xeneize' },
      },
      library,
    );
    expect(final?.text).toBe('¡Final! ¡Hoy se deja todo, Xeneize!');
  });

  it('descarta templates cujo placeholder não tem valor', () => {
    const sel = selectCopy(
      { ...base, tone: 3, affinityType: 'heart', affinitySource: 'explicit', vars: { team: 'Bahia' } },
      library,
    );
    expect(sel?.text).toBe('Vai, Bahia!');
  });

  it('não há fallback entre locales', () => {
    expect(selectCopy({ ...base, locale: 'es-VE' }, library)).toBeNull();
    expect(selectCopy({ ...base, sport: 'basketball' }, library)).toBeNull();
  });

  it('respeita o status editorial mínimo', () => {
    expect(selectCopy({ ...base, minReviewStatus: 'approved' }, library)).toBeNull();
  });

  it('variantSeed escolhe de forma determinística entre empates', () => {
    const tpl = (key: string): CopyTemplate => ({
      key,
      locale: 'pt-BR',
      sport: 'football',
      intent: 'inform',
      tone: 1,
      template: key,
      affinityType: null,
      affinitySource: null,
      momentum: null,
      competitionContext: null,
      confidence: 'HIGH',
      reviewStatus: 'draft',
    });
    const pool = [tpl('a'), tpl('b'), tpl('c')];
    const pick = (seed: string) =>
      selectCopy({ ...base, intent: 'inform', variantSeed: seed }, pool)!.template.key;
    expect(pick('u1:e1')).toBe(pick('u1:e1'));
    expect(new Set(['1', '2', '3', '4', '5', '6', '7', '8'].map(pick)).size).toBeGreaterThan(1);
  });

  it('cada um dos 8 mercados cobre todas as intenções para quem declarou o time', () => {
    for (const locale of COPY_LOCALES)
      for (const intent of COPY_INTENTS) {
        const affinity = intent === 'rivalry' ? ('rival' as const) : ('heart' as const);
        // antecipação e urgência dependem do momento do jogo
        const momentum = intent === 'anticipate' ? 'today' : intent === 'urgency' ? 'starting' : null;
        const sel = selectCopy(
          {
            locale,
            sport: 'football',
            intent,
            tone: 4,
            momentum,
            affinityType: affinity,
            affinitySource: 'explicit',
          },
          library,
        );
        expect(sel?.intent, `${locale}/${intent}`).toBe(intent);
      }
  });
});

describe('renderCopy', () => {
  it('retorna null quando falta valor', () => {
    expect(renderCopy('Vai, {nickname}!', { team: 'X' })).toBeNull();
    expect(renderCopy('Em {minutes} min', { minutes: 30 })).toBe('Em 30 min');
  });
});
