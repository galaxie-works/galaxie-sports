import { isMap, isScalar, isSeq, parseDocument } from 'yaml';

/**
 * Grava `api_sports.team_id` de um time no texto YAML, trocando só o valor (o resto do arquivo —
 * comentários, aspas, estilo flow/block, indentação — fica byte a byte igual).
 */
export function setTeamIdInYaml(
  source: string,
  slug: string,
  teamId: number,
): { source: string; changed: boolean } {
  const doc = parseDocument(source);
  if (doc.errors.length) throw new Error(`YAML inválido: ${doc.errors[0]!.message}`);
  const teams = isMap(doc.contents) ? doc.contents.get('teams', true) : null;
  if (!isSeq(teams)) throw new Error('arquivo sem lista "teams"');
  const item = teams.items.find((it) => isMap(it) && it.get('slug') === slug);
  if (!isMap(item)) throw new Error(`time ${slug} não encontrado`);
  const api = item.get('api_sports', true);
  if (!isMap(api)) throw new Error(`${slug}: sem bloco api_sports`);
  const node = api.get('team_id', true);
  if (!isScalar(node) || !node.range) throw new Error(`${slug}: api_sports.team_id ausente`);
  if (node.value === teamId) return { source, changed: false };
  const [start, end] = node.range;
  const next = source.slice(0, start) + String(teamId) + source.slice(end);
  // confere que só o valor mudou
  const check = parseDocument(next);
  const value =
    (check.getIn(['teams', teams.items.indexOf(item), 'api_sports', 'team_id']) as unknown) ?? null;
  if (check.errors.length || value !== teamId) throw new Error(`${slug}: falha ao gravar team_id`);
  return { source: next, changed: true };
}
