/**
 * Consultas SPARQL ao Wikidata (CC0). Modelo usado pelo Wikidata para medalhas:
 *   - prova (ex.: Q25397537 "athletics at the 2016 Summer Olympics – men's 100 metres") com
 *     P361+ (parte de) → edição dos Jogos;
 *   - participação: P710 (participante) na prova ou P1344 (participou de) no atleta, com qualificadores
 *     P166 (medalha recebida), P1352 (classificação) e P2443 (fase alcançada: eliminatória, semi, final);
 *   - delegação (ex.: "Brazil at the 2016 Summer Olympics") com P166 + P1114 (quantidade) — só para QA.
 */

const qidRe = /^Q\d+$/;

function values(qids: string[]): string {
  for (const q of qids) if (!qidRe.test(q)) throw new Error(`QID inválido: ${q}`);
  return qids.map((q) => `wd:${q}`).join(' ');
}

/** Declarações de participação com medalha ou classificação 1–3 nas provas de uma edição. */
export function medalStatementsQuery(gamesQid: string, limit: number, offset: number): string {
  values([gamesQid]);
  return `SELECT ?st ?ev ?p ?medal ?rank ?stage ?stRank ?why ?ctx ?ctxCountry ?ctxSport ?end WHERE {
  ?ev wdt:P361+ wd:${gamesQid} .
  { ?ev p:P710 ?st . ?st ps:P710 ?p . } UNION { ?p p:P1344 ?st . ?st ps:P1344 ?ev . }
  ?st wikibase:rank ?stRank .
  OPTIONAL { ?st pq:P166 ?medal }
  OPTIONAL { ?st pq:P1352 ?rank }
  FILTER(BOUND(?medal) || (BOUND(?rank) && ?rank >= 1 && ?rank <= 3))
  OPTIONAL { ?st pq:P2443 ?stage }
  OPTIONAL { ?st pq:P2241 ?why }
  OPTIONAL { ?st pq:P582 ?end }
  OPTIONAL { ?st pq:P54 ?ctx . OPTIONAL { ?ctx wdt:P17 ?ctxCountry } }
  OPTIONAL { ?st pq:P1532 ?ctxSport }
}
ORDER BY ?st ?medal ?rank ?stage ?ctx ?ctxCountry ?ctxSport
LIMIT ${limit} OFFSET ${offset}`;
}

/** Metadados das provas: classes, esporte, prova-mãe, data e rótulos en/pt/es. */
export function eventsQuery(qids: string[]): string {
  return `SELECT ?ev ?cls ?sportLabel ?parentLabel ?date ?start ?endDate ?lblEn ?lblPt ?lblEs WHERE {
  VALUES ?ev { ${values(qids)} }
  OPTIONAL { ?ev wdt:P31 ?cls }
  OPTIONAL { ?ev wdt:P641 ?sport . ?sport rdfs:label ?sportLabel . FILTER(LANG(?sportLabel) = "en") }
  OPTIONAL { ?ev wdt:P361 ?parent . ?parent rdfs:label ?parentLabel . FILTER(LANG(?parentLabel) = "en") }
  OPTIONAL { ?ev wdt:P585 ?date }
  OPTIONAL { ?ev wdt:P580 ?start }
  OPTIONAL { ?ev wdt:P582 ?endDate }
  OPTIONAL { ?ev rdfs:label ?lblEn . FILTER(LANG(?lblEn) = "en") }
  OPTIONAL { ?ev rdfs:label ?lblPt . FILTER(LANG(?lblPt) = "pt-br" || LANG(?lblPt) = "pt") }
  OPTIONAL { ?ev rdfs:label ?lblEs . FILTER(LANG(?lblEs) = "es") }
}`;
}

/** Metadados de atletas/equipes: tipo, gênero, nascimento, país esportivo (com período), cidadania, IDs. */
export function participantsQuery(qids: string[]): string {
  return `SELECT ?p ?type ?gender ?birth ?cfs ?cfsStart ?cfsEnd ?cit ?country ?olympedia ?lblEn ?lblPt ?lblEs WHERE {
  VALUES ?p { ${values(qids)} }
  OPTIONAL { ?p wdt:P31 ?type }
  OPTIONAL { ?p wdt:P21 ?gender }
  OPTIONAL { ?p wdt:P569 ?birth }
  OPTIONAL { ?p p:P1532 ?cs . ?cs ps:P1532 ?cfs . OPTIONAL { ?cs pq:P580 ?cfsStart } OPTIONAL { ?cs pq:P582 ?cfsEnd } }
  OPTIONAL { ?p wdt:P27 ?cit }
  OPTIONAL { ?p wdt:P17 ?country }
  OPTIONAL { ?p wdt:P8286 ?olympedia }
  OPTIONAL { ?p rdfs:label ?lblEn . FILTER(LANG(?lblEn) = "en") }
  OPTIONAL { ?p rdfs:label ?lblPt . FILTER(LANG(?lblPt) = "pt-br" || LANG(?lblPt) = "pt") }
  OPTIONAL { ?p rdfs:label ?lblEs . FILTER(LANG(?lblEs) = "es") }
}`;
}

/** Itens com código COI (P984): países, CONs e equipes especiais/históricas. */
export function iocCodesQuery(): string {
  return `SELECT ?item ?code WHERE { ?item wdt:P984 ?code . } ORDER BY ?item ?code`;
}

/** Rótulos em inglês dos itens de medalha encontrados (para mapear ouro/prata/bronze). */
export function labelsQuery(qids: string[]): string {
  return `SELECT ?item ?lbl WHERE {
  VALUES ?item { ${values(qids)} }
  ?item rdfs:label ?lbl . FILTER(LANG(?lbl) = "en")
}`;
}

/** Agregados de medalhas por delegação (P166 + P1114) — referência de QA, nunca alimenta o quadro. */
export function delegationAggregatesQuery(gamesQid: string): string {
  values([gamesQid]);
  return `SELECT ?d ?country ?medal ?qty WHERE {
  ?d wdt:P1344 wd:${gamesQid} ; p:P166 ?s .
  ?s ps:P166 ?medal ; pq:P1114 ?qty .
  OPTIONAL { ?d wdt:P17 ?country }
}
ORDER BY ?d ?medal`;
}
