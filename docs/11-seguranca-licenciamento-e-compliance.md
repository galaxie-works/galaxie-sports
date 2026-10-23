# 11 · Segurança, licenciamento e compliance

## 1. Licenciamento de dados (api-sports.io)

| Tema | Posição do projeto |
|---|---|
| Plano gratuito | Usado **somente** para desenvolvimento, manutenção do espelho e demonstração. No free de 2026 só as temporadas 2022–2024 e a janela ontem→amanhã são acessíveis — ver [research/api-sports-football.md](research/api-sports-football.md) |
| Plano Pro temporário | Recomendado por 30 dias para o bootstrap (temporada atual + histórico + `ids=`). Uso interno com cache é compatível com os termos |
| Revenda | Os termos **proíbem revender ou vender diretamente** os dados. Construir produto próprio é permitido |
| Produção comercial | Exige **acordo por escrito** com a api-sports para expor os dados a terceiros via nossa API **ou** uso de outra fonte licenciada (inclusive o provedor que o cliente já contrata) através da camada de provedores (ADR-09) |
| Sportmonks (candidato) | Planos self-serve permitem construir e vender produto próprio, mas **redistribuição como feed a outras empresas exige aprovação por escrito** → negociar **Enterprise** com cláusula explícita de redistribuição/white-label para os nossos clientes. Acesso é precificado por domínio e o token não pode ser compartilhado entre empresas. Logos/fotos não são licenciados por eles. Ver [research/sportmonks.md](research/sportmonks.md) |
| Termos | Regidos pela lei francesa; última atualização em 21/05/2025; o fornecedor pode alterar o free sem aviso |
| Múltiplas contas/chaves para burlar limites | **Proibido** neste projeto. A economia vem do desenho (raw, cache, chamadas de alto rendimento), não de contornar regras |
| Imagens (logos, escudos, fotos) | Espelhadas para desempenho; escudos e marcas pertencem a clubes/ligas. Uso comercial final deve ser validado juridicamente com o cliente |
| Acervo customizado de logos | Só pacotes com licença que cubra o uso comercial (TV/streaming). Autor, licença e revisão ficam no manifesto versionado e nos créditos do [runbook](runbooks/acervo-de-logos.md#créditos-e-licenças-dos-acervos); cada asset registra a origem (`core.asset.origin`) e a flag `ASSETS_CUSTOM_LOGOS` desliga tudo na hora sem apagar nada. O football-logos.cc foi avaliado e **não** importado: os termos do site proíbem uso comercial |
| F1DB (histórico da F1) | **CC BY 4.0**: uso comercial permitido, com atribuição e aviso de adaptação, sem ShareAlike. Crédito na referência da API (`/docs`, descrição do OpenAPI) e na demo, junto da classificação e do campeonato da F1. Release fixado e importação em [runbooks/f1db.md](runbooks/f1db.md); estudo em [research/f1-jolpica.md](research/f1-jolpica.md). O jolpica-f1 e o OpenF1 (CC BY-NC-SA) **não** são usados |
| Atribuição | Manter registro da origem de cada dado (`raw.api_response`, `core.provider_map`) |

## 2. Conteúdo gerado por IA e fontes externas

- Evidências armazenadas como **URL + trecho curto** (≤ 200 caracteres); nunca cópia de matérias.
- Scraping somente de fontes cujos termos permitam; preferência por páginas oficiais de organizadores, emissoras e clubes. Fontes com termos restritivos ficam fora (ver [research/onde-assistir.md](research/onde-assistir.md)).
- Letras de hinos e músicas **nunca** são armazenadas na base semântica.
- Toda saída de IA carrega `model`, `sources`, `confidence` e `review_status`.

## 3. Dados pessoais (LGPD e equivalentes)

- A API Galaxie **não recebe dados pessoais** de assinantes: personalização por perfil acontece no cliente, que envia no máximo afinidades anônimas (`team_ids`) quando necessário.
- Dados de atletas e técnicos são de interesse público esportivo (nome, posição, estatísticas). Não armazenamos dados sensíveis.
- Logs não guardam IP completo do usuário final do cliente.

## 4. Segurança

Política, rotação de segredos e como reportar vulnerabilidades: [SECURITY.md](../SECURITY.md).

| Controle | Implementação |
|---|---|
| Segredos | `APISPORTS_KEY`, `ANTHROPIC_API_KEY`, credenciais de banco/S3 em variáveis de ambiente/secret store — **nunca** no Git (`.env` no `.gitignore`). Varredura de segredos (gitleaks, histórico completo) em todo PR; rotação documentada no SECURITY.md |
| Autenticação de tenants | API keys `gs_<live\|test>_<prefixo>_<segredo>` (256 bits), segredo guardado só como hash **scrypt** com sal (N=2¹⁴, r=8, p=1, `node:crypto`), comparação em tempo constante, rotação com período de graça, revogação, escopos por módulo — revisão em [SECURITY.md §Chaves](../SECURITY.md#chaves-de-api) |
| Acesso administrativo | `/internal/*`: bloqueado no proxy público (404), chave administrativa (`x-galaxie-admin-key`, hash `sha256$` em `ADMIN_KEY_HASHES`, várias para rotação) **e** allowlist de IP/CIDR (`ADMIN_IP_ALLOWLIST`; fora dela → 404). Sem hash configurado, as rotas não existem |
| Headers HTTP | `nosniff`, `X-Frame-Options: DENY`, CSP `default-src 'none'` (JSON) / `frame-ancestors 'none'` (`/docs`), `Referrer-Policy: no-referrer`, COOP/CORP `same-origin`, HSTS opcional (`HSTS_MAX_AGE`) |
| CORS | Estrito: só as origens de `CORS_ORIGINS`, sem credenciais, métodos `GET/HEAD/POST`; nunca em `/internal/*`; sem a variável, nenhum header CORS |
| Entrada | Toda rota valida params/query/corpo com Zod (auditoria automática em `security.test.ts`: rota sem autenticação declarada quebra o teste); corpo máx. 64 KiB (`API_BODY_LIMIT`, 413); query do espelho limitada (20 parâmetros, 200 caracteres) |
| Webhooks | Assinatura HMAC-SHA256 + timestamp (proteção contra replay) — notas de implementação em [SECURITY.md §Webhooks](../SECURITY.md#webhooks) |
| Rate limiting | Por tenant e rota (Valkey); por IP na borda |
| Logs | Sem chaves (`x-galaxie-key`/`x-galaxie-admin-key` removidos também nos logs do Caddy) e com IP mascarado |
| Dependências | Dependabot (npm, GitHub Actions, Docker/Compose — `.github/dependabot.yml`) + `pnpm audit --prod` informativo no CI |
| Backups | Dump diário do Postgres (o schema `raw` é o ativo mais caro de reconstruir) com retenção de 30 dias, cópia remota opcional e restore testado no CI — [infra/portainer/README.md](../infra/portainer/README.md#backups); exercício de DR: [docs/runbooks/exercicio-dr.md](runbooks/exercicio-dr.md) |

## 5. Neutralidade de marca

O produto é *white-label*: nenhuma marca de cliente aparece em código, dados, documentação, issues ou na demo. Referências de mercado usam termos genéricos ("operadora de TV paga", "plataforma OTT", "motor de recomendação do cliente").
