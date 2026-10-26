/**
 * Biografias de pilotos de F1 para a base semântica (perfis `draft`, aprovados no painel de revisão), em dois passos:
 *
 * 1. Gerar (VPS, onde a chave do Gemini funciona): pesquisa com fontes e grava as propostas em --saida.
 *      node ../ai-agents/dist/cli/f1-bio.js --plan --saida /data/commons/f1bio   # prévia: quem seria pesquisado
 *      node ../ai-agents/dist/cli/f1-bio.js --saida /data/commons/f1bio          # gera proposals.json + report.md
 *    Pilotos: --pilotos ayrton-senna,alain-prost ou, sem a opção, os do acervo de fotos (config/assets/commons/f1.yaml).
 *    Idempotente: piloto que já tem proposta aceita em --saida não é pesquisado de novo (--refazer pesquisa).
 * 2. Aplicar (dev, para o PR): as propostas viram entradas `draft` em data/knowledge/…/drivers.yaml.
 *      pnpm --filter @galaxie/ai-agents f1:bio --aplicar proposals.json --plan   # prévia: diff, sem gravar
 *      pnpm --filter @galaxie/ai-agents f1:bio --aplicar proposals.json          # grava (aplicar de novo não muda nada)
 *
 * Toda frase precisa de fonte vinda da busca (Gemini: grounding); sem fonte, não entra. Perfil já aprovado nunca
 * é sobrescrito. Nenhum passo grava no banco: o YAML é a fonte do conteúdo e o seed leva o draft ao painel.
 *
 * Perfil editorial (--perfil): bio, estilo, pontos fortes, momentos e rivalidades das lendas; bio curta dos regulares
 * (critério em docs/runbooks/f1-perfil-editorial.md), em pt-BR e es, em data/knowledge/formula-1/editorial/.
 *      node ../ai-agents/dist/cli/f1-bio.js --perfil --escopo lendas --plan --saida /data/commons/f1perfil
 *      node ../ai-agents/dist/cli/f1-bio.js --perfil --escopo lendas --saida /data/commons/f1perfil   # profiles.json
 *      pnpm --filter @galaxie/ai-agents f1:bio --perfil --aplicar profiles.json [--plan]              # no dev
 *    Escopos: `lendas` (campeões e top 20 em vitórias ou em GPs) e `regulares` (vencedor de GP ou 3 temporadas);
 *    --pilotos escolhe à mão (piloto `basic` não tem perfil editorial, só os traços da API).
 */
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { parse } from 'yaml';
import { closeDb } from '@galaxie/db';
import { DEFAULT_KNOWLEDGE_DIR, loadKnowledge } from '@galaxie/knowledge';
import { applyBios, DRIVERS_FILE } from '../f1bio/apply.js';
import { applyProfiles } from '../f1bio/apply-profile.js';
import { driverFacts } from '../f1bio/facts.js';
import { findingCounts, mergeProfiles, proposeProfile, type ProfileProposal } from '../f1bio/profile.js';
import { driverRoster, profileFacts } from '../f1bio/profile-facts.js';
import { mergeProposals, proposeBio, type BioProposal } from '../f1bio/propose.js';
import { bioReport, profileReport } from '../f1bio/report.js';
import { dbFromEnv, intFlag, llmOrNull } from './common.js';

const { values } = parseArgs({
  options: {
    pilotos: { type: 'string' },
    limite: { type: 'string' },
    saida: { type: 'string' },
    aplicar: { type: 'string' },
    plan: { type: 'boolean', default: false },
    refazer: { type: 'boolean', default: false },
    perfil: { type: 'boolean', default: false },
    escopo: { type: 'string' },
  },
  strict: true,
});

const repoRoot = resolve(DEFAULT_KNOWLEDGE_DIR, '..', '..');
/** Pilotos do acervo de fotos (config/assets/commons/f1.yaml), na ordem do manifesto. */
function photoDrivers(): string[] {
  try {
    const m = parse(readFileSync(join(repoRoot, 'config', 'assets', 'commons', 'f1.yaml'), 'utf8')) as {
      entries?: { kind: string; f1db_id: string }[];
    };
    return (m.entries ?? []).filter((e) => e.kind === 'driver').map((e) => e.f1db_id);
  } catch {
    return [];
  }
}

const readProposals = (path: string): BioProposal[] =>
  existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as BioProposal[]) : [];

if (values.perfil) {
  await profileMode();
} else if (values.aplicar) {
  // ─ passo 2: aplicar no YAML (dev) ─
  const proposals = readProposals(resolve(values.aplicar));
  if (!proposals.length) throw new Error(`Nenhuma proposta em ${values.aplicar}.`);
  const kb = await loadKnowledge(DEFAULT_KNOWLEDGE_DIR);
  const changes = await applyBios(kb, proposals);
  console.log(bioReport(proposals, changes));
  if (changes.diff) console.log(`\n${changes.diff}`);
  if (values.plan || !changes.text) {
    console.log(
      values.plan ? '\nPRÉVIA: nada gravado.' : `\nNada a mudar em data/knowledge/${DRIVERS_FILE}.`,
    );
  } else {
    await writeFile(join(DEFAULT_KNOWLEDGE_DIR, DRIVERS_FILE), changes.text);
    console.log(`\nGravado em data/knowledge/${DRIVERS_FILE} (draft; aprove no painel de revisão).`);
  }
} else {
  // ─ passo 1: gerar as propostas (VPS) ─
  if (!values.saida) throw new Error('Defina --saida <pasta> (proposals.json e report.md ficam lá).');
  const out = resolve(values.saida);
  const file = join(out, 'proposals.json');
  const previous = readProposals(file);
  const done = new Set(previous.filter((p) => p.status === 'accepted').map((p) => p.facts.f1dbId));
  const ids = (
    values.pilotos
      ?.split(',')
      .map((s) => s.trim())
      .filter(Boolean) ?? photoDrivers()
  ).slice(0, intFlag(values.limite, 'limite') ?? 100);
  const pending = ids.filter((id) => values.refazer || !done.has(id));
  if (values.plan) {
    console.table(
      ids.map((id) => ({ piloto: id, agora: pending.includes(id) ? 'pesquisar' : 'já tem proposta' })),
    );
    console.log(
      `PRÉVIA (nada chamado, nada gravado): ${pending.length} piloto(s) a pesquisar, 1 chamada de pesquisa ` +
        `com fontes por piloto; propostas em ${file}`,
    );
  } else {
    const db = dbFromEnv();
    try {
      const llm = await llmOrNull(false, db);
      if (!llm)
        throw new Error(
          'Sem LLM configurado (AI_PROVIDER e a chave): a biografia exige pesquisa com fontes.',
        );
      const fresh: BioProposal[] = [];
      for (const f of await driverFacts(db, pending)) {
        try {
          const p = await proposeBio(llm, f);
          fresh.push(p);
          console.log(
            `${f.f1dbId}: ${p.status} · ${p.identity.length} frase(s) com fonte · ${p.dropped.length} descartada(s)`,
          );
        } catch (err) {
          // sem proposta: o piloto volta na próxima execução
          console.log(`${f.f1dbId}: erro (${(err as Error).message})`);
        }
      }
      const proposals = mergeProposals(previous, fresh);
      await mkdir(out, { recursive: true });
      await writeFile(file, JSON.stringify(proposals, null, 2));
      await writeFile(join(out, 'report.md'), bioReport(proposals, null));
      console.log(
        `${fresh.length} proposta(s) nova(s); ${proposals.length} no total em ${file}. ` +
          'Leve o arquivo para o dev e rode f1:bio --aplicar.',
      );
    } finally {
      await closeDb(db);
    }
  }
}

/** Perfil editorial (--perfil): os mesmos dois passos, com profiles.json. */
async function profileMode(): Promise<void> {
  const read = (path: string): ProfileProposal[] =>
    existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as ProfileProposal[]) : [];
  if (values.aplicar) {
    const proposals = read(resolve(values.aplicar));
    if (!proposals.length) throw new Error(`Nenhuma proposta em ${values.aplicar}.`);
    const changes = await applyProfiles(await loadKnowledge(DEFAULT_KNOWLEDGE_DIR), proposals);
    console.log(profileReport(proposals, changes));
    for (const f of changes.files) console.log(`\n${f.diff}`);
    if (values.plan || !changes.files.length) {
      console.log(
        values.plan ? '\nPRÉVIA: nada gravado.' : '\nNada a mudar em data/knowledge/formula-1/editorial.',
      );
      return;
    }
    for (const f of changes.files) {
      await mkdir(join(DEFAULT_KNOWLEDGE_DIR, 'formula-1', 'editorial'), { recursive: true });
      await writeFile(join(DEFAULT_KNOWLEDGE_DIR, f.rel), f.text);
      console.log(`Gravado em data/knowledge/${f.rel} (draft; aprove no painel de revisão).`);
    }
    return;
  }
  if (!values.saida) throw new Error('Defina --saida <pasta> (profiles.json e profiles-report.md ficam lá).');
  const scope = values.escopo;
  if (!values.pilotos && scope !== 'lendas' && scope !== 'regulares')
    throw new Error('Defina --escopo lendas|regulares ou --pilotos <ids do F1DB>.');
  const out = resolve(values.saida);
  const file = join(out, 'profiles.json');
  const previous = read(file);
  const done = new Set(previous.filter((p) => p.status === 'accepted').map((p) => p.f1dbId));
  const db = dbFromEnv();
  try {
    const roster = await driverRoster(db);
    const byId = new Map(roster.map((r) => [r.f1dbId, r]));
    const wanted = values.pilotos
      ? values.pilotos
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : roster.filter((r) => r.tier === (scope === 'lendas' ? 'legend' : 'regular')).map((r) => r.f1dbId);
    const ids = wanted.slice(0, intFlag(values.limite, 'limite') ?? 100);
    const rows = ids.map((id) => {
      const r = byId.get(id);
      const agora = !r
        ? 'fora do F1DB'
        : r.tier === 'basic'
          ? 'só traços (nível basic)'
          : values.refazer || !done.has(id)
            ? 'pesquisar'
            : 'já tem proposta';
      return { piloto: id, nivel: r?.tier ?? '—', vitorias: r?.wins ?? 0, gps: r?.starts ?? 0, agora };
    });
    const pending = rows.filter((r) => r.agora === 'pesquisar').map((r) => r.piloto);
    if (values.plan) {
      console.table(rows);
      console.log(
        `PRÉVIA (nada chamado, nada gravado): ${pending.length} piloto(s) a pesquisar, 1 chamada de pesquisa com ` +
          `fontes e 1 de tradução por piloto; propostas em ${file}`,
      );
      return;
    }
    const llm = await llmOrNull(false, db);
    if (!llm)
      throw new Error('Sem LLM configurado (AI_PROVIDER e a chave): o perfil exige pesquisa com fontes.');
    const fresh: ProfileProposal[] = [];
    for (const base of await driverFacts(db, pending)) {
      try {
        const facts = await profileFacts(db, base, byId.get(base.f1dbId)!.tier);
        const p = await proposeProfile(llm, facts);
        fresh.push(p);
        const pt = p.entries['pt-BR'];
        const n = findingCounts(pt);
        console.log(
          `${base.f1dbId}: ${p.status} · ${pt?.moments?.length ?? 0} momento(s) · ${n.severe} grave(s), ` +
            `${n.alert} alerta(s)${p.entries.es ? ' · es' : ''}${p.reasons.length ? ` · ${p.reasons.join('; ')}` : ''}`,
        );
      } catch (err) {
        // sem proposta: o piloto volta na próxima execução
        console.log(`${base.f1dbId}: erro (${(err as Error).message})`);
      }
    }
    const proposals = mergeProfiles(previous, fresh);
    await mkdir(out, { recursive: true });
    await writeFile(file, JSON.stringify(proposals, null, 2));
    await writeFile(join(out, 'profiles-report.md'), profileReport(proposals, null));
    console.log(
      `${fresh.length} proposta(s) nova(s); ${proposals.length} no total em ${file}. ` +
        'Leve o arquivo para o dev e rode f1:bio --perfil --aplicar.',
    );
  } finally {
    await closeDb(db);
  }
}
