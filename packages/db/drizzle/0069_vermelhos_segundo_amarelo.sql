-- Vermelhos por segundo amarelo (#828): a api-sports manda, por jogador e temporada, `cards.red` (direto) e
-- `cards.yellowred` (segundo amarelo) separados, e o `red_cards` só guardava o direto. Conferido na produção em
-- 07/11: nas temporadas encerradas, red + yellowred bate com os vermelhos dos lances dos jogos (PR #877).
-- A normalização passa a somar os dois; aqui as linhas já gravadas são refeitas a partir do bruto em `stats`.
-- Idempotente (recalcula do `stats`, nunca soma em cima do valor atual); não mexe em `updated_at`.
UPDATE "core"."person_season_stat"
   SET "red_cards" = coalesce(("stats" -> 'cards' ->> 'red')::int, 0)
                   + coalesce(("stats" -> 'cards' ->> 'yellowred')::int, 0)
 WHERE coalesce(("stats" -> 'cards' ->> 'yellowred')::int, 0) > 0
   AND "red_cards" IS DISTINCT FROM coalesce(("stats" -> 'cards' ->> 'red')::int, 0)
                                  + coalesce(("stats" -> 'cards' ->> 'yellowred')::int, 0);
