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

| Controle | Implementação |
|---|---|
| Segredos | `APISPORTS_KEY`, `ANTHROPIC_API_KEY`, credenciais de banco/S3 em variáveis de ambiente/secret store — **nunca** no Git (`.env` no `.gitignore`) |
| Autenticação de tenants | API keys com hash (argon2) no banco, rotação, escopos por módulo |
| Webhooks | Assinatura HMAC-SHA256 + timestamp (proteção contra replay) |
| Rate limiting | Por tenant e por IP na borda |
| Dependências | Dependabot + `pnpm audit` no CI |
| Backups | Dump diário do Postgres (o schema `raw` é o ativo mais caro de reconstruir) com retenção de 30 dias |
| Acesso administrativo | Rotas `/internal/*` apenas por VPN/allowlist |

## 5. Neutralidade de marca

O produto é *white-label*: nenhuma marca de cliente aparece em código, dados, documentação, issues ou na demo. Referências de mercado usam termos genéricos ("operadora de TV paga", "plataforma OTT", "motor de recomendação do cliente").
