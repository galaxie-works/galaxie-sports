import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { registryItemSchema } from 'shadcn/schema';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { WIDGET_CATALOG } from '../catalog.js';
import { DEFAULT_THEMES, WIDGET_KINDS } from '../core/model.js';
import { buildRegistryItem, toRegistryName } from './build-registry-item.js';
import { CORE_FILE, WIDGET_FILES } from './sources.generated.js';

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const base = {
  theme: DEFAULT_THEMES.emerald,
  apiBaseUrl: 'https://api.galaxie.sports/',
} as const;

/** Erros de sintaxe do TSX gerado (sem checar tipos: isso fica para o teste com o app Next). */
function syntaxErrors(content: string): string[] {
  const out = ts.transpileModule(content, {
    reportDiagnostics: true,
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  });
  return (out.diagnostics ?? []).map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
}

describe('buildRegistryItem', () => {
  it.each(WIDGET_KINDS)('gera um registry-item válido pelo schema do shadcn (%s)', (kind) => {
    const item = buildRegistryItem({ ...base, kind, name: `Operadora Exemplo ${kind}`, market: 'BR' });
    const parsed = registryItemSchema.safeParse(item);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    expect(item.type).toBe('registry:block');
    expect(item.files.map((f) => f.target)).toEqual([
      'components/galaxie/galaxie-core.tsx',
      `components/galaxie/operadora-exemplo-${kind.replace(/_/g, '-')}.tsx`,
    ]);
    for (const file of item.files) {
      expect(syntaxErrors(file.content)).toEqual([]);
      expect(file.content).not.toMatch(/^import .*from '(\.\.\/|@galaxie\/)/m); // autocontido
    }
    expect(item.files[1]!.content).toContain(`export function ${WIDGET_CATALOG[kind].registryComponent}(`);
    expect(item.files[1]!.content).toContain(`export function ${WIDGET_FILES[kind].component}(`);
  });

  it('embute o tema salvo, a API, a chave pela env e as props padrão', () => {
    const item = buildRegistryItem({
      ...base,
      kind: 'match_card',
      name: 'Placar da Operadora Exemplo',
      locale: 'es',
      market: 'ar',
      defaults: { eventId: 'abc', competitionId: 'ignorado' },
    });
    const widget = item.files[1]!.content;
    expect(item.name).toBe('placar-da-operadora-exemplo');
    expect(widget).toContain(`"primary": "${DEFAULT_THEMES.emerald.primary}"`);
    expect(widget).toContain('const GALAXIE_API_URL = "https://api.galaxie.sports";');
    expect(widget).toContain('const GALAXIE_LOCALE: WidgetLocale = "es";');
    expect(widget).toContain('const GALAXIE_MARKET: string | undefined = "AR";');
    expect(widget).toContain('const GALAXIE_DEFAULTS: Partial<MatchCardProps> = {"eventId":"abc"};');
    expect(widget).toContain('process.env.NEXT_PUBLIC_GALAXIE_PUBLISHABLE_KEY');
    expect(item.envVars).toEqual({ NEXT_PUBLIC_GALAXIE_PUBLISHABLE_KEY: '' });
    expect(item.cssVars.light['gs-primary']).toBe(DEFAULT_THEMES.emerald.primary);
    expect(item.cssVars.dark['gs-muted-foreground']).toBe(DEFAULT_THEMES.emerald.mutedForeground);
    expect(item.docs).toContain('GalaxieMatchCard');
    expect(item.meta.galaxie).toMatchObject({ kind: 'match_card', locale: 'es', market: 'AR' });
  });

  it.each([
    ['ai_context', 'AiContextProps', '{"eventId":"jogo"}'],
    ['related_videos', 'RelatedVideosProps', '{"eventId":"jogo"}'],
    ['team_schedule', 'TeamScheduleProps', '{"teamId":"time"}'],
  ] as const)('props padrão dos tipos novos (%s)', (kind, props, json) => {
    const item = buildRegistryItem({
      ...base,
      kind,
      name: 'x',
      defaults: { eventId: 'jogo', teamId: 'time', competitionId: 'ignorado' },
    });
    expect(item.files[1]!.content).toContain(`const GALAXIE_DEFAULTS: Partial<${props}> = ${json};`);
  });

  it('o núcleo é o mesmo para todos os widgets e junta model.ts + react.tsx', () => {
    const a = buildRegistryItem({ ...base, kind: 'standings', name: 'a' });
    const b = buildRegistryItem({ ...base, kind: 'live_list', name: 'b', theme: DEFAULT_THEMES.light });
    expect(a.files[0]!.content).toBe(b.files[0]!.content);
    expect(CORE_FILE.startsWith("'use client';")).toBe(true);
    expect(CORE_FILE).toContain('export function themeToCssVars(');
    expect(CORE_FILE).toContain('export function GalaxieWidgetProvider(');
    expect(CORE_FILE.match(/^import /gm)).toHaveLength(1); // só o import do React
  });

  it('os fontes embutidos acompanham os arquivos do pacote', () => {
    for (const kind of WIDGET_KINDS) {
      const source = readFileSync(join(PACKAGE_ROOT, WIDGET_FILES[kind].file), 'utf8');
      const lastLines = WIDGET_FILES[kind].body.split('\n').slice(-5).join('\n');
      expect(source.replace(/\r\n/g, '\n')).toContain(lastLines);
    }
  });

  it('recusa entrada inválida', () => {
    expect(() => buildRegistryItem({ ...base, kind: 'banner' as never, name: 'x' })).toThrow(/desconhecido/);
    expect(() =>
      buildRegistryItem({ ...base, kind: 'match_card', name: 'x', apiBaseUrl: 'javascript:alert(1)' }),
    ).toThrow(/http/);
    expect(() =>
      buildRegistryItem({
        ...base,
        kind: 'match_card',
        name: 'x',
        theme: { ...base.theme, primary: 'red;}</style>' },
      }),
    ).toThrow(/primary/);
    expect(() => buildRegistryItem({ ...base, kind: 'match_card', name: 'x', market: 'Brasil' })).toThrow(
      /ISO/,
    );
    expect(() => buildRegistryItem({ ...base, kind: 'match_card', name: 'Galaxie Core' })).toThrow(
      /reservado/,
    );
  });

  it('normaliza o nome para kebab-case seguro', () => {
    expect(toRegistryName('Operadora Exemplo · Placar!')).toBe('operadora-exemplo-placar');
    expect(toRegistryName('../../etc/passwd')).toBe('etc-passwd');
    expect(buildRegistryItem({ ...base, kind: 'standings', name: '***' }).name).toBe('galaxie-standings');
  });
});
