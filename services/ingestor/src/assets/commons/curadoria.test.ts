import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readManifest } from './manifest.js';

/** Marcas de carro de corrida que aparecem nos títulos da Commons. */
const MAKES =
  'Allard|Alfa Romeo|BMW|Brabham|BRM|Cooper|Ensign|Ferrari|Ford|Gordini|Halibrand|Honda|Jaguar|Kurtis|LDS|Ligier|' +
  'Lola|Lotus|March|Maserati|Matra|McLaren|Mercedes|Mirage|Porsche|Renault|Rondeau|Shadow|Surtees|Toyota|Tyrrell|' +
  'Vanwall|Watson|Williams';
/** Palavra de foto de carro (ou de capacete) no título. */
const CAR_WORDS = /race ?car|winningcar|front view|rear view|side view|helmet/i;
/** Marca seguida de modelo: código com número ("Surtees TS9", "Ferrari 156") ou sigla ("BMW CSL", "Toyota GT-One"). */
const CAR_MODEL = new RegExp(`\\b(?:${MAKES})\\s+(?:(?:[A-Z]{1,3}[\\s-]?)?\\d|[A-Z]{2,}\\b)`);
const CAR_TITLE = { test: (title: string) => CAR_WORDS.test(title) || CAR_MODEL.test(title) };

/** Curadoria da auditoria de 25/10 no manifesto versionado (config/assets/commons/f1.yaml). */
describe('curadoria do manifesto (auditoria de 25/10)', () => {
  const manifest = readManifest(
    fileURLToPath(new URL('../../../../../config/assets/commons/f1.yaml', import.meta.url)),
  )!;
  const byTarget = new Map(manifest.entries.map((e) => [e.target, e]));
  const kept = (target: string) => byTarget.get(target)!.photos.filter((p) => p.match !== 'rejected');

  it('Johansson: a galeria de 5 fotos está no manifesto, com ranks sem repetição', () => {
    // a proteção contra a descoberta vazia está no mapCommons (#299; commons.test.ts)
    const photos = kept('driver/stefan-johansson');
    expect(photos.map((p) => p.file).sort()).toEqual([
      'File:1983 Race of Champions, Johansson.jpg',
      'File:1989 Belgian GP race start 07.jpg',
      'File:1989 Belgian GP race start 08.jpg',
      'File:Johanson at 1986 Italian Grand Prix.jpg',
      'File:Toleman TG184 Johansson.jpg',
    ]);
    expect(new Set(photos.map((p) => p.rank)).size).toBe(photos.length);
  });

  it('Salazar: sem a foto legendada como Eddie Cheever nem a dos fiscais', () => {
    expect(kept('driver/eliseo-salazar').map((p) => p.file)).toEqual([
      'File:Eliseo Salazar 1982.jpg',
      'File:Salazar and Lammers at 1982 Dutch Grand Prix.jpg',
    ]);
  });

  it('Watson de 1956 a 1960: nenhuma foto dos roadsters de 1962 a 1964; 1960 com o carro vencedor de Indianápolis', () => {
    for (const season of [1956, 1958, 1959]) expect(kept(`car/watson/${season}`)).toEqual([]);
    expect(kept('car/watson/1960').map((p) => [p.file, p.role, p.season, p.match])).toEqual([
      ['File:Indy500winningcar1960.JPG', 'car', 1960, 'manual'],
    ]);
  });

  it('retrato automático com título de carro só quando o Gemini viu o piloto na foto', () => {
    // título de carro com o piloto no cockpit pode ser retrato legítimo: vale a descrição do Gemini, não o título
    const pilotSeen = (p: { selected_by: string; reason?: string | null }) =>
      p.selected_by === 'gemini' && /\bpiloto\b/i.test(p.reason ?? '');
    const portraits = manifest.entries
      .filter((e) => e.kind === 'driver')
      .flatMap((e) =>
        e.photos
          .filter((p) => p.role === 'portrait' && p.match === 'auto' && CAR_TITLE.test(p.file))
          .map((p) => ({ target: e.target, ...p })),
      );
    expect(portraits.filter((p) => !pilotSeen(p)).map((p) => `${p.target}: ${p.file}`)).toEqual([]);
    // os que ficam pela descrição do Gemini (conferir visualmente)
    expect(portraits.map((p) => p.target).sort()).toEqual([
      'driver/franco-rol',
      'driver/giancarlo-baghetti',
      'driver/giorgio-scarlatti',
      'driver/gunnar-nilsson',
      'driver/jacky-ickx',
      'driver/luigi-musso',
      'driver/michele-alboreto',
      'driver/piers-courage',
    ]);
    // a regra pega os casos da auditoria (que agora estão rejeitados, com o motivo)
    const rejected = manifest.entries.flatMap((e) =>
      e.photos.filter((p) => p.role === 'portrait' && p.match === 'rejected'),
    );
    expect(rejected.filter((p) => CAR_TITLE.test(p.file)).length).toBeGreaterThanOrEqual(5);
    expect(rejected.every((p) => /não é retrato/.test(p.reason ?? ''))).toBe(true);
  });

  it('Schuppan: a Mirage de Le Mans 1976 sai do retrato e fica como foto de ação', () => {
    expect(kept('driver/vern-schuppan').map((p) => [p.file, p.role, p.match])).toEqual([
      ['File:GTC Mirage 11.jpg', 'action', 'manual'],
    ]);
  });
});
