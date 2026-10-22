/**
 * Nenhum texto de interface escrito direto no código: tudo passa pelos dicionários (`lib/i18n/messages`).
 * Varredura simples do fonte (não é um parser): texto entre tags JSX, atributos de texto visível com
 * valor literal e strings com letras do português (ã, ç, é…) fora de comentários. Os componentes gerados
 * pelo shadcn/ReUI ficam de fora.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..', '..');

const IGNORED_DIRS = /^components\/(ui|reui|animate-ui|smoothui|examples)\/|^lib\/i18n\/messages\//;

/** Marca e nomes próprios que são iguais em todos os idiomas. */
const ALLOWED = new Set([
  'Galaxie Sports',
  'Galaxie Works',
  'Galactical Sports XP',
  // nome de cada idioma no próprio idioma (seletor de idioma)
  'Português (Brasil)',
]);

/** Linhas que não são interface: logs, erros internos e os tipos da trilha (identificadores). */
const IGNORED_LINE = /console\.(info|warn|error|log)|new Error\(|\bkind[=:]\s*['"{]|^\s*\|\s*'/;

const USER_FACING_ATTR =
  /\b(title|placeholder|aria-label|alt|label|description|tooltip|subtitle)="([^"]*[A-Za-zÀ-ú]{2,}[^"]*)"/g;
const JSX_TEXT = /(?<![=-])>([^<>{}=;()&|?:]*[A-Za-zÀ-ú]{3,}[^<>{}=;()&|?:]*)</g;
const PORTUGUESE_STRING = /(['"`])((?:(?!\1)[^\\\n]|\\.)*[ãõçâêôáéíóúÃÕÇÁÉÍÓÚ](?:(?!\1)[^\\\n]|\\.)*)\1/g;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    const rel = relative(SRC, path).replace(/\\/g, '/');
    if (!/\.tsx?$/.test(rel) || /\.test\.tsx?$/.test(rel) || IGNORED_DIRS.test(rel)) return [];
    return [path];
  });
}

/** HTTP: "404 Not Found", "403 MODULE_NOT_IN_PLAN" (protocolo, igual em todos os idiomas). */
const HTTP_STATUS = /^\d{3}( [A-Za-z_ ]+)?$/;

/**
 * Troca comentários e strings de várias linhas (exemplos de JSON e de código nas docs, com dados reais
 * da API) por espaços, mantendo as linhas no lugar.
 */
const stripComments = (code: string) =>
  code
    .replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '))
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, (c) => c.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1')
    .replace(/`[^`]*\n[^`]*`/g, (c) => c.replace(/[^\n]/g, ' '));

function findHardcoded(path: string): string[] {
  const rel = relative(SRC, path).replace(/\\/g, '/');
  const lines = stripComments(readFileSync(path, 'utf8')).split('\n');
  const tsx = rel.endsWith('.tsx');
  const found: string[] = [];
  lines.forEach((line, i) => {
    if (IGNORED_LINE.test(line)) return;
    const texts = [
      ...(tsx ? [...line.matchAll(JSX_TEXT)].map((m) => m[1]!.trim()) : []),
      ...(tsx ? [...line.matchAll(USER_FACING_ATTR)].map((m) => m[2]!) : []),
      ...[...line.matchAll(PORTUGUESE_STRING)].map((m) => m[2]!),
    ];
    for (const text of new Set(texts))
      if (!ALLOWED.has(text) && !HTTP_STATUS.test(text)) found.push(`${rel}:${i + 1}  ${text}`);
  });
  return found;
}

describe('textos de interface', () => {
  it('vêm dos dicionários, não do código', () => {
    const files = [join(SRC, 'app'), join(SRC, 'components'), join(SRC, 'lib')].flatMap(sourceFiles);
    expect(files.length).toBeGreaterThan(30);
    expect(files.flatMap(findHardcoded)).toEqual([]);
  });
});
