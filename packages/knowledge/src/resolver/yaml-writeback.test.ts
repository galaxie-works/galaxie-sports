import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { setTeamIdInYaml } from './yaml-writeback.js';

const source = `# comentário do arquivo
schema_version: 1
country: BR
teams:
  # ---- bloco
  - slug: santa-cruz
    names: { official: Santa Cruz Futebol Clube, short: "Santa Cruz" }
    api_sports:
      team_id: null   # resolver depois
      match: { name: "Santa Cruz", country: "Brazil" }
  - slug: nautico
    api_sports: {team_id: null, match: {name: Nautico Recife, country: Brazil}}
`;

describe('setTeamIdInYaml', () => {
  it('troca só o valor, preservando comentários, aspas e estilo', () => {
    const out = setTeamIdInYaml(source, 'santa-cruz', 753);
    expect(out.changed).toBe(true);
    expect(out.source).toBe(
      source.replace('team_id: null   # resolver depois', 'team_id: 753   # resolver depois'),
    );
  });

  it('funciona em mapa flow', () => {
    const out = setTeamIdInYaml(source, 'nautico', 755);
    expect(out.source).toContain(
      'api_sports: {team_id: 755, match: {name: Nautico Recife, country: Brazil}}',
    );
    expect(parse(out.source).teams[1].api_sports.team_id).toBe(755);
  });

  it('não muda nada se o valor já está lá; falha para slug inexistente', () => {
    const once = setTeamIdInYaml(source, 'santa-cruz', 753).source;
    expect(setTeamIdInYaml(once, 'santa-cruz', 753)).toEqual({ source: once, changed: false });
    expect(() => setTeamIdInYaml(source, 'nao-existe', 1)).toThrow(/não encontrado/);
  });
});
