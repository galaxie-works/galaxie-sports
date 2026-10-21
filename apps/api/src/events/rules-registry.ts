import type { CompetitionRules } from '@galaxie/rules';
import { loadCompetitionRules, RulesConfigError } from '@galaxie/rules/config';

/**
 * Regulamentos (`config/rules/<slug>.yaml`) em cache por competição × temporada. Só competições com
 * arquivo próprio entram: sem regulamento verificado, a API não afirma o que está em jogo.
 */
export class RulesRegistry {
  private readonly cache = new Map<string, Promise<CompetitionRules | null>>();

  constructor(private readonly dir?: string) {}

  get(slug: string, season: number | null | undefined): Promise<CompetitionRules | null> {
    const key = `${slug}|${season ?? ''}`;
    let hit = this.cache.get(key);
    if (!hit) {
      hit = loadCompetitionRules(slug, {
        ...(this.dir ? { dir: this.dir } : {}),
        ...(season ? { season } : {}),
      }).catch((err: unknown) => {
        if (err instanceof RulesConfigError) return null;
        throw err;
      });
      this.cache.set(key, hit);
    }
    return hit;
  }
}
