/**
 * Fixtures do teste do AI Studio de 24/10 (BR e AR, com grounding), em `test/fixtures/lineups/`: a
 * resposta no formato do AI Studio, com as plataformas trocadas por nomes e domínios neutros, e o mapa
 * dos redirecionamentos do grounding para a URL final (lido do `Location` no dia do teste). Só para
 * testes: converte a resposta no que o validador recebe.
 */
import { readFileSync } from 'node:fs';
import type { ModelPlan } from '../lineups/validate.js';

interface AiStudioPlan {
  plano_nome_comercial: string;
  preco_mensal: number | null;
  moeda_iso: string | null;
  link_oficial_marca_url: string | null;
  fonte_url: string | null;
  trecho_da_fonte: string | null;
  streamings_e_parceiros_inclusos: {
    streaming_id: string;
    streaming_fonte_url: string | null;
    streaming_trecho_da_fonte: string | null;
  }[];
  grade_canais_esporte_lineares: {
    canal_nome: string;
    canal_fonte_url: string | null;
    canal_trecho_da_fonte: string | null;
  }[];
}

export interface AiStudioOutput {
  mercados_latam: {
    pais_iso: string;
    provedores_ott_detectados: {
      provedor_id: string;
      provedor_nome_comercial: string;
      planos_comerciais: AiStudioPlan[];
    }[];
  }[];
}

const dir = new URL('../../test/fixtures/lineups/', import.meta.url);

export function readAiStudio(country: 'br' | 'ar'): AiStudioOutput {
  return JSON.parse(readFileSync(new URL(`ai-studio-${country}.json`, dir), 'utf8')) as AiStudioOutput;
}

/** Redirecionamento do grounding → URL final, como o GET sem seguir o redirecionamento devolveu. */
export function aiStudioRedirects(): Map<string, string | null> {
  const raw = JSON.parse(readFileSync(new URL('ai-studio-redirects.json', dir), 'utf8')) as Record<
    string,
    string | null
  >;
  return new Map(Object.entries(raw));
}

/** Planos de uma plataforma da resposta do AI Studio, no formato do validador. */
export function aiStudioPlans(out: AiStudioOutput, providerId: string): ModelPlan[] {
  const provider = out.mercados_latam
    .flatMap((m) => m.provedores_ott_detectados)
    .find((p) => p.provedor_id === providerId);
  if (!provider) throw new Error(`plataforma ${providerId} fora da fixture`);
  return provider.planos_comerciais.map((p) => ({
    name: p.plano_nome_comercial,
    priceAmount: p.preco_mensal,
    currency: p.moeda_iso,
    planUrl: null,
    evidence: { url: p.fonte_url, excerpt: p.trecho_da_fonte },
    channels: p.grade_canais_esporte_lineares.map((c) => ({
      name: c.canal_nome,
      evidence: { url: c.canal_fonte_url, excerpt: c.canal_trecho_da_fonte },
    })),
    services: p.streamings_e_parceiros_inclusos.map((s) => ({
      name: s.streaming_id,
      evidence: { url: s.streaming_fonte_url, excerpt: s.streaming_trecho_da_fonte },
    })),
  }));
}
