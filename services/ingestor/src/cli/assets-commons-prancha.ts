/**
 * Prancha de revisão do fundo do heading dos pilotos (página HTML com as miniaturas da Commons) —
 * docs/runbooks/fotos-commons.md.
 *   node dist/cli/assets-commons-prancha.js --manifesto /data/commons/f1.yaml --antes f1-antes.yaml \
 *     --saida /data/commons/prancha.html
 * Só lê os manifestos: não chama a Commons nem o banco. Com --antes, os pilotos cujo fundo trocou vêm primeiro.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readManifest } from '../assets/commons/manifest.js';
import { pranchaHtml, pranchaRows } from '../assets/commons/prancha.js';
import { parseArgs } from '../multisport/cli-args.js';

const args = parseArgs(process.argv.slice(2));
const root = join(import.meta.dirname, '..', '..', '..', '..');
const path = String(args.get('manifesto') ?? join(root, 'config', 'assets', 'commons', 'f1.yaml'));
const manifest = readManifest(path);
if (!manifest) throw new Error(`Manifesto não encontrado: ${path}`);
const before = args.has('antes') ? readManifest(String(args.get('antes'))) : null;
const rows = pranchaRows(manifest, before);
const out = String(args.get('saida') ?? path.replace(/\.yaml$/, '.prancha.html'));
writeFileSync(out, pranchaHtml(rows, `Fundo do heading dos pilotos — ${manifest.acervo.revision}`));
const changed = rows.filter((r) => r.changed);
console.log(
  `${rows.length} pilotos · ${changed.length} trocados · ${rows.filter((r) => !r.file).length} sem fundo`,
);
for (const r of changed) console.log(`  ${r.target}: ${r.before ?? 'sem fundo'} → ${r.file ?? 'sem fundo'}`);
console.log(`prancha: ${out}`);
