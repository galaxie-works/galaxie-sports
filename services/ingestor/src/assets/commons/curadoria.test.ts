import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { mergeEntry, readManifest } from './manifest.js';
import type { DriverTarget } from './scope.js';

/** Curadoria da auditoria de 25/10 no manifesto versionado (config/assets/commons/f1.yaml). */
describe('curadoria do manifesto (auditoria de 25/10)', () => {
  const manifest = readManifest(
    fileURLToPath(new URL('../../../../../config/assets/commons/f1.yaml', import.meta.url)),
  )!;
  const byTarget = new Map(manifest.entries.map((e) => [e.target, e]));
  const kept = (target: string) => byTarget.get(target)!.photos.filter((p) => p.match !== 'rejected');

  it('Johansson: a galeria restaurada sobrevive a uma varredura que não acha o piloto', () => {
    const previous = byTarget.get('driver/stefan-johansson')!;
    expect(kept('driver/stefan-johansson').map((p) => [p.file, p.match])).toEqual([
      ['File:1983 Race of Champions, Johansson.jpg', 'manual'],
      ['File:Toleman TG184 Johansson.jpg', 'manual'],
      ['File:Johanson at 1986 Italian Grand Prix.jpg', 'manual'],
    ]);
    // o que gravou photos: [] em 23/10: sem item conferido no Wikidata, nenhuma candidata
    const target: DriverTarget = {
      kind: 'driver',
      f1dbId: 'stefan-johansson',
      name: 'Stefan Johansson',
      dateOfBirth: '1956-09-08',
      seasons: [1983, 1984, 1985, 1986, 1987, 1988, 1989, 1990, 1991],
      highlight: null,
    };
    const next = mergeEntry(
      target,
      { target, wikidata: null, category: null, candidates: [], note: 'sem item conferido no Wikidata' },
      [],
      previous,
    );
    expect(next.photos.filter((p) => p.match !== 'rejected')).toHaveLength(3);
    expect(next.photos.filter((p) => p.match === 'rejected')).toHaveLength(2);
  });

  it('Salazar: sem a foto legendada como Eddie Cheever nem a dos fiscais', () => {
    expect(kept('driver/eliseo-salazar').map((p) => p.file)).toEqual([
      'File:Eliseo Salazar 1982.jpg',
      'File:Salazar and Lammers at 1982 Dutch Grand Prix.jpg',
    ]);
  });

  it('Watson de 1956 a 1960: nenhuma foto dos roadsters de 1962 a 1964', () => {
    for (const season of [1956, 1958, 1959, 1960]) expect(kept(`car/watson/${season}`)).toEqual([]);
  });

  it('retrato nunca é só o carro ou o capacete', () => {
    const portraits = [
      'driver/eddie-sachs',
      'driver/jim-rathmann',
      'driver/moises-solana',
      'driver/peter-collins',
      'driver/sam-tingle',
      'driver/doug-serrurier',
      'driver/jack-fairman',
      'driver/vern-schuppan',
      'driver/rubens-barrichello',
    ].flatMap((t) => kept(t).filter((p) => p.role === 'portrait'));
    expect(portraits).toEqual([]);
    // e o motivo fica registrado na foto rejeitada
    const rejected = byTarget.get('driver/eddie-sachs')!.photos.find((p) => p.match === 'rejected');
    expect(rejected?.reason).toMatch(/não é retrato/);
  });
});
