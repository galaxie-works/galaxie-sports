import { describe, expect, it } from 'vitest';
import type { Database } from '@galaxie/db';
import {
  avaliarEsquema,
  codigoDeSaida,
  formatarHoras,
  relatorio,
  runEsquemaCli,
  urlSemSenha,
  type GitJournal,
} from './esquema.js';

const NOW = new Date('2026-11-03T12:00:00Z');
const H = 3_600_000;

/** Journal com três migrations geradas 10, 9 e 8 dias atrás. */
const journal = {
  entries: [
    { idx: 0, when: NOW.getTime() - 240 * H, tag: '0000_base' },
    { idx: 1, when: NOW.getTime() - 216 * H, tag: '0001_tabelas' },
    { idx: 2, when: NOW.getTime() - 192 * H, tag: '0002_indices' },
  ],
};
const whens = journal.entries.map((e) => e.when);

describe('avaliarEsquema', () => {
  it('em dia quando o banco tem exatamente o journal', () => {
    const r = avaliarEsquema({ journal, aplicadas: whens, entrouNaMain: null, now: NOW });
    expect(r.estado).toBe('em_dia');
    expect(r).toMatchObject({
      aplicadas: 3,
      journal: 3,
      ultimaAplicada: '0002_indices',
      faltam: [],
      atrasoHoras: null,
    });
    expect(codigoDeSaida(r.estado)).toBe(0);
  });

  it('pendente dentro do limite: a migration entrou na main há 2 h', () => {
    const entrouNaMain = (tag: string) => (tag === '0002_indices' ? new Date(NOW.getTime() - 2 * H) : null);
    const r = avaliarEsquema({ journal, aplicadas: whens.slice(0, 2), entrouNaMain, now: NOW });
    expect(r.estado).toBe('pendente');
    expect(r.faltam).toEqual([
      { tag: '0002_indices', desde: new Date(NOW.getTime() - 2 * H), commitDaMain: true },
    ]);
    expect(r.atrasoHoras).toBeCloseTo(2);
    expect(codigoDeSaida(r.estado)).toBe(0);
  });

  it('atrasado quando a migration mais antiga que falta passou do limite (o relógio é o da mais antiga)', () => {
    const entrouNaMain = (tag: string) =>
      tag === '0001_tabelas' ? new Date(NOW.getTime() - 30 * H) : new Date(NOW.getTime() - 1 * H);
    const r = avaliarEsquema({ journal, aplicadas: whens.slice(0, 1), entrouNaMain, now: NOW });
    expect(r.estado).toBe('atrasado');
    expect(r.faltam.map((f) => f.tag)).toEqual(['0001_tabelas', '0002_indices']);
    expect(r.atrasoHoras).toBeCloseTo(30);
    expect(r.ultimaAplicada).toBe('0000_base');
    expect(codigoDeSaida(r.estado)).toBe(1);
  });

  it('sem git, "desde" é o when do journal (gerada antes do merge: conservador) e --limite-horas vale', () => {
    const r = avaliarEsquema({ journal, aplicadas: whens.slice(0, 2), entrouNaMain: null, now: NOW });
    expect(r.estado).toBe('atrasado');
    expect(r.faltam).toEqual([{ tag: '0002_indices', desde: new Date(whens[2]!), commitDaMain: false }]);
    const folgado = avaliarEsquema({
      journal,
      aplicadas: whens.slice(0, 2),
      entrouNaMain: null,
      now: NOW,
      limiteHoras: 300,
    });
    expect(folgado.estado).toBe('pendente');
  });

  it('migration que o git não acha no ref (ainda não entrou na main) conta pelo when, não some', () => {
    const r = avaliarEsquema({ journal, aplicadas: whens.slice(0, 2), entrouNaMain: () => null, now: NOW });
    expect(r.faltam[0]).toMatchObject({ tag: '0002_indices', commitDaMain: false });
  });

  it('o critério é o do migrator: só falta o que tem when maior que o da última aplicada; o resto é "pulada"', () => {
    // 0001 sem linha, mas 0002 (when maior) aplicada: o Drizzle nunca mais aplica a 0001, e o dev não está atrasado
    const r = avaliarEsquema({ journal, aplicadas: [whens[0]!, whens[2]!], entrouNaMain: null, now: NOW });
    expect(r.estado).toBe('em_dia');
    expect(r.faltam).toEqual([]);
    expect(r.puladas).toEqual(['0001_tabelas']);
    expect(relatorio(r, 'origin/main').join('\n')).toContain('puladas                0001_tabelas:');
    // linha histórica fora do journal, sem passar da última do journal: só informação, segue em dia
    const hist = avaliarEsquema({
      journal,
      aplicadas: [...whens, whens[0]! + 1],
      entrouNaMain: null,
      now: NOW,
    });
    expect(hist.estado).toBe('em_dia');
    expect(hist.desconhecidas).toEqual([whens[0]! + 1]);
    expect(relatorio(hist, 'origin/main').join('\n')).toContain('desconhecidas          1 linha(s)');
  });

  it('vazio: sem a tabela de controle, ou sem linha nenhuma', () => {
    expect(avaliarEsquema({ journal, aplicadas: null, entrouNaMain: null, now: NOW }).estado).toBe('vazio');
    expect(avaliarEsquema({ journal, aplicadas: [], entrouNaMain: null, now: NOW }).estado).toBe('vazio');
    expect(codigoDeSaida('vazio')).toBe(1);
  });

  it('à frente: o banco tem migration que o journal comparado não conhece (checkout velho)', () => {
    const r = avaliarEsquema({
      journal,
      aplicadas: [...whens, NOW.getTime() - H],
      entrouNaMain: null,
      now: NOW,
    });
    expect(r.estado).toBe('adiante');
    expect(r.desconhecidas).toEqual([NOW.getTime() - H]);
    expect(r.ultimaAplicada).toBe(`when ${NOW.getTime() - H}`);
    expect(codigoDeSaida(r.estado)).toBe(0);
  });
});

describe('relatório', () => {
  it('diz de onde veio o journal, o que falta e desde quando', () => {
    const r = avaliarEsquema({
      journal,
      aplicadas: whens.slice(0, 2),
      entrouNaMain: () => new Date('2026-11-01T10:00:00Z'),
      now: NOW,
    });
    const text = relatorio(r, 'origin/main').join('\n');
    expect(text).toContain('journal (origin/main)     3 migrations, última 0002_indices');
    expect(text).toContain('aplicadas no banco     2, última 0001_tabelas');
    expect(text).toContain('falta                  0002_indices (na main desde 2026-11-01T10:00:00.000Z)');
    expect(text).toMatch(/estado\s+ATRASADO há 2 d 2 h \(limite 24 h\)/);
  });

  it('formata horas em min, h e d', () => {
    expect(formatarHoras(0.5)).toBe('30 min');
    expect(formatarHoras(2.4)).toBe('2 h');
    expect(formatarHoras(50)).toBe('2 d 2 h');
  });

  it('a URL do relatório sai sem a senha', () => {
    expect(urlSemSenha('postgres://galaxie:segredo@192.168.1.34:5433/galaxie_sports')).toBe(
      'postgres://galaxie@192.168.1.34:5433/galaxie_sports',
    );
    expect(urlSemSenha('postgres://galaxie:seg redo@nas/x')).toBe('postgres://galaxie@nas/x');
  });
});

describe('gs dev:esquema', () => {
  const db = {} as Database;
  const url = 'postgres://galaxie:segredo@192.168.1.34:5433/galaxie_sports';
  function setup(aplicadas: number[] | null | Error, fonte: Partial<GitJournal> = {}) {
    const out: string[] = [];
    const err: string[] = [];
    const chamadas: { ref: string; semFetch: boolean }[] = [];
    const run = (...argv: string[]) =>
      runEsquemaCli(argv, db, url, {
        out: (l) => out.push(l),
        err: (l) => err.push(l),
        now: NOW,
        journal: (ref, semFetch) => {
          chamadas.push({ ref, semFetch });
          return { journal, origem: ref, entrouNaMain: null, avisos: [], ...fonte };
        },
        aplicadas: async () => {
          if (aplicadas instanceof Error) throw aplicadas;
          return aplicadas;
        },
      });
    return { out, err, chamadas, run };
  }

  it('em dia: sai 0 com o relatório, sem a senha', async () => {
    const { out, run, chamadas } = setup(whens);
    expect(await run()).toBe(0);
    expect(out[0]).toBe('Esquema do dev: postgres://galaxie@192.168.1.34:5433/galaxie_sports');
    expect(out.join('\n')).toMatch(/estado\s+em dia/);
    expect(chamadas).toEqual([{ ref: 'origin/main', semFetch: false }]);
  });

  it('atrasado: sai 1; --json traz o estado e a origem; --ref e --sem-fetch chegam ao leitor do journal', async () => {
    const { out, run, chamadas } = setup(whens.slice(0, 1));
    expect(await run('--json', '--ref', 'upstream/main', '--sem-fetch')).toBe(1);
    const r = JSON.parse(out.join('\n'));
    expect(r).toMatchObject({ estado: 'atrasado', origem: 'upstream/main', aplicadas: 1, journal: 3 });
    expect(r.banco).not.toContain('segredo');
    expect(chamadas).toEqual([{ ref: 'upstream/main', semFetch: true }]);
  });

  it('--limite-horas folgado vira pendente (0); valor inválido é erro de uso (2)', async () => {
    const { run } = setup(whens.slice(0, 2));
    expect(await run('--limite-horas', '300')).toBe(0);
    expect(await run('--limite-horas', 'x')).toBe(2);
  });

  it('avisos do git saem na saída de erro; banco ilegível sai 1 com a mensagem', async () => {
    const semGit = setup(whens, {
      origem: 'pacote',
      avisos: ['sem o journal de origin/main pelo git (git: not found)'],
    });
    expect(await semGit.run()).toBe(0);
    expect(semGit.err[0]).toContain('aviso: sem o journal de origin/main');
    expect(semGit.out.join('\n')).toContain('journal (pacote)');
    const quebrado = setup(new Error('ECONNREFUSED 192.168.1.34:5433'));
    expect(await quebrado.run()).toBe(1);
    expect(quebrado.err[0]).toBe(
      'não deu para ler o banco postgres://galaxie@192.168.1.34:5433/galaxie_sports: ECONNREFUSED 192.168.1.34:5433',
    );
  });

  it('--help mostra o uso e sai 0; opção desconhecida sai 2', async () => {
    const { out, err, run } = setup(whens);
    expect(await run('--help')).toBe(0);
    expect(out[0]).toContain('Uso: gs dev:esquema');
    expect(await run('--nada')).toBe(2);
    expect(err.at(-1)).toContain('Uso: gs dev:esquema');
  });
});
