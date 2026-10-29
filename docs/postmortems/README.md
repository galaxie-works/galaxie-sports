# Postmortems

Registro dos incidentes de produção, sem culpados: o que o sistema permitiu, não quem apertou o botão. Cada afirmação
aponta para um commit, um PR, uma release, uma execução do Actions ou um log. O que é inferência diz que é.

- Novo postmortem: copie o [template](_template.md) para `AAAA-MM-DD-<assunto>.md` (data do início, em UTC).
- Quando escrever: está no [runbook de on-call](../runbooks/on-call.md#depois).
- Horários sempre em UTC.

## Incidentes

| Data | Incidente | Sev. | Estado | Correção |
|---|---|---|---|---|
| 2026-10-25 | [Deploy parado quase 2 h no envio das imagens, sem aviso](2026-10-25-deploy-travado.md) | SEV3 | resolvido | #295, #315, #330, #384, #403 |
| 2026-10-25 | [Carrossel "Legendary" da F1 vazio na produção](2026-10-25-carrossel-lendas-vazio.md) | SEV3 | resolvido | #296, #327 |
| 2026-10-26 | [Deploy das tabelas LATAM tirou as stakes do Brasileirão e foi desfeito sozinho](2026-10-26-deploy-tabelas-desfeito.md) | SEV3 | resolvido | #394, #393 |
| 2026-10-27 | [Conta do Gemini sem crédito e agentes de IA no texto determinístico](2026-10-27-ia-sem-credito.md) | SEV2 | **aberto** | #395, #385, #386, #403 |

## Levantados e deixados de fora (25 a 27/10)

O levantamento olhou o `git log` de 24 a 29/10 (fix, hotfix, revert, rollback), as releases `deploy-2026-10-2*`, as
execuções do `deploy.yml`, os runbooks e os PRs. Estes casos apareceram, mas ficaram em dúvida como incidente de
produção:

| Data | Caso | Por que ficou de fora | Fonte |
|---|---|---|---|
| 2026-10-25 | Galeria de fotos de um piloto da F1 apagada num remapeamento do acervo (5 fotos licenciadas) | Dado de acervo, restaurado no manifesto; não há registro de quanto tempo a página do piloto ficou sem as fotos | [#299](https://github.com/galaxie-works/galaxie-sports/pull/299), commit `038f0a72` |
| 2026-10-25 | Tabelas em dobro: grupo sem nome por cima dos grupos do fornecedor em 13 temporadas | Defeito de dado antigo, achado em auditoria, sem início conhecido; corrigido no #335 e no #364 | [#364](https://github.com/galaxie-works/galaxie-sports/pull/364) |
| 2026-10-26 | Disparo manual do deploy terminou "success" sem publicar (run 40346309753) | Só no caminho de deploy, sem efeito na produção | [#388](https://github.com/galaxie-works/galaxie-sports/pull/388) |
| 2026-10-25 | Revert de "conflito de edição aprovada resolvido campo a campo" | Revertido num branch antes de chegar à main | commit `38a4caa4` |
| 2026-10-28 | Grafana em laço por cerca de 1 dia (`ALERT_EMAIL_FROM` com nome e endereço) | Fora da janela (28 e 29/10) e sem log no repositório; só a nota de handover da operação | — |
