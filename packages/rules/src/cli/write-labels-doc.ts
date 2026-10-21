import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { renderLabelsMarkdown } from '../stakes/labels-doc.js';

/** Regenera docs/rules/rotulos.md a partir do mapa de rótulos. */
const target = fileURLToPath(new URL('../../../../docs/rules/rotulos.md', import.meta.url));
await writeFile(target, renderLabelsMarkdown());
console.log(`Rótulos gravados em ${target}`);
