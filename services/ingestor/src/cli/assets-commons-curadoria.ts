/**
 * Curadoria do carro de destaque (fundo do heading) pedida pelo produto — docs/runbooks/fotos-commons.md.
 *   pnpm --filter @galaxie/ingestor assets:commons:curadoria [--manifesto <arquivo>]
 * Aplica `CURADORIA` ao manifesto: a foto entra como `match: manual` no alvo indicado (com a licença lida de novo
 * na Commons, recusando CC BY-SA, que não vai ao fundo) e o `highlight_car` do piloto vira `manual` com `file`.
 * Idempotente: rodar de novo (também depois de uma varredura) dá o mesmo manifesto.
 */
import { join } from 'node:path';
import { WikimediaClient } from '../assets/commons/client.js';
import { readLicense } from '../assets/commons/license.js';
import { readManifest, writeManifest, type ManifestPhoto } from '../assets/commons/manifest.js';
import { parseArgs } from '../multisport/cli-args.js';

interface Curadoria {
  driver: string;
  /** Alvo do carro de destaque (`car/<construtor>/<ano>`). */
  car: string;
  /** Temporada do carro (não a data do arquivo: carro histórico fotografado depois fica com o ano dele). */
  season: number;
  /** Alvo onde a foto entra (o carro ou a galeria do piloto). */
  photoIn: string;
  role: ManifestPhoto['role'];
  file: string;
  reason: string;
}

export const CURADORIA: Curadoria[] = [
  {
    driver: 'driver/lewis-hamilton',
    car: 'car/ferrari/2026',
    season: 2026,
    photoIn: 'driver/lewis-hamilton',
    role: 'action',
    file: 'File:2026 Chinese GP - Ferrari - Lewis Hamilton - Qualifying.jpg',
    reason: 'pedido do produto: equipe atual (Ferrari SF-26, GP da China de 2026)',
  },
  {
    driver: 'driver/juan-manuel-fangio',
    car: 'car/mercedes/1955',
    season: 1955,
    photoIn: 'car/mercedes/1955',
    role: 'car',
    file: 'File:Grote Prijs van Nederland Zandvoort. Vooraan J. M. Fangio in Mercedes (de latere, Bestanddeelnr 907-1903.jpg',
    reason:
      'pedido do produto: o W196 do título de 1955, em corrida (Fangio com o #8 à frente no GP da Holanda); a sugerida, de 1986, é CC BY-SA e não vai ao fundo',
  },
  {
    driver: 'driver/nino-farina',
    car: 'car/alfa-romeo/1950',
    season: 1950,
    photoIn: 'car/alfa-romeo/1950',
    role: 'car',
    file: 'File:1950 Italian Grand Prix - Farina (Alfa Romeo) ahead Ascari (Ferrari) at Porfido bends.jpg',
    reason:
      'pedido do produto: Farina de Alfa Romeo à frente do Ascari, GP da Itália de 1950, o ano do título',
  },
];

const args = parseArgs(process.argv.slice(2));
const root = join(import.meta.dirname, '..', '..', '..', '..');
const path = String(args.get('manifesto') ?? join(root, 'config', 'assets', 'commons', 'f1.yaml'));
const manifest = readManifest(path);
if (!manifest) throw new Error(`Manifesto não encontrado: ${path}`);
const client = new WikimediaClient({ log: (m) => console.log(m) });
const files = await client.imageInfo(
  CURADORIA.map((c) => c.file),
  512,
);
for (const c of CURADORIA) {
  const f = files.find((x) => x.title === c.file);
  if (!f) throw new Error(`${c.file}: não achado na Commons`);
  const verdict = readLicense(f.extmetadata);
  if (!verdict.ok) throw new Error(`${c.file}: ${verdict.reason}`);
  const l = verdict.value;
  if (l.shareAlike) throw new Error(`${c.file}: ${l.license} (BY-SA) não vai ao fundo do heading`);
  const host = manifest.entries.find((e) => e.target === c.photoIn);
  const driver = manifest.entries.find((e) => e.target === c.driver);
  if (!host || !driver) throw new Error(`${c.photoIn} ou ${c.driver} fora do manifesto (rode --mapear)`);
  const photo: ManifestPhoto = {
    file: f.title,
    role: c.role,
    season: c.season,
    rank: 0,
    match: 'manual',
    selected_by: 'manual',
    page_url: f.pageUrl,
    license: l.license,
    license_url: l.licenseUrl,
    author: l.author,
    author_url: l.authorUrl,
    credit: l.credit,
    attribution_required: l.attributionRequired,
    share_alike: l.shareAlike,
    date: l.dateTaken,
    width: f.width,
    height: f.height,
    reason: c.reason,
  };
  host.photos = [photo, ...host.photos.filter((p) => p.file !== f.title)];
  driver.highlight_car = {
    target: c.car,
    season: c.season,
    reason: c.reason,
    match: 'manual',
    file: f.title,
  };
  console.log(`${c.driver}: ${c.car} (${c.season}) · ${f.title} · ${l.license}`);
}
writeManifest(path, manifest);
console.log(`manifesto: ${path}`);
