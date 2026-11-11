import { describe, expect, it } from 'vitest';
import { DEFAULT_MODERATION_LISTS } from './moderation-defaults.js';
import {
  SCREEN_KINDS,
  autoSlowMode,
  compileLists,
  normalizeTerm,
  screen,
  screenNotice,
  type ScreenKind,
} from './moderation.js';

const lists = compileLists(DEFAULT_MODERATION_LISTS);
const chat = (text: string, locale = 'pt-BR') => screen(text, { kind: 'chat_message', locale }, lists);

describe('screen: abuso (some só para os outros)', () => {
  it.each([
    'seu macaco',
    'MACACO',
    'macacos',
    'm4c4c0',
    'm a c a c o',
    'm.a.c.a.c.o',
    'maaaacaaaco',
    'mácaco',
    'm@c@co',
  ])('pega racismo com grafia trocada: %s', (text) => {
    const r = chat(text);
    expect(r.action).toBe('shadow');
    expect(r.reasons[0]).toBe('abuse');
    expect(r.categories).toContain('hate');
    expect(r.suspect).toBe(true);
  });

  it('marca drible do filtro só quando a grafia foi trocada', () => {
    expect(chat('macaco').evasion).toBe(false);
    expect(chat('m4c4c0').evasion).toBe(true);
  });

  it.each([
    ['es-AR', 'sos un mono de mierda'],
    ['es-AR', 'te voy a matar'],
    ['en', 'I will kill you'],
    ['en', 'kill yourself'],
    ['pt-BR', 'sei onde voce mora'],
    ['pt-BR', 'se mata'],
    ['es-MX', 'matate'],
  ])('ameaça, ódio e assédio em %s: %s', (locale, text) => {
    expect(chat(text, locale).action).toBe('shadow');
  });

  it('vale em qualquer idioma (torcedor escreve misturado)', () => {
    expect(chat('i will kill you', 'pt-BR').action).toBe('shadow');
  });
});

describe('screen: bloqueio comum (não publica, avisa, sem punição)', () => {
  it.each([
    'entra no https://exemplo.com/promo',
    'olha www.exemplo.com',
    'site exemplo.com.br',
    'exemplo ponto com',
    'exemplo (dot) com',
    'exemplo . com',
  ])('link fora da lista: %s', (text) => {
    const r = chat(text);
    expect(r.action).toBe('block');
    expect(r.reasons).toContain('link');
  });

  it('link permitido passa', () => {
    expect(chat('placar em https://galaxie.sports/jogo/1').action).toBe('allow');
    expect(chat('placar em galaxie.sports').action).toBe('allow');
  });

  it.each([
    'aposta na bet365',
    'BETANO paga mais',
    'b3tano',
    'b e t a n o',
    'entra em bet365.com',
    'bet365 . com',
    'joga no site.bet',
    'melhor casa de apostas',
    'aposta no tigrinho',
    'cupom de aposta: GOL10',
    'casa de apuestas',
    'apuestas deportivas',
  ])('aposta, com qualquer grafia comum: %s', (text) => {
    const r = chat(text);
    expect(r.action).toBe('block');
    expect(r.reasons[0]).toBe('betting');
  });

  it('cliente não libera domínio de aposta como permitido', () => {
    const tenantLists = compileLists(DEFAULT_MODERATION_LISTS, { terms: {}, allowedDomains: ['bet365.com'] });
    expect(screen('bet365.com', { kind: 'chat_message' }, tenantLists).reasons).toContain('betting');
  });

  it.each([
    'meu zap (11) 98765-4321',
    'liga 11987654321',
    '+55 11 98765-4321',
    '+54 9 11 4567-8901',
    'cpf 529.982.247-25',
    'pix 52998224725',
    'cnpj 11.222.333/0001-81',
    'me chama em torcedor@exemplo.com',
    'chave 123e4567-e89b-12d3-a456-426614174000',
  ])('dado pessoal: %s', (text) => {
    const r = chat(text);
    expect(r.action).toBe('block');
    expect(r.reasons).toContain('personal_data');
  });

  it.each([
    'golaço aos 45 do segundo tempo',
    '2x1 com gol aos 89',
    'placar 3 a 2, 15 mil no estádio',
    'ganhamos 1000 jogos',
    'camisa 10',
    'cpf 111.111.111-11',
    'jogo 123.456.789-00',
  ])('número de futebol não vira dado pessoal: %s', (text) => {
    expect(chat(text).reasons).not.toContain('personal_data');
  });

  it('modo lento: espera e diz quanto falta', () => {
    const now = 1_000_000;
    const r = screen(
      'bora',
      { kind: 'chat_message', rate: { intervalS: 10, lastSentAt: now - 3_000, now } },
      lists,
    );
    expect(r.action).toBe('block');
    expect(r.reasons).toEqual(['slow_mode']);
    expect(r.retryAfterS).toBe(7);
    expect(screenNotice(r, 'pt-BR')).toBe('Modo lento: espere 7 s para mandar de novo.');
    const ok = screen(
      'bora',
      { kind: 'chat_message', rate: { intervalS: 10, lastSentAt: now - 10_000, now } },
      lists,
    );
    expect(ok.action).toBe('allow');
  });

  it('vazio e longo demais', () => {
    expect(chat('   ').reasons).toEqual(['empty']);
    expect(chat('a'.repeat(501)).reasons).toEqual(['too_long']);
    expect(screen('a'.repeat(501), { kind: 'wall_post' }, lists).action).toBe('allow');
  });
});

describe('screen: palavrão e texto comum', () => {
  it('palavrão no chat publica, mas vai para a Cosmos', () => {
    const r = chat('que porra de juiz');
    expect(r.action).toBe('allow');
    expect(r.reasons).toEqual(['profanity']);
    expect(r.suspect).toBe(true);
  });

  it('palavrão só conta no idioma do torcedor', () => {
    expect(chat('mierda de árbitro', 'es-AR').reasons).toContain('profanity');
    expect(chat('shit referee', 'pt-BR').reasons).not.toContain('profanity');
  });

  it.each([
    'Que golaço do Neymar!',
    'vamos time, bora virar',
    'o goleiro do Macaé fechou o gol',
    'comprei um macacão do time',
    'comprei dois macacões',
    'o viaduto perto do estádio estava cheio',
    'aposto que vai ter gol no segundo tempo',
    'stakeholders do clube',
    'Ganhamos de 3 a 0 no Maracanã',
    '¡Qué golazo de Messi!',
    'What a save by the keeper',
    'better luck next time',
    'alphabet',
  ])('texto comum passa: %s', (text) => {
    const r = chat(text);
    expect(r).toMatchObject({ action: 'allow', reasons: [], suspect: false });
  });
});

describe('screen: falso positivo da revisão (#1101)', () => {
  it.each([
    ['pt-BR', 'Ganhamos o jogo. Com certeza vamos ao mata-mata'],
    ['pt-BR', 'O Flamengo somou um ponto com o empate'],
    ['en', 'Great game. In the second half they pressed'],
    ['es-AR', 'Ganamos. Me encanta este equipo'],
    ['es-AR', 'Este punto me parece clave'],
    ['pt-BR', 'Virou 2 a 1. Pe na tabua'],
    ['en', 'That was the best goal. To be honest'],
    ['pt-BR', 'A Nigéria vai jogar a Copa'],
    ['en', 'Nigeria beat Ghana 2-1'],
    ['pt-BR', 'R$ 148 o ingresso'],
    ['pt-BR', 'foram 1448 torcedores'],
    ['pt-BR', 'Esse time vai morrer na praia de novo'],
    ['pt-BR', 'vou explodir de alegria com esse gol'],
    ['pt-BR', 'O volante se matava em campo'],
  ])('%s: texto comum passa: %s', (locale, text) => {
    expect(chat(text, locale)).toMatchObject({ action: 'allow', reasons: [] });
  });

  it.each([
    ['pt-BR', 'Que jogo. Top!'],
    ['pt-BR', 'Gol do Neymar. Top'],
    ['en', 'Foi lindo. Fun!'],
    ['pt-BR', 'Estou aqui. Live!'],
  ])('%s: TLD que é palavra comum não vira link: %s', (locale, text) => {
    expect(chat(text, locale).reasons).not.toContain('link');
  });

  it('Macaca (Ponte Preta) publica, mas vai para a Cosmos; com leet ou no Apelido, não', () => {
    expect(chat('Vamos Macaca!')).toMatchObject({ action: 'allow', reasons: [], suspect: true });
    expect(chat('sua macaca')).toMatchObject({ action: 'allow', suspect: true });
    expect(chat('m4c4c4').action).toBe('shadow');
    expect(screen('Macaca', { kind: 'nickname' }, lists).action).toBe('block');
  });

  it('ponto por extenso no meio da frase só marca para a Cosmos', () => {
    expect(chat('O Flamengo somou um ponto com o empate')).toMatchObject({ action: 'allow', suspect: true });
  });

  it('Apelido Nigeria_10 passa', () => {
    expect(screen('Nigeria_10', { kind: 'nickname' }, lists).action).toBe('allow');
  });

  it('o termo de ódio continua pego com as letras dobradas', () => {
    expect(chat('nigger', 'en').action).toBe('shadow');
    expect(chat('niiiggger', 'en').action).toBe('shadow');
    expect(chat('1488').action).toBe('shadow');
  });
});

describe('screen: drible da revisão (#1101)', () => {
  it.each(['mac\u200baco', 'm\u00adacaco', 'mаcaco', 'maca-co', 'm_a_c_a_c_o'])(
    'caractere invisível, homóglifo e hífen: %s',
    (text) => {
      expect(chat(text).action).toBe('shadow');
    },
  );

  it.each([
    'senzal@',
    'sudac@',
    'faggo+',
    'n1gg@',
    'baianad@',
    'n\u0131gger',
    'n\u20dcigger',
    'mac\u3164aco',
  ])('símbolo no fim, i sem ponto, marca e preenchimento invisível: %s', (text) => {
    expect(chat(text, text.startsWith('f') || text.startsWith('n') ? 'en' : 'pt-BR').action).toBe('shadow');
  });

  it.each([
    'vc vai morrer',
    'vai morrer desgraçado',
    'vou explodir sua casa',
    'vou explodir o estádio',
    'voces vao morrer',
  ])('ameaça com alvo: %s', (text) => {
    expect(chat(text).action).toBe('shadow');
  });

  it.each([
    'acessa meusite ponto com.',
    'meusite ponto com 🔥',
    'meusite . com!',
    'meusite ponto com ponto br',
  ])('link por extenso no fim do trecho bloqueia: %s', (text) => {
    expect(chat(text).reasons).toContain('link');
  });

  it.each([
    'acessa meusite ponto com agora',
    'entra no site meusite ponto com hoje',
    'visite meusite dot com now',
  ])('link por extenso depois de palavra de chamada bloqueia: %s', (text) => {
    expect(chat(text).reasons).toContain('link');
  });

  it('macaca escrita igual não libera a mesma palavra em leet', () => {
    expect(chat('macaca m4c4c4').action).toBe('shadow');
  });

  it.each(['meusite ponto com ponto br agora', 'meusite . com agora', 'meusite. com agora'])(
    'link por extenso no meio da frase vai para a Cosmos: %s',
    (text) => {
      expect(chat(text)).toMatchObject({ suspect: true });
    },
  );

  it("apóstrofo não fura a frase (I'll kill you)", () => {
    expect(chat("I'll kill you", 'en').action).toBe('shadow');
  });

  it.each([
    'b\u200bet365',
    'meusite(.)com',
    'meusite[.]com',
    'meusite [dot] com',
    'meusite。com',
    'golpe.shop',
    'meusite.pt',
    'entra no meusite ponto com',
  ])('link e aposta disfarçados: %s', (text) => {
    expect(chat(text).action).toBe('block');
  });

  it('texto enorme sai rápido como longo demais', () => {
    const t0 = performance.now();
    const r = screen('a.'.repeat(25_000), { kind: 'chat_message' }, lists);
    expect(r.reasons).toEqual(['too_long']);
    expect(performance.now() - t0).toBeLessThan(50);
  });

  it('5.000 caracteres adversariais no mural em menos de 200 ms', () => {
    const t0 = performance.now();
    screen('a.'.repeat(2_500), { kind: 'wall_post' }, lists);
    screen('a@'.repeat(2_500), { kind: 'wall_post' }, lists);
    screen('1 '.repeat(2_500), { kind: 'wall_post' }, lists);
    expect(performance.now() - t0).toBeLessThan(200);
  });
});

describe('screen: Apelido, nome e opção de enquete', () => {
  it.each(['nickname', 'community_name', 'league_name', 'poll_option'] as ScreenKind[])(
    'qualquer achado bloqueia em %s (não dá para esconder só dos outros)',
    (kind) => {
      expect(screen('macaco', { kind }, lists).action).toBe('block');
      expect(screen('porra', { kind, locale: 'pt-BR' }, lists).action).toBe('block');
      expect(screen('Tricolor_77', { kind }, lists).action).toBe('allow');
    },
  );

  it('Apelido acima de 32 letras é longo demais', () => {
    expect(screen('x'.repeat(33), { kind: 'nickname' }, lists).reasons).toContain('too_long');
  });
});

describe('listas do cliente', () => {
  it('o cliente acrescenta termo, nunca tira', () => {
    const t = compileLists(DEFAULT_MODERATION_LISTS, { terms: { hate: { pt: ['gambá'] } } });
    expect(screen('seu gamba', { kind: 'chat_message' }, t).action).toBe('shadow');
    expect(screen('macaco', { kind: 'chat_message' }, t).action).toBe('shadow');
    expect(screen('seu gamba', { kind: 'chat_message' }, lists).action).toBe('allow');
  });

  it('o cliente libera o domínio dele', () => {
    const t = compileLists(DEFAULT_MODERATION_LISTS, {
      terms: {},
      allowedDomains: ['https://www.clube.com.br/'],
    });
    expect(screen('ingressos em clube.com.br/ingressos', { kind: 'chat_message' }, t).action).toBe('allow');
    expect(screen('ingressos em loja.clube.com.br', { kind: 'chat_message' }, t).action).toBe('allow');
    expect(screen('ingressos em clube.com.br.golpe.com', { kind: 'chat_message' }, t).action).toBe('block');
  });

  it('exceção do cliente não existe (só a Galaxie tem)', () => {
    const t = compileLists(DEFAULT_MODERATION_LISTS, {
      terms: {},
      exceptions: ['macaco'],
    } as never);
    expect(screen('macaco', { kind: 'chat_message' }, t).action).toBe('shadow');
  });
});

describe('aviso ao autor', () => {
  it('em pt, es e en, só quando bloqueia', () => {
    expect(screenNotice(chat('bet365'), 'pt-BR')).toBe('Não é permitido divulgar apostas.');
    expect(screenNotice(chat('bet365'), 'es-AR')).toBe('No se permite promocionar apuestas.');
    expect(screenNotice(chat('bet365'), 'en')).toBe('Betting promotion is not allowed.');
    expect(screenNotice(chat('macaco'), 'pt-BR')).toBeNull();
    expect(screenNotice(chat('bora'), 'pt-BR')).toBeNull();
  });
});

describe('normalização dos termos', () => {
  it('guarda a forma canônica', () => {
    expect(normalizeTerm('  Macacão* ')).toBe('macacao*');
    expect(normalizeTerm('Casa  de   APOSTA')).toBe('casa de aposta');
    expect(normalizeTerm('***')).toBe('');
  });
});

describe('modo lento automático', () => {
  it('sobe por volume e respeita o teto', () => {
    const steps = [
      { perMinute: 200, intervalS: 10 },
      { perMinute: 1000, intervalS: 30 },
    ];
    expect(autoSlowMode({ configuredS: 0, messagesPerMinute: 50, steps, maxS: 60 })).toBe(0);
    expect(autoSlowMode({ configuredS: 0, messagesPerMinute: 300, steps, maxS: 60 })).toBe(10);
    expect(autoSlowMode({ configuredS: 15, messagesPerMinute: 300, steps, maxS: 60 })).toBe(15);
    expect(autoSlowMode({ configuredS: 0, messagesPerMinute: 5000, steps, maxS: 20 })).toBe(20);
  });
});

describe('desempenho', () => {
  it('processa 500 mensagens por segundo num processo (com folga)', () => {
    const samples = [
      'Que golaço do Neymar aos 45 do segundo tempo, bora time!',
      'juiz ladrão, isso foi pênalti claríssimo',
      'm4c4c0 volta pra senzala',
      'entra no bet365 . com e usa o cupom',
      'me chama no zap 11 98765-4321',
      '¡Qué golazo de Messi! Vamos Argentina',
      'What a save by the keeper, unbelievable',
    ];
    const n = 5000;
    const t0 = performance.now();
    for (let i = 0; i < n; i += 1) chat(`${samples[i % samples.length]} ${i}`);
    const perSecond = n / ((performance.now() - t0) / 1000);
    expect(perSecond).toBeGreaterThan(500);
  });

  it('cobre todos os tipos de texto', () => {
    for (const kind of SCREEN_KINDS) expect(screen('ola', { kind }, lists).action).toBe('allow');
  });
});
