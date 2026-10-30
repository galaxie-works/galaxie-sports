# @galaxie/where-to-watch

Parte determinística do onde assistir: dicionário de emissoras e plataformas, tabela de direitos por competição e país,
validador que só publica opção com evidência e confiança, versionamento, correção editorial, auditoria, logos oficiais e
casamento de canais das grades.

## Como usar

Configuração em `config/broadcasters` e `config/broadcast-rights` (por país), lida de `WTW_CONFIG_DIR`; bloqueios em
`WTW_BLOCKLIST`/`WTW_BLOCKLIST_FILE`. A pesquisa com IA fica em `services/ai-agents/src/wtw`; este pacote decide o que
pode ir ao ar. Ver [docs/05](../../docs/05-api-publica.md) e [research/onde-assistir](../../docs/research/onde-assistir.md).

## Depende de

`@galaxie/db`.

## Usado por

`apps/api`, `apps/demo`, `services/ingestor`, `services/ai-agents`.
