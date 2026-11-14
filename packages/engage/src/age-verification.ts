/**
 * Verificação de idade feita pela Galaxie (#1109, módulo `age_verification`): o que não depende de HTTP, banco nem
 * `node:crypto`, para a demo poder importar. O cliente HTTP do provedor e a conferência da assinatura do webhook ficam
 * na API (`apps/api/src/age-verification`).
 *
 * Fluxo adaptativo (o workflow "Adaptive Age Verification" do Didit): estimativa pelo rosto com prova de vida; quem
 * cai na zona de dúvida perto do limite passa pelo documento, e o rosto do documento é comparado com a selfie. O
 * workflow no console do provedor tem idade mínima 18 em todos os países: aprovada = adulto comprovado.
 *
 * Daqui sai só a faixa. Nunca a data de nascimento, a idade estimada, imagem ou documento.
 */
import type { FanAgeBandDetail } from './fan-age.js';

export const AGE_VERIFICATION_PROVIDER_NAMES = ['didit'] as const;
export type AgeVerificationProviderName = (typeof AGE_VERIFICATION_PROVIDER_NAMES)[number];

/** Estado da sessão do lado da Galaxie (espelho de `fan.age_verification.status`). */
export type AgeCheckStatus = 'pending' | 'approved' | 'declined' | 'review' | 'abandoned' | 'expired';
/** Por onde a decisão saiu (define a cobrança). */
export type AgeCheckPath = 'estimate' | 'document';

/** Idade mínima configurada no workflow do provedor: aprovada comprova `18plus`. */
export const AGE_CHECK_MIN_AGE = 18;

/** Estados do Didit (`status` da sessão e do webhook) → o nosso. Desconhecido = pendente (nunca libera). */
const DIDIT_STATUS: Record<string, AgeCheckStatus> = {
  Approved: 'approved',
  Declined: 'declined',
  'In Review': 'review',
  Abandoned: 'abandoned',
  Expired: 'expired',
  'Kyc Expired': 'expired',
  'Not Started': 'pending',
  'In Progress': 'pending',
  Resubmitted: 'pending',
  'Awaiting User': 'pending',
};

export function diditStatus(raw: unknown): AgeCheckStatus {
  return (typeof raw === 'string' && DIDIT_STATUS[raw]) || 'pending';
}

/** O pedaço da decisão do Didit (`GET /v3/session/{id}/decision/`) que a Galaxie lê. */
export interface DiditDecision {
  session_id?: string;
  status?: string;
  workflow_id?: string;
  id_verifications?: Array<{ status?: string; date_of_birth?: string | null }> | null;
  liveness_checks?: Array<{ status?: string; age_estimation?: number | null }> | null;
  face_matches?: Array<{ status?: string }> | null;
}

/** O que a decisão comprova, já sem dado pessoal. */
export interface AgeCheckOutcome {
  status: AgeCheckStatus;
  /** null = o torcedor não chegou a fazer nada cobrável. */
  path: AgeCheckPath | null;
  /** Faixa comprovada. Só aprovada libera; recusada com documento lido também traz a faixa (para o Perfil decidir). */
  band: FanAgeBandDetail | null;
  /** Comprovação que a faixa ganha no Perfil. */
  method: 'estimated' | 'verified' | null;
  /** O provedor cobra esta sessão (decidida, mesmo recusada ou em revisão). */
  billable: boolean;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** O fuso mais a oeste (UTC-12): o aniversário só conta quando já chegou em qualquer lugar do mundo. */
const LATEST_TZ_MS = 12 * 3_600_000;

/**
 * Idade completa em `now` de quem nasceu em `dob` (`AAAA-MM-DD`); null se a data não vale. Conta pelo fuso mais a
 * oeste: quem faz 18 amanhã não vira adulto à noite no Brasil porque já é amanhã em UTC.
 */
export function ageOn(dob: string, at: Date): number | null {
  const now = new Date(at.getTime() - LATEST_TZ_MS);
  const m = ISO_DATE.exec(dob);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const born = new Date(Date.UTC(y, mo - 1, d));
  if (born.getUTCFullYear() !== y || born.getUTCMonth() !== mo - 1 || born.getUTCDate() !== d) return null;
  if (born.getTime() > now.getTime()) return null;
  let age = now.getUTCFullYear() - y;
  const beforeBirthday = now.getUTCMonth() < mo - 1 || (now.getUTCMonth() === mo - 1 && now.getUTCDate() < d);
  if (beforeBirthday) age -= 1;
  return age > 130 ? null : age;
}

/** Faixa fina de uma idade. */
export function bandForAge(age: number): FanAgeBandDetail {
  if (age < 13) return 'under13';
  if (age === 13) return '13';
  if (age < 16) return '14_15';
  if (age < 18) return '16_17';
  return '18plus';
}

/**
 * Lê a decisão do Didit. Documento aprovado com data de nascimento válida = `verified` com a faixa da data; sem
 * documento, aprovada pela estimativa = `estimated` e `18plus`, mas só com a prova de vida aprovada e a idade
 * estimada no mínimo (uma aprovação manual no console do provedor não basta). Decisão de outro workflow ou qualquer
 * outra coisa não comprova nada: volta como `review`.
 */
export function diditOutcome(
  decision: DiditDecision,
  opts: { workflowId?: string; now?: Date } = {},
): AgeCheckOutcome {
  const now = opts.now ?? new Date();
  const raw = diditStatus(decision.status);
  // workflow diferente do configurado (teste, KYC sem limite de idade): não vale como verificação de idade
  const foreign = !!opts.workflowId && !!decision.workflow_id && decision.workflow_id !== opts.workflowId;
  const status: AgeCheckStatus = foreign && raw === 'approved' ? 'review' : raw;
  const ids = decision.id_verifications ?? [];
  const lives = decision.liveness_checks ?? [];
  const faces = decision.face_matches ?? [];
  const path: AgeCheckPath | null =
    ids.length > 0 || faces.length > 0 ? 'document' : lives.length > 0 ? 'estimate' : null;
  const billable = path !== null && (status === 'approved' || status === 'declined' || status === 'review');

  // a data do documento conta só com o documento aprovado
  const doc = ids.find((v) => v.status === 'Approved' && typeof v.date_of_birth === 'string');
  const docAge = doc?.date_of_birth ? ageOn(doc.date_of_birth, now) : null;

  if (status === 'approved') {
    if (path === 'document') {
      // aprovada sem data legível ou abaixo do mínimo é incoerente: não comprova nada
      if (docAge === null || docAge < AGE_CHECK_MIN_AGE)
        return { status: 'review', path, band: null, method: null, billable };
      return { status, path, band: bandForAge(docAge), method: 'verified', billable };
    }
    if (path === 'estimate') {
      const adult = lives.some(
        (l) =>
          l.status === 'Approved' &&
          typeof l.age_estimation === 'number' &&
          Number.isFinite(l.age_estimation) &&
          l.age_estimation >= AGE_CHECK_MIN_AGE,
      );
      if (!adult) return { status: 'review', path, band: null, method: null, billable };
      return { status, path, band: '18plus', method: 'estimated', billable };
    }
    return { status: 'review', path, band: null, method: null, billable };
  }
  // recusada pelo documento: a faixa de menor fica comprovada (o Perfil decide o que fazer com ela)
  // (o Didit pode marcar o próprio documento como recusado por idade; aí não há data e nada é comprovado)
  if (status === 'declined' && !foreign && docAge !== null && docAge < AGE_CHECK_MIN_AGE)
    return { status, path, band: bandForAge(docAge), method: 'verified', billable };
  return { status, path, band: null, method: null, billable };
}

/**
 * JSON canônico do Didit para a assinatura `X-Signature-V2`: chaves em ordem, sem espaços, Unicode como está e
 * número inteiro sem casa decimal (o `JSON.stringify` já escreve `1.0` como `1`). Diferenças conhecidas do `json.dumps`
 * do Python: expoente de float pequeno (`1e-7` × `1e-07`) e inteiro acima de 2^53. Nesses casos a V2 não confere e o
 * webhook é recusado (falha segura); a `X-Signature` dos bytes crus continua valendo.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value))
    return `[${value.map((v) => canonicalJson(v === undefined ? null : v)).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
}
