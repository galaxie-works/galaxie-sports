/**
 * Migration que contrai o schema. A troca de versão é lado a lado e o candidato roda o migrate antes da troca:
 * por alguns segundos a versão antiga e a nova usam o mesmo banco, então toda migration precisa servir às duas.
 * Coluna, tabela e índice novos (expandir) servem; remover, renomear, mudar o tipo ou exigir NOT NULL (contrair)
 * quebram a versão antiga e, depois de aplicadas, também a volta do código. Elas só entram num PR próprio com o
 * rótulo `contrair`, depois do deploy que parou de usar o que sai (docs/runbooks/migrations.md).
 *
 * Aqui só a leitura do SQL: `destructiveStatements` devolve o que contrai. Quem decide se o PR pode é o CI
 * (`destructive-migrations-cli.ts`), pelo rótulo.
 *
 * O que conta, de propósito conservador (o rótulo é barato, o schema quebrado em produção não é):
 *  - qualquer `DROP` (tabela, coluna, constraint, índice, tipo, view…), menos `DROP DEFAULT`, `DROP NOT NULL`,
 *    `DROP IDENTITY` e `DROP EXPRESSION`, que só afrouxam a coluna. `DROP INDEX [CONCURRENTLY] [IF EXISTS]` conta
 *    mesmo quando o índice foi trocado por outro: a versão antiga ainda pode depender dele (um índice único é o
 *    alvo do `ON CONFLICT` do código velho). Cria o novo num PR, tira o velho no `contrair` seguinte;
 *  - qualquer `RENAME` (tabela, coluna, constraint, índice, valor de enum);
 *  - `ALTER COLUMN … [SET DATA] TYPE` e `SET NOT NULL`;
 *  - `ADD COLUMN … NOT NULL` sem `DEFAULT` (nem `GENERATED`/`serial`): o INSERT da versão antiga, que não conhece
 *    a coluna, passa a falhar;
 *  - `TRUNCATE`.
 * Comentários, texto entre aspas simples e nomes entre aspas duplas não contam (uma coluna chamada "drop" é só
 * uma coluna). `ADD CONSTRAINT`, `UPDATE`/`DELETE` e `CREATE INDEX` sem CONCURRENTLY também podem estragar a
 * versão antiga, mas dependem do caso; ficam para a revisão (runbook).
 */

export interface DestructiveStatement {
  /** Linha (1-based) onde a declaração destrutiva começa. */
  line: number;
  /** A regra que pegou, ex.: `DROP COLUMN`, `RENAME COLUMN`, `SET NOT NULL`. */
  rule: string;
  /** O trecho do arquivo, numa linha só. */
  excerpt: string;
}

/**
 * O mesmo texto, do mesmo tamanho, sem o que não é código: comentários (`--` e blocos) viram espaço, e o conteúdo
 * de textos `'…'` e de nomes `"…"` vira `_`. Os índices e as linhas batem com o arquivo original.
 */
function mask(text: string): string {
  const blank = (s: string, fill: string) => s.replace(/[^\n]/g, fill);
  let out = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
    if (c === '-' && text[i + 1] === '-') {
      const nl = text.indexOf('\n', i);
      const end = nl === -1 ? text.length : nl;
      out += blank(text.slice(i, end), ' ');
      i = end;
    } else if (c === '/' && text[i + 1] === '*') {
      const close = text.indexOf('*/', i + 2);
      const end = close === -1 ? text.length : close + 2;
      out += blank(text.slice(i, end), ' ');
      i = end;
    } else if (c === "'" || c === '"') {
      // aspas repetidas dentro ('' ou "") escapam a própria aspa
      let close = i + 1;
      while (close < text.length && !(text[close] === c && text[close + 1] !== c))
        close += text[close] === c ? 2 : 1;
      out += c + blank(text.slice(i + 1, close), '_') + (close < text.length ? c : '');
      i = close + 1;
    } else {
      out += c;
      i += 1;
    }
  }
  return out;
}

/** O que vem depois de `from` até a vírgula seguinte fora de parênteses (ou o fim do comando), sem os parênteses. */
function columnDefinition(statement: string, from: number): string {
  let depth = 0;
  let def = '';
  for (let i = from; i < statement.length; i++) {
    const c = statement[i]!;
    if (c === '(') depth += 1;
    else if (c === ')') depth -= 1;
    else if (c === ',' && depth === 0) break;
    else if (depth === 0) def += c;
  }
  return def;
}

const IDENT = String.raw`(?:"[^"]*"|\w+)`;

export function destructiveStatements(text: string): DestructiveStatement[] {
  const masked = mask(text);
  const found: Array<DestructiveStatement & { at: number }> = [];
  const lineAt = (at: number) => masked.slice(0, at).split('\n').length;
  const add = (at: number, rule: string) => {
    const end = masked.indexOf(';', at);
    const excerpt = text
      .slice(at, end === -1 ? undefined : end)
      .replace(/\s+/g, ' ')
      .trim();
    found.push({
      at,
      line: lineAt(at),
      rule,
      excerpt: excerpt.length > 100 ? `${excerpt.slice(0, 100)}…` : excerpt,
    });
  };

  let offset = 0;
  for (const statement of masked.split(';')) {
    for (const m of statement.matchAll(/\bDROP\s+(MATERIALIZED\s+VIEW|\w+|"[^"]*")/gi)) {
      // `DROP "coluna"` (sem a palavra COLUMN) é um DROP COLUMN
      const kind = m[1]!.startsWith('"') ? 'COLUMN' : m[1]!.toUpperCase().replace(/\s+/g, ' ');
      // ALTER COLUMN … DROP DEFAULT / NOT NULL / IDENTITY / EXPRESSION só afrouxa a coluna
      if (['DEFAULT', 'NOT', 'IDENTITY', 'EXPRESSION'].includes(kind)) continue;
      add(offset + m.index, `DROP ${kind}`);
    }
    for (const m of statement.matchAll(/\bRENAME(?:\s+(COLUMN|TO|CONSTRAINT|VALUE|ATTRIBUTE)\b)?/gi)) {
      add(offset + m.index, m[1] ? `RENAME ${m[1].toUpperCase()}` : 'RENAME');
    }
    for (const m of statement.matchAll(
      new RegExp(String.raw`\bALTER\s+(?:COLUMN\s+)?${IDENT}\s+(?:SET\s+DATA\s+)?TYPE\b`, 'gi'),
    )) {
      add(offset + m.index, 'ALTER COLUMN TYPE');
    }
    for (const m of statement.matchAll(/\bSET\s+NOT\s+NULL\b/gi)) add(offset + m.index, 'SET NOT NULL');
    for (const m of statement.matchAll(
      new RegExp(String.raw`\bADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?${IDENT}`, 'gi'),
    )) {
      const def = columnDefinition(statement, m.index + m[0].length);
      if (/\bNOT\s+NULL\b/i.test(def) && !/\b(?:DEFAULT|GENERATED|SERIAL|BIGSERIAL|SMALLSERIAL)\b/i.test(def))
        add(offset + m.index, 'ADD COLUMN NOT NULL sem DEFAULT');
    }
    for (const m of statement.matchAll(/\bTRUNCATE\b/gi)) add(offset + m.index, 'TRUNCATE');
    offset += statement.length + 1;
  }
  return found.sort((a, b) => a.at - b.at).map(({ at: _at, ...rest }) => rest);
}
