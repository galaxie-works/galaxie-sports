# F1DB: histórico da Fórmula 1 (segunda fonte da F1)

O [F1DB](https://github.com/f1db/f1db) cobre todas as temporadas de 1950 até hoje. A licença é **CC BY 4.0**: o uso
comercial é permitido, com atribuição. A importação lê o release SQLite fixado no código, grava as tabelas no raw store
e normaliza no core como segunda fonte da F1, ao lado da api-sports. Estudo e decisão:
[research/f1-jolpica.md](../research/f1-jolpica.md) §6.

## O que entra

| Dado | Destino | Observação |
|---|---|---|
| Temporadas 1950–hoje | `core.season` do campeonato `formula-1-world-championship` | As de 2012 em diante já vinham do catálogo da api-sports |
| GP | `core.stage` (`race_weekend`) | Se o mesmo GP já veio da api-sports, usa o rótulo dela (`grand-prix-<id>`); senão, `gp-<id do F1DB>` |
| Sessões com resultado: TL1–4, classificação, classificação da sprint, sprint, corrida | `core.event` + `core.sport_event_detail` (provider `f1db`) | Antes de 2024 o release não tem horário: dia e hora são **estimados** (`summary.time_estimated`) |
| Pilotos no grid, posição e resultado (tempo, diferença, voltas, largada, paradas, pontos, equipe) | `core.event_participant` | Mesmo formato da api-sports, então a API lê sem mudar o contrato |
| Grid de largada, pit stops (1994+, completo desde 2003) e voltas mais rápidas | `sport_event_detail.detail` da corrida | Total de paradas por piloto em `result.pits` |
| Campeonato final de pilotos e construtores | `core.standing` (`drivers`, `constructors`) | Pontos arredondados, como na api-sports |
| Pilotos (`driver-<id>`), construtores e circuitos | `core.participant`, `core.venue` | Sem imagens: fotos e logos seguem da api-sports |

## Casamento com a api-sports (sem duplicata)

`matchF1db` (`packages/providers/src/f1db/match.ts`) grava os vínculos em `core.provider_map` com provider `f1db`:

1. **Corrida**: a sessão `Race` da api-sports no mesmo dia (±1). Nesse GP, as demais sessões casam pelo tipo, e o GP
   fica coberto: o F1DB não cria nenhuma sessão nele. A classificação inteira do F1DB não tem par, porque a api-sports
   separa Q1, Q2 e Q3.
2. **Pilotos e construtores**: nas corridas casadas, a mesma posição final é o mesmo piloto (conferido pelo sobrenome),
   e a equipe dele é o mesmo construtor. Quando a api-sports divide uma equipe em dois IDs no mesmo ano, vence o de
   nome mais parecido.
3. **Pelo nome**, só com candidato único: pilotos, construtores e circuitos da era da api-sports (2010 em diante),
   primeiro com nome exato. Um construtor recente que o F1DB separa (RB → Racing Bulls) vira a mesma equipe.

**Precedência** (estudo §4.1 e §6.4):

- A api-sports é dona dos eventos que já são dela: estado, pilotos e o espelho dela. O F1DB nunca assume uma sessão
  de outra fonte (`F1DB_PRECEDENCE`).
- Em entidades casadas, o F1DB só preenche lacunas (nome e imagem ficam com a api-sports).
- O campeonato final de cada temporada vem do F1DB.
- Ao contrário: uma sessão da api-sports que chega depois (janela de datas, plano pago) casa com a sessão do F1DB pelo
  tipo e pelo horário (±3 h) e assume o estado (`upsert-core`, `matchRaceSessions`).

## Comandos

```bash
pnpm --filter @galaxie/ingestor f1db:import --previa      # baixa o release fixado, casa e mostra o que mudaria (desfaz no fim)
pnpm --filter @galaxie/ingestor f1db:import               # grava
pnpm --filter @galaxie/ingestor f1db:import --from-raw <sha256> [--previa]   # renormaliza só a partir do raw
```

- O release vai para `F1DB_DIR` (padrão `~/.galaxie/f1db`), fora do repositório, em `<versão>/f1db-sqlite.zip` e
  `<versão>/f1db.db`. O sha256 do zip é conferido com o publicado no release.
- A prévia grava só o raw (cópia fiel do release, idempotente) e imprime: corridas e sessões casadas, pares feitos pelo
  nome, entidades sem par e conflitos recusados. Confira a lista **"Casados pelo nome"** antes de gravar.
- Reimportar o mesmo release não cria nem muda nada. O instante da observação é o da primeira gravação do raw.

## Carga em produção (VPS)

Na base de dev (NAS, 23/10/2026), com a api-sports de 2024 já carregada:

- 24 GPs casados (90 sessões vinculadas, nenhuma duplicada);
- 4.130 sessões novas de 1950 a 2026, em 1.142 GPs e 62 temporadas novas;
- 2.402 linhas de campeonato;
- cerca de 30 s de importação.

```bash
ssh root@145.223.94.149
cd /docker/galaxie-sports
# 1. backup do banco antes (o mesmo serviço do dump diário)
docker compose exec -T backup backup.sh
# 2. prévia: baixa o release para o volume f1db e mostra o casamento, sem gravar no core
docker compose run --rm --no-deps -v galaxie-f1db:/data/f1db -e F1DB_DIR=/data/f1db ingestor \
  node dist/cli/f1db-import.js --previa
# 3. conferida a prévia (pares pelo nome, nenhum conflito inesperado), grava
docker compose run --rm --no-deps -v galaxie-f1db:/data/f1db -e F1DB_DIR=/data/f1db ingestor \
  node dist/cli/f1db-import.js
# 4. limpa o cache de respostas da API (mesmo passo do deploy)
for p in 'gs:cache:*' 'gs:tag:*'; do docker compose exec -T valkey sh -c "valkey-cli --scan --pattern '$p' | xargs -r -n 200 valkey-cli del >/dev/null"; done
```

Conferência rápida depois da carga:

- `/v1/competitions/<id do campeonato>/seasons/1988/standings`: Senna em 1º, com 90 pontos;
- um GP de 2003 com a coluna de paradas preenchida;
- a página de um piloto de carreira longa (Rubens Barrichello, Michael Schumacher) com sessões desde a estreia.

**Reverter**: restaurar o backup do passo 1 (`infra/backup/restore.sh`, ver
[exercicio-dr.md](exercicio-dr.md)). Não há remoção seletiva: as sessões do F1DB se ligam às da api-sports pelo
`provider_map`.

## Atualizar o release

O F1DB publica um release depois de cada GP. Para trocar a versão:

1. Atualize `F1DB_RELEASE` em `services/ingestor/src/f1db/release.ts`: versão e sha256 do `f1db-sqlite.zip`, tirado
   do `checksums_sha256.txt` do release.
2. Abra um PR e rode a prévia na base de dev.
3. Depois do deploy, rode os passos 2 e 3 acima. O release novo vira outro pacote no raw. Sessões novas entram e as
   existentes só atualizam o que mudou.

## Atribuição (CC BY 4.0)

- **API**: a descrição do OpenAPI (`/docs`, `/openapi.json`) traz fonte, licença e o aviso de adaptação.
- **Demo**: o crédito "Histórico da Fórmula 1: F1DB · CC BY 4.0 · dados adaptados" aparece junto da classificação da
  sessão, do campeonato e do card de campeonato do piloto ou equipe.
- **Espelho**: cada sessão guarda `source`, `license` e `release` em `sport_event_detail.summary`.
