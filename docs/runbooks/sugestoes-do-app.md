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

## Ligar

1. A repo privada é `galaxie-works/galaxie-sports-customer-voice` (criada em 07/11/2026).
2. Fine-grained PAT (https://github.com/settings/personal-access-tokens/new): Resource owner galaxie-works;
   Repository access → só essa repo; Permissions → **Issues: Read and write** (Metadata: Read vem junto). Nada mais.
3. No `.env` da VPS:

   ```bash
   FEEDBACK_GITHUB_TOKEN=github_pat_...
   FEEDBACK_GITHUB_REPO=galaxie-works/galaxie-sports-customer-voice
   ```

4. Recrie o `site` e o `console` (próximo deploy, ou `docker compose up -d site console`).

## A issue

- Título: `<assunto>: <primeiros 50 caracteres da mensagem>`.
- Rótulo: o assunto (`Reportar um problema`, `Sugerir um recurso`, `Sugerir correção de um conteúdo`,
  `Reportar informação faltando ou incompleta`, `Tirar uma dúvida`, `Outro assunto`), criado na primeira vez.
- Corpo: a mensagem num bloco de texto (link, imagem, menção e HTML aparecem literais), e a ficha: assunto,
  referência do usuário, referência do tenant, papel, página (só o caminho), idioma, tela, navegador, versão e hora
  de Brasília; depois as imagens.

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
conferido antes de recodificar as imagens, e arquivo recusado também conta. Imagem acima de 40 megapixels (pelo
cabeçalho, antes de decodificar) é recusada. Se a issue falhar depois de gravar as imagens, elas são apagadas do
bucket.

## Problemas

- **"Indisponível" no app:** token ou repo vazios, a repo não é privada, ou (com imagem) o bucket privado não está
  configurado (veja o log do `site`:
  `docker compose logs site | grep feedback`).
- **Erro genérico:** o log mostra o status do GitHub: 401 token errado ou vencido; 403/404 token sem acesso à repo ou
  sem Issues: write.
