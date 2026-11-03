import { describe, expect, it } from 'vitest';
import { InMemoryPackageStore } from '../assets/acervo/pacote.js';
import { InMemoryObjectStore } from '../assets/object-store.js';
import { acervoEnvDeps, coverageKey, publicWarnings, type AcervoTaskDeps } from './acervo.js';

describe('acervo.importar: bucket das tarefas (#587)', () => {
  it('o relatório da prévia vai para o bucket privado das tarefas, não para o de assets', () => {
    const env = { S3_BUCKET: 'galaxie-sports-assets' };
    expect(acervoEnvDeps(env).bucket()).toBe('galaxie-sports-tasks');
    expect(acervoEnvDeps({ ...env, S3_TASKS_BUCKET: 'tarefas-dev' }).bucket()).toBe('tarefas-dev');
    // sem S3_BUCKET no env também resolve: o relatório só precisa do bucket das tarefas
    expect(acervoEnvDeps({}).bucket()).toBe('galaxie-sports-tasks');
    expect(() => acervoEnvDeps({ ...env, S3_TASKS_BUCKET: 'galaxie-sports-assets' }).bucket()).toThrow(
      /público/,
    );
    expect(coverageKey('abc')).toBe('tasks/abc/cobertura.md');
  });

  it('pacote ou manifesto no bucket público de assets: aceito, com aviso no log da prévia', () => {
    const d = acervoEnvDeps({ S3_BUCKET: 'galaxie-sports-assets' });
    expect(
      publicWarnings(d, {
        pacote: 's3://galaxie-sports-assets/tasks/abc/pacote.tgz',
        manifesto: 's3://galaxie-sports-tasks/tasks/abc/exemplo.yaml',
      }),
    ).toEqual([
      expect.stringContaining('s3://galaxie-sports-assets/tasks/abc/pacote.tgz está no bucket público'),
    ]);
    expect(publicWarnings(d, { pacote: 's3://galaxie-sports-tasks/tasks/abc/pacote.tgz' })).toEqual([]);
    // dependências de teste sem o aviso: nada a dizer
    const semAviso: AcervoTaskDeps = {
      packages: () => new InMemoryPackageStore(),
      objects: () => new InMemoryObjectStore(),
      manifestDir: '.',
      bucket: () => 'b',
    };
    expect(publicWarnings(semAviso, { pacote: 's3://galaxie-sports-assets/x.tgz' })).toEqual([]);
  });
});
