/**
 * Quando a foto de perfil aparece para os outros torcedores (#1025). Uma regra só, usada pela API (chat, mural,
 * `publicAvatars`) e pela limpeza da fila (`purgeModeration`), que grava o estado antes de apagar o caso que o
 * sustentava.
 *
 * Aparece quando há foto, o Perfil não foi excluído, o torcedor não escondeu a foto (`visibility.avatar`), nenhum caso
 * da foto a tirou do ar e: a moderação liberou (`visible`), ou a foto estava segurada (`held`) e a equipe já fechou um
 * caso dela sem esconder. `removed` (a equipe tirou do ar e o caso já foi apagado pela retenção) nunca aparece.
 */
import { sql, type SQL } from 'drizzle-orm';
import { fanProfile } from './schema/fan.js';
import { moderationCase } from './schema/moderation.js';

const caseOfAvatar = (extra: SQL) => sql`exists (
  select 1 from ${moderationCase}
  where ${moderationCase.tenantId} = ${fanProfile.tenantId}
    and ${moderationCase.targetType} = 'profile'
    and ${moderationCase.targetId} = ${fanProfile.avatarRef}
    and ${extra}
)`;

/** Condição SQL sobre `fan.profile`: a foto do Perfil pode aparecer para os outros. */
export function fanAvatarPublic(): SQL<boolean> {
  return sql<boolean>`(
    ${fanProfile.avatarUrl} is not null
    and ${fanProfile.deletedAt} is null
    and coalesce(${fanProfile.visibility}->>'avatar', 'public') <> 'private'
    and not ${caseOfAvatar(sql`${moderationCase.hiddenAt} is not null`)}
    and (
      ${fanProfile.avatarStatus} = 'visible'
      or (${fanProfile.avatarStatus} = 'held' and ${caseOfAvatar(sql`${moderationCase.status} <> 'open'`)})
    )
  )`;
}

/** A URL da foto quando ela pode aparecer para os outros; null quando não. */
export function fanAvatarPublicUrl(): SQL<string | null> {
  return sql<string | null>`case when ${fanAvatarPublic()} then ${fanProfile.avatarUrl} end`;
}

/**
 * Antes de a retenção apagar casos fechados de foto de perfil, grava no Perfil o que eles decidiam: a foto que aparecia
 * fica `visible`; a que um caso tirou do ar fica `removed`. Sem isso, a foto liberada pela equipe sumiria (ou a tirada
 * do ar voltaria) quando o caso sai do banco.
 */
export const settleAvatarsBeforePurge = (purgeable: SQL) => sql`
  update ${fanProfile} set ${sql.identifier('avatar_status')} = case
      when ${fanAvatarPublic()} then 'visible'
      when ${caseOfAvatar(sql`${moderationCase.hiddenAt} is not null`)} then 'removed'
      else ${fanProfile.avatarStatus}
    end
  where ${fanProfile.avatarRef} is not null
    and ${fanProfile.avatarStatus} in ('visible', 'held')
    and ${caseOfAvatar(purgeable)}`;
