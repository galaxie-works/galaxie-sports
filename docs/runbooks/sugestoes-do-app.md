# Sugestões do app ("Sugerir ou reportar algo")

O ícone de chat no cabeçalho do app (à esquerda da lupa) abre um painel lateral com assunto, mensagem e até 4 imagens
JPG/PNG (5 MB no total). O envio vira uma issue numa **repo privada só de sugestões**
(`galaxie-works/galaxie-sports-customer-voice`), aberta pela própria demo pela API REST do GitHub
(`apps/demo/src/lib/feedback/`).

## Por que uma repo à parte

A `galaxie-sports` é pública. O envio leva dado de cliente (mensagem livre e prints). Por isso:

- a issue vai para `FEEDBACK_GITHUB_REPO` (sem padrão: o código nunca cai na repo principal), e a demo confere,
  antes de cada envio, que essa repo é privada; se não for, recusa e o formulário responde "indisponível" (log
  `[feedback] envio recusado`);
- nada passa pelo Actions (o payload não fica em log): a demo chama a API REST direto;
- quem enviou vai como **referência opaca**: `u_<12 hex>` para o usuário e `t_<12 hex>` para o tenant (HMAC do id
  com o `BETTER_AUTH_SECRET`). Nem e-mail nem nome do tenant saem da demo. A referência é estável, então issues da
  mesma pessoa se agrupam;
- as imagens são recodificadas sem EXIF, GPS ou outros metadados (`image.ts`), gravadas no bucket **privado** das
  tarefas (`S3_TASKS_BUCKET`, em `feedback/<aaaa-mm>/<uuid>.<ext>`) e a issue as mostra por um link assinado da demo
  (`/api/feedback/anexo/…?e=…&s=…`, vale um ano). Sem assinatura válida, 404;
- o token é só dessa repo e só de Issues, separado do `ALERT_GITHUB_TOKEN`.

## Ligar e configurar

Tudo em **Ajustes → Sistema → Sugestões** (só admin), sem entrar na VPS e sem reiniciar contêiner:

- **Botão de sugestões** (`FEEDBACK_ENABLED`, ligado por padrão): desligado, o botão some do app e o `sendFeedback`
  recusa no servidor ("indisponível"). O servidor passa a recusar na hora; o botão some na próxima carga da página.
- **Repositório**: `dono/repositorio`, sempre privada. Em branco, vale o `FEEDBACK_GITHUB_REPO` do `.env`.
- **Token do GitHub**: só-escrita. Ao salvar, a demo pergunta ao GitHub se esse token enxerga essa repo e se ela é
  privada: sem 200 e `private: true`, recusa e não grava nada. Essa conferência não prova o Issues: write; se faltar,
  o erro aparece no primeiro envio. Depois de salvo, o painel só diz de onde vem o token (painel, `.env` ou não
  definido); "Remover do painel" apaga o cifrado e o envio volta ao do `.env`.

Precedência: painel, depois `.env` da VPS. Quem ainda usa só o `.env` não precisa migrar nada.

Como criar o token:

1. A repo privada é `galaxie-works/galaxie-sports-customer-voice` (criada em 07/11/2026).
2. Fine-grained PAT (https://github.com/settings/personal-access-tokens/new): Resource owner galaxie-works;
   Repository access → só essa repo; Permissions → **Issues: Read and write** (Metadata: Read vem junto). Nada mais.

Pelo `.env` (a reserva; aí sim precisa recriar `site` e `console`, no próximo deploy ou com
`docker compose up -d site console`):

```bash
FEEDBACK_GITHUB_TOKEN=github_pat_...
FEEDBACK_GITHUB_REPO=galaxie-works/galaxie-sports-customer-voice
```

## Como o token é guardado

- Em `ops.runtime_setting`, chave `FEEDBACK_GITHUB_TOKEN_SEALED`, cifrado em AES-256-GCM com a mesma KEK dos webhooks
  (`WEBHOOK_SIGNING_SECRET`, que fica no `.env`, fora do banco) e preso a essa chave pelo dado autenticado. Sem a KEK
  no contêiner, o painel recusa gravar: nunca vai texto puro para o banco.
- A demo relê a cada envio, então a troca vale em `site` e `console` sem reiniciar. Ela só decifra para enviar e para
  saber se o token abre; o valor nunca vai ao navegador, a log, a resposta de API ou ao histórico.
- `ops.runtime_setting_log` registra quem mudou e quando, com `••••••••` no lugar do valor (Sistema → Histórico).
- O `mirror-prod-to-dev` apaga `ops.runtime_setting` inteira: o token do painel de produção não vai para o dev.
- **Trocar a KEK:** `wh seal-secrets` recifra só os segredos dos webhooks. Depois de tirar a KEK antiga do `.env`, o
  painel mostra "Token salvo não abre" e o envio cai no token do `.env` (se houver): cole o token de novo em Sugestões.

## A issue

- Título: `<assunto>: <primeiros 50 caracteres da mensagem>`.
- Rótulo: o assunto (`Reportar um problema`, `Sugerir um recurso`, `Sugerir correção de um conteúdo`,
  `Reportar informação faltando ou incompleta`, `Tirar uma dúvida`, `Outro assunto`), criado na primeira vez.
- Corpo: a mensagem num bloco de texto (link, imagem, menção e HTML aparecem literais), e a ficha: assunto,
  referência do usuário, referência do tenant, papel, página (só o caminho), idioma, tela, navegador, versão e hora
  de Brasília; depois as imagens.

## Andamento e caixa de entrada

Quem enviou acompanha a sugestão pelo sino do cabeçalho (caixa de entrada) e por uma faixa de aviso no topo da página.

- **Quadro:** projeto "Customer Voice" da conta `galaxie-works` (projeto 5), ligado à repo de sugestões, com as colunas
  Backlog, Em revisão, Selecionado para desenvolvimento, Necessita mais informações, Em desenvolvimento e Entregue. Os
  nomes estão em `FEEDBACK_STATUS_COLUMNS` (lib/i18n/messages/feedback-issue.ts): renomear uma coluna no GitHub exige
  mudar lá, senão ela não gera aviso (o log do `site` mostra "colunas que o app não conhece").
- **Conferência diária:** às 12:00 UTC (9h de Brasília) o `site` lê as issues com o mesmo token do envio. O token
  fine-grained de Issues não enxerga o quadro, mas lê o histórico de colunas de cada issue, que é o que basta. Ajustes →
  Sistema → Sugestões mostra a última conferência e tem "Verificar agora". Repetir não duplica aviso.
- **O que vira aviso:** a coluna final do dia (Backlog não avisa; ida e volta no mesmo dia também não) e os comentários
  que começam com `/responder`. Qualquer outro comentário fica só entre a equipe. Coluna e resposta no mesmo dia viram
  um aviso só.
- **Conversa:** toda resposta da equipe (`/responder`) e o aviso de "Necessita mais informações" aceitam resposta pela
  caixa de entrada, sempre no aviso mais recente da issue, uma vez por aviso, com a issue aberta e fora de Entregue. A
  resposta chega como comentário na issue ("Resposta de quem enviou"). Para pedir detalhes, escreva a pergunta com
  `/responder`; mover o card para "Necessita mais informações" é opcional. Mover o card depois é com a equipe: o token
  não altera o quadro.
- **Sino:** com a aba aberta, o app olha a caixa de entrada a cada minuto (consulta no banco, sem GitHub), ao voltar
  para a aba e logo depois do "Verificar agora". O aviso aparece quando a conferência roda, não quando o comentário é
  escrito.
- **Issue nova no Backlog:** fluxos "Auto-add to project" (filtro `is:issue`) e "Item added to project" → Backlog
  ligados no projeto desde 10/11.
- Tabelas no schema `demo_auth`: `notification`, `feedback_issue` (issue → quem enviou, coluna e até onde já foi lida)
  e `feedback_progress_run`. `FEEDBACK_PROGRESS=off` desliga o relógio do processo.

## Descobrir quem enviou

No contêiner do `site` (tem o segredo), com o id do usuário (Ajustes → Usuários) ou do tenant:

```bash
docker compose exec site node -e '
const c=require("crypto"),s=process.env.BETTER_AUTH_SECRET,[k,id]=process.argv.slice(1);
const d=c.createHmac("sha256",s).update("feedback:ref:"+k).digest();
console.log(k+"_"+c.createHmac("sha256",d).update(id).digest("hex").slice(0,12))' u <id-do-usuario>
```

Compare com a referência da issue (`u` para usuário, `t` para tenant).

## Limites

6 envios por usuário por hora e 150 por dia no total, por contêiner (na memória: reiniciar zera). O limite é
conferido antes de recodificar as imagens, e arquivo recusado também conta. Imagem acima de 24 megapixels (pelo
cabeçalho, antes de decodificar) é recusada. Se a issue falhar depois de gravar as imagens, elas são apagadas do
bucket.

## Problemas

- **"Indisponível" no app:** o botão está desligado no painel, token ou repo vazios, a repo não é privada, ou (com
  imagem) o bucket privado não está configurado (veja o log do `site`:
  `docker compose logs site | grep feedback`).
- **"Token salvo não abre" no painel:** a KEK do contêiner não abre o cifrado (KEK trocada ou ausente). Cole o token de
  novo em Sugestões.
- **Erro genérico:** o log mostra o status do GitHub: 401 token errado ou vencido; 403/404 token sem acesso à repo ou
  sem Issues: write.
