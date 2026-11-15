/**
 * Portão de idade no servidor (#1106): toda rota do torcedor declara em `config.age` a capacidade que usa, e o hook
 * do token (`fan-auth.ts`) chama o portão antes do handler. Rota com `config.fan` sem `config.age` nem sobe.
 *
 * O portão relê o Perfil e a ficha do país do token a cada ação, com um cache de poucos segundos por processo: a
 * revogação da autorização, a mudança da ficha e a faixa congelada valem na próxima ação, sem esperar o token
 * vencer. O pedido de token (`POST /v1/fans/tokens`) e a exclusão limpam o cache do Perfil neste processo; nos
 * outros, o prazo do cache é o teto (5 segundos, bem abaixo do 1 minuto do #1106).
 *
 * País: vale o do token (o que o servidor do cliente informou), nunca o do IP. O torcedor que viaja continua na
 * ficha do país dele.
 */
import { fanProfile, type Database } from '@galaxie/db';
import { ageGate, type AgeCapability, type AgeGateResult, type FanAgeFacts } from '@galaxie/engage';
import type { CountryPolicy } from '@galaxie/engage';
import { and, eq, isNull } from 'drizzle-orm';
import type { FanTokenClaims } from './fan-token.js';
import { profileAgeFacts } from './fans.js';
import { policyForFan } from './moderation-routes.js';

/** Prazo do cache do Perfil e da ficha (ms). A revogação chega aos outros processos neste prazo. */
export const AGE_GATE_CACHE_MS = 5_000;
const MAX_ENTRIES = 50_000;

export interface AgeGateDenial {
  reason: AgeGateResult['reason'];
  capability: AgeCapability;
  country: string;
}

export interface FanAgeGateOptions {
  cacheMs?: number;
  now?: () => number;
  /** Cada recusa, sem identificar o torcedor: métrica por motivo, capacidade e país. */
  onDenied?: (d: AgeGateDenial) => void;
}

/** Perfil excluído ou inexistente: o hook responde como token inválido. */
export class AgeGateProfileGone extends Error {
  constructor() {
    super('Perfil excluído.');
    this.name = 'AgeGateProfileGone';
  }
}

interface Cached<T> {
  value: T;
  at: number;
}

export class FanAgeGate {
  private readonly profiles = new Map<string, Cached<FanAgeFacts | null>>();
  private readonly policies = new Map<string, Cached<CountryPolicy | null>>();
  /** Quando cada Perfil foi limpo: leitura iniciada antes disso não entra no cache. */
  private readonly invalidated = new Map<string, number>();
  private readonly cacheMs: number;
  private readonly now: () => number;

  constructor(
    private readonly db: Database,
    private readonly options: FanAgeGateOptions = {},
  ) {
    this.cacheMs = options.cacheMs ?? AGE_GATE_CACHE_MS;
    this.now = options.now ?? Date.now;
  }

  /** O Perfil mudou neste processo (token pedido de novo, exclusão): a próxima ação relê. */
  invalidate(tenantId: string, profileId: string): void {
    const key = `${tenantId}:${profileId}`;
    this.profiles.delete(key);
    // leitura que começou antes da limpeza (e pode ter visto a linha antiga) não volta para o cache
    if (this.invalidated.size >= MAX_ENTRIES) this.invalidated.clear();
    this.invalidated.set(key, this.now());
  }

  async check(fan: Pick<FanTokenClaims, 'tenantId' | 'profileId' | 'country'>, capability: AgeCapability) {
    const [facts, policy] = await Promise.all([
      this.cached(this.profiles, `${fan.tenantId}:${fan.profileId}`, () =>
        this.readFacts(fan.tenantId, fan.profileId),
      ),
      this.cached(this.policies, `${fan.tenantId}:${fan.country}`, () =>
        policyForFan(this.db, fan.tenantId, fan.country),
      ),
    ]);
    if (!facts) throw new AgeGateProfileGone();
    const result = ageGate({ policy, fan: facts, capability });
    if (!result.allowed) this.denied({ reason: result.reason, capability, country: fan.country });
    return result;
  }

  /** Conta a recusa na métrica (também as que o hook decide sem o banco, como o menor de 13 no token). */
  denied(d: AgeGateDenial): void {
    this.options.onDenied?.(d);
  }

  private async cached<T>(map: Map<string, Cached<T>>, key: string, load: () => Promise<T>): Promise<T> {
    const now = this.now();
    const hit = map.get(key);
    if (hit && now - hit.at < this.cacheMs) return hit.value;
    const value = await load();
    const cleared = map === this.profiles ? this.invalidated.get(key) : undefined;
    if (cleared !== undefined && cleared >= now) return value;
    if (map.size >= MAX_ENTRIES) map.clear();
    map.set(key, { value, at: now });
    return value;
  }

  private async readFacts(tenantId: string, profileId: string): Promise<FanAgeFacts | null> {
    const [row] = await this.db
      .select({
        ageBand: fanProfile.ageBand,
        ageBandDetail: fanProfile.ageBandDetail,
        ageAssurance: fanProfile.ageAssurance,
        guardianStatus: fanProfile.guardianStatus,
        guardianLinked: fanProfile.guardianLinked,
        ageFrozenAt: fanProfile.ageFrozenAt,
      })
      .from(fanProfile)
      .where(
        and(eq(fanProfile.tenantId, tenantId), eq(fanProfile.id, profileId), isNull(fanProfile.deletedAt)),
      )
      .limit(1);
    return row ? profileAgeFacts(row) : null;
  }
}
