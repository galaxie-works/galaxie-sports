/** Construtores de linhas SPARQL (formato application/sparql-results+json) para testes. */
import type { SparqlBinding, SparqlResponse, SparqlTerm } from './sparql-client.js';

const E = 'http://www.wikidata.org/entity/';

export const uri = (qid: string): SparqlTerm => ({ type: 'uri', value: `${E}${qid}` });
export const stmt = (id: string): SparqlTerm => ({ type: 'uri', value: `${E}statement/${id}` });
export const lit = (value: string | number, lang?: string): SparqlTerm => ({
  type: 'literal',
  value: String(value),
  ...(lang ? { 'xml:lang': lang } : {}),
});
export const date = (d: string): SparqlTerm => ({
  type: 'literal',
  value: `${d}T00:00:00Z`,
  datatype: 'http://www.w3.org/2001/XMLSchema#dateTime',
});
export const NORMAL: SparqlTerm = { type: 'uri', value: 'http://wikiba.se/ontology#NormalRank' };
export const DEPRECATED: SparqlTerm = { type: 'uri', value: 'http://wikiba.se/ontology#DeprecatedRank' };

export const GOLD = 'Q15243387';
export const SILVER = 'Q15889641';
export const BRONZE = 'Q15889643';
export const FINAL = 'Q1366722';
export const SEMI = 'Q599999';

export interface StatementSpec {
  id: string;
  ev: string;
  p: string;
  medal?: string;
  rank?: number;
  stage?: string;
  deprecated?: boolean;
  why?: string;
  ctx?: string;
  ctxCountry?: string;
  ctxSport?: string;
}

export function statementRow(s: StatementSpec): SparqlBinding {
  const b: SparqlBinding = {
    st: stmt(s.id),
    ev: uri(s.ev),
    p: uri(s.p),
    stRank: s.deprecated ? DEPRECATED : NORMAL,
  };
  if (s.medal) b.medal = uri(s.medal);
  if (s.rank !== undefined) b.rank = lit(s.rank);
  if (s.stage) b.stage = uri(s.stage);
  if (s.why) b.why = uri(s.why);
  if (s.ctx) b.ctx = uri(s.ctx);
  if (s.ctxCountry) b.ctxCountry = uri(s.ctxCountry);
  if (s.ctxSport) b.ctxSport = uri(s.ctxSport);
  return b;
}

export function response(bindings: SparqlBinding[]): SparqlResponse {
  const vars = [...new Set(bindings.flatMap((b) => Object.keys(b)))];
  return { head: { vars }, results: { bindings } };
}
