import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { renderFanTagsMarkdown } from '../stakes/fan-tags-doc.js';
import { renderLabelsMarkdown } from '../stakes/labels-doc.js';

/** Regenera docs/rules/rotulos.md (rótulos dos stakes) e docs/rules/tags-torcedor.md (fan tags). */
const docs = new URL('../../../../docs/rules/', import.meta.url);
for (const [file, render] of [
  ['rotulos.md', renderLabelsMarkdown],
  ['tags-torcedor.md', renderFanTagsMarkdown],
] as const) {
  const target = fileURLToPath(new URL(file, docs));
  await writeFile(target, render());
  console.log(`Gravado ${target}`);
}
