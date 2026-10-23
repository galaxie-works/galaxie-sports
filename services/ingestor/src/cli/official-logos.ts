/**
 * Acervo oficial de logos de canais (Figma) → biblioteca de emissoras do onde assistir.
 *
 *   # 1) (re)gera o manifesto e o relatório a partir do XML do get_metadata do frame "Channel Logos"
 *   #    e da pasta com os SVGs exportados (um por símbolo: `<nó com hífen>.svg`; os nomes com acento
 *   #    vêm do SVG). Mapeamentos `curated: true` e `excluded_nodes` do manifesto atual são mantidos.
 *   pnpm --filter @galaxie/ingestor assets:official-logos --plan --metadata <arquivo.xml> --dir <pasta>
 *
 *   # 2) sobe os SVGs (limpos) no bucket, registra core.asset e liga os logos às emissoras
 *   pnpm --filter @galaxie/ingestor assets:official-logos --dir <pasta> [--dry-run]
 *
 * Variáveis (2): DATABASE_URL, S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { stringify } from 'yaml';
import { closeDb, createDb } from '@galaxie/db';
import {
  defaultConfigRoot,
  libraryFromConfig,
  loadWtwConfig,
  planOfficialLogos,
  syncBroadcasterLibrary,
  type OfficialLogoEntry,
  type OfficialLogoManifest,
} from '@galaxie/where-to-watch';
import { objectStoreFromEnv } from '../assets/object-store.js';
import {
  cleanFigmaSvg,
  countStoredOfficialLogos,
  officialLogoFile,
  parseFigmaChannelFrames,
  runOfficialLogoImport,
} from '../assets/official-logos.js';
import { officialLogoReport } from '../assets/official-logos-report.js';

const { values } = parseArgs({
  options: {
    plan: { type: 'boolean', default: false },
    metadata: { type: 'string' },
    dir: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
    relatorio: { type: 'string', default: resolve('../../docs/research/logos-acervo-oficial.md') },
  },
});

if (!values.dir) throw new Error('Informe --dir <pasta com os SVGs exportados do acervo>.');
const dir = resolve(values.dir);
const manifestPath = join(defaultConfigRoot(), 'broadcasters', '_official_logos.yaml');
const config = loadWtwConfig();

const HEADER = `# =============================================================================
# Acervo oficial de logos de canais — fonte principal dos logos da biblioteca de emissoras
# (enrich.broadcaster). Gerado por \`assets:official-logos --plan\` (services/ingestor).
#
# source: acervo oficial de logos (Figma); \`node\` de cada logo é o frame do componente e
# \`light\`/\`dark\` são os símbolos das versões clara e escura — os ids servem para reimportar.
# Os arquivos não ficam no git: o importador sobe os SVGs no bucket (broadcasters/<sha>.svg) e
# registra core.asset com \`acervo-oficial://<nó>\`; a sincronização da biblioteca os liga.
#
# status: primary (logo principal da emissora) · channel (logo de um canal da emissora; \`channel\`
# usa a grafia do dicionário) · variant (versão HD de um logo já ligado) · unmapped (sem emissora
# na biblioteca — curadoria). Para fixar um mapeamento à mão: preencha broadcaster/channel/status e
# marque \`curated: true\` (o --plan não recalcula). \`excluded_nodes\`: componentes deixados fora da
# biblioteca por decisão da curadoria (marca própria de operadora) — só o id do nó.
# Relatório: docs/research/logos-acervo-oficial.md.
# =============================================================================
`;

function manifestYaml(m: OfficialLogoManifest): string {
  const body = {
    schema_version: 1,
    source: {
      description: m.source.description,
      figma_file: m.source.fileKey,
      node: m.source.node,
      imported_at: m.source.importedAt,
    },
    excluded_nodes: m.excludedNodes,
    logos: m.logos.map((l: OfficialLogoEntry) => ({
      node: l.node,
      name: l.name,
      letter: l.letter,
      hd: l.hd,
      light: l.light,
      dark: l.dark,
      broadcaster: l.broadcaster,
      channel: l.channel,
      status: l.status,
      ...(l.curated ? { curated: true } : {}),
      ...(l.note ? { note: l.note } : {}),
    })),
  };
  return (
    HEADER + stringify(body, { lineWidth: 0, defaultStringType: 'QUOTE_SINGLE', defaultKeyType: 'PLAIN' })
  );
}

if (values.plan) {
  if (!values.metadata)
    throw new Error('--plan: informe --metadata <XML do get_metadata do frame do acervo>.');
  const previous = config.officialLogos;
  if (!previous) throw new Error(`${manifestPath}: crie o manifesto com o bloco source (e excluded_nodes).`);
  const excluded = new Set(previous.excludedNodes);
  const components = parseFigmaChannelFrames(readFileSync(resolve(values.metadata), 'utf8'))
    .filter((c) => c.letter && !excluded.has(c.node))
    .map((c) => {
      // nome com acento: o do SVG exportado (o XML do get_metadata pode vir sem os acentos)
      const file = join(dir, officialLogoFile(c.light));
      const name = existsSync(file) ? cleanFigmaSvg(readFileSync(file, 'utf8')).componentName : null;
      return name ? { ...c, name } : c;
    });
  const library = libraryFromConfig(config);
  const logos = planOfficialLogos(components, library, previous.logos);
  const manifest: OfficialLogoManifest = {
    ...previous,
    source: { ...previous.source, importedAt: new Date().toISOString().slice(0, 10) },
    logos,
  };
  writeFileSync(manifestPath, manifestYaml(manifest));
  const withoutFile = logos
    .filter((l) => !existsSync(join(dir, officialLogoFile(l.light))))
    .map((l) => l.name);
  writeFileSync(resolve(values.relatorio), officialLogoReport(manifest, library, withoutFile));
  const by = (s: string) => logos.filter((l) => l.status === s).length;
  console.log(
    JSON.stringify({
      componentes: components.length,
      excluidos: excluded.size,
      principais: by('primary'),
      canais: by('channel'),
      variantes: by('variant'),
      sem_mapeamento: by('unmapped'),
      manifesto: manifestPath,
      relatorio: resolve(values.relatorio),
    }),
  );
} else {
  const manifest = config.officialLogos;
  if (!manifest) throw new Error(`Manifesto ausente: ${manifestPath}`);
  const { DATABASE_URL } = process.env;
  if (!DATABASE_URL) throw new Error('Defina DATABASE_URL (.env).');
  const db = createDb(DATABASE_URL);
  try {
    const objects = objectStoreFromEnv();
    const report = await runOfficialLogoImport({ db, objects, manifest, dir, dryRun: values['dry-run'] });
    const library = values['dry-run'] ? null : await syncBroadcasterLibrary(db, config);
    console.log(
      JSON.stringify({
        ...report,
        missing: report.missing.slice(0, 20),
        noStorage: await countStoredOfficialLogos(db),
        biblioteca: library,
      }),
    );
    // arquivo ausente só avisa (o Figma não exporta símbolos fora da área do frame); falha de leitura é erro
    if (report.failed.length) process.exitCode = 1;
  } finally {
    await closeDb(db);
  }
}
