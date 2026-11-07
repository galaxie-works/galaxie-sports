# Sugestões do app ("Sugerir ou reportar algo")

O ícone de chat no cabeçalho do app (à esquerda da lupa) abre um painel lateral com assunto, mensagem e até 4 imagens
JPG/PNG (5 MB no total). O envio vira uma issue numa **repo privada só de sugestões**, aberta pela própria demo pela
API REST do GitHub (`apps/demo/src/lib/feedback/`).

## Por que uma repo à parte

A `galaxie-sports` é pública. O envio leva dado de cliente: a mensagem livre, o e-mail e o tenant (parcialmente
mascarados) e prints. Por isso:

- a demo confere, antes de cada envio, que `FEEDBACK_GITHUB_REPO` é privada; se não for, recusa e o formulário
  responde "indisponível" (log `[feedback] envio recusado`);
- nada passa pelo Actions (o payload não fica em log) nem pelo bucket público de assets: as imagens são gravadas na
  própria repo privada, em `anexos/<aaaa-mm>/<uuid>.<ext>`, e a issue as mostra por link da repo;
- as imagens são recodificadas antes de subir, sem EXIF, GPS ou outros metadados (`image.ts`);
- o token é só dessa repo, separado do `ALERT_GITHUB_TOKEN`.

## Ligar

1. A repo privada é `galaxie-works/galaxie-sports-customer-voice` (criada em 07/11/2026).
2. Crie um fine-grained PAT: Repository access → só essa repo; Permissions → **Issues: Read and write** e
   **Contents: Read and write** (Metadata: Read vem junto). Nada mais.
3. No `.env` da VPS:

   ```bash
   FEEDBACK_GITHUB_TOKEN=github_pat_...
   FEEDBACK_GITHUB_REPO=galaxie-works/galaxie-sports-customer-voice
   ```

4. Recrie o `site` e o `console` (próximo deploy, ou `docker compose up -d site console`).

## A issue

- Título: `<assunto>: <primeiros 50 caracteres da mensagem>`.
- Rótulo: o assunto (`Reportar um problema`, `Sugerir um recurso`, `Sugerir correção de um conteúdo`,
  `Pedir um dado ou cobertura`, `Tirar uma dúvida`, `Outro assunto`), criado na primeira vez.
- Corpo: a mensagem num bloco de texto (link, imagem, menção e HTML aparecem literais), e a ficha: assunto, e-mail
  com metade do usuário e metade do domínio mascaradas, tenant com metade do nome mascarada, papel, página (só o
  caminho), idioma, tela, navegador, versão e hora de Brasília; depois as imagens.

## Limites

6 envios por usuário por hora e 150 por dia no total, por contêiner (na memória: reiniciar zera).

## Problemas

- **"Indisponível" no app:** token ou repo vazios, ou a repo não é privada (veja o log do `site`:
  `docker compose logs site | grep feedback`).
- **Erro genérico:** o log mostra o status do GitHub: 401 token errado ou vencido; 403/404 token sem acesso à repo ou
  sem Issues/Contents: write.
