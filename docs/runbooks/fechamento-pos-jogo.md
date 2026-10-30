# Fechamento pós-jogo (jogos sem ao vivo)

O ao vivo acompanha só o futebol das ligas do plano (`LIVE_MIN_PRIORITY`). Os outros esportes e o resto do futebol
recebiam o placar final só na agenda D-1 do `sync-daily` (00:05 UTC). Até lá, o relógio dos eventos marcava o
jogo como em andamento e depois como encerrado, sem placar (`status_source = temporal`).

O job `postgame-close` fecha esses jogos no mesmo dia. Ele roda a cada minuto. Quando um esporte tem jogo pendente,
busca de novo a lista do dia do fornecedor. É a mesma da agenda diária: `games?date=`, `fights?date=` ou, no
futebol, `fixtures?date=`. Uma chamada traz todas as ligas da data. Placar e status vão para o core pelo
`normalizeAfterFetch`, e o change feed avisa a API e o SSE.

Um jogo está pendente quando:

- começou nas últimas 24 h;
- o fim ainda não foi confirmado pelo fornecedor: está em andamento, ou está `finished` só pelo relógio.

No futebol, contam só as ligas abaixo de `LIVE_MIN_PRIORITY`. As de cima ficam com o ao vivo e com a reconciliação.

## Painel (Ajustes → Operação → Ao vivo)

| Flag | O que faz | Padrão |
|---|---|---|
| `POSTGAME_<ESPORTE>` | `fechamento`: confere a partir do fim previsto (`ends_at_expected`). `tempo-real`: desde o apito. `off`: só a agenda D-1 | `fechamento` |
| `POSTGAME_<ESPORTE>_MIN` | Minutos entre uma consulta e outra da lista do dia (1 a 180). Use 1 ou 2 com `tempo-real` | `15` |
| `POSTGAME_MAX_CALLS_DAY` | Teto de chamadas do pós-jogo por esporte e dia UTC, além da agenda diária | `40` |

Esportes: futebol, AFL, beisebol, basquete, handebol, hóquei, MMA, NBA, futebol americano, rúgbi e vôlei. A Fórmula 1
tem pipeline próprio e fica de fora. As mudanças valem na próxima execução, ou seja, no minuto seguinte.

## Cota

- Cada consulta gasta 1 chamada da API do esporte, na fatia ADHOC do Governor, que respeita a reserva do ao vivo.
- Nos planos free (100/dia), a agenda diária usa 3. Com o teto padrão de 40, sobra folga.
- `tempo-real` com 1 min durante um jogo de 2 h gasta umas 120 chamadas: só caberia num plano pago.
- No teto do dia, o esporte para e o resto fica para a agenda D-1. O log avisa (`teto de chamadas do dia atingido`).
- Cada esporte roda na sua execução: a cota negada de um não segura os outros. O esporte negado fica 1 h em espera
  (`postgame:hold`), sem chamar nem registrar execução.
- No modo `fechamento`, uma data que não fecha depois de 12 buscas fica para a agenda D-1 (`postgame:tries`). Isso
  acontece quando o fornecedor nunca encerra o jogo. No `tempo-real` o limite é só o teto do dia.

## Operar

```bash
pnpm --filter @galaxie/ingestor postgame:close --plan    # pendentes e o que está na vez (nada é chamado)
pnpm --filter @galaxie/ingestor postgame:close --forcar  # busca todas as datas pendentes agora (respeita o teto)
```

Na VPS: `docker compose exec -T ingestor node dist/cli/postgame-close.js --plan`. Cursores em `ops.sync_cursor`:
`postgame:list` (última busca por esporte e data) e `postgame:cap` (chamadas do dia por esporte).
