# Chaves de API trocadas no painel (SETTINGS_KEK)

Issue #1087. As chaves de API (api-sports, OpenAI, Anthropic, Gemini, DeepSeek, YouTube, Stripe, IAs externas da Cosmos,
S3, SMTP, qualidade e o token das sugestões) podem ser trocadas em **Ajustes → Credenciais** (e na página de cada
recurso: Fornecedor e cota, IA interna, Vídeos relacionados, Cosmos AI). O valor fica no banco **cifrado**; quem abre é
a `SETTINGS_KEK`, que fica só no `.env` de cada serviço.

## Como funciona

- O painel grava a chave em `ops.runtime_setting`, na linha `<CHAVE>_SEALED` (ex.: `APISPORTS_KEY_SEALED`), cifrada com
  AES-256-GCM. O dado autenticado é `ops.runtime_setting:<CHAVE>_SEALED`: copiar o cifrado para outra linha não abre.
- O histórico (Ajustes → Histórico e auditoria) registra **quem trocou e quando**, nunca o valor (nem cifrado).
- O valor nunca volta ao navegador. A tela mostra só de onde vem a chave (painel ou `.env`) e, para chaves longas
  gravadas no painel, os 4 últimos caracteres.
- Cada serviço abre as linhas com a própria `SETTINGS_KEK` e põe a chave no env, por cima do `.env`:
  - jobs do scheduler (ingestor, live, agents): na **próxima execução** do job;
  - tarefas do worker: na próxima tarefa;
  - demo (site e console): em até **1 minuto** (e na hora, no processo que gravou);
  - API (`STRIPE_WEBHOOK_SECRET`, IAs da Cosmos): **ao reiniciar** a API.
- Se a `SETTINGS_KEK` faltar, for curta ou não abrir o cifrado, o serviço usa a chave do `.env` e a tela mostra
  "Não abre com a chave atual".
- "Testar antes de salvar" faz uma chamada barata ao provedor com a chave digitada (api-sports `/status`, listar modelos
  da OpenAI/Anthropic/Gemini/DeepSeek, `videos.list` do YouTube, `balance` do Stripe). Nada é gravado.
- "Voltar ao .env" apaga a linha do painel; os serviços voltam à chave do `.env` na próxima releitura.

### Ficam só no `.env` (selo "Só no servidor")

`SETTINGS_KEK`, `BETTER_AUTH_SECRET`, `ADMIN_KEY_HASHES`, `GALAXIE_DEMO_KEY`, `WEBHOOK_SIGNING_SECRET`, `METRICS_TOKEN`
(o Prometheus manda o mesmo token lido do `.env`) e as URLs e senhas de banco e Valkey. Não dá para guardar no banco a
chave que abre o cofre, o login ou o próprio banco.

## Criar a SETTINGS_KEK

1. Gere uma chave (32 caracteres ou mais):

   ```sh
   openssl rand -base64 32
   ```

2. Ponha no `.env` da VPS (o mesmo do compose):

   ```sh
   SETTINGS_KEK=<a chave gerada>
   ```

   O compose de produção (`infra/vps-telemetry/compose.yml`) passa a variável a todos os serviços Node pelo
   `x-node-env` (ingestor, live, agents, worker, API) e ao site e ao console pelo `demo-env`. **Todos precisam da
   mesma chave.**

3. Recrie os contêineres para pegarem a variável:

   ```sh
   docker compose up -d ingestor live agents worker api site console
   ```

4. Em Ajustes → Credenciais, abra o ⋮ de uma chave e escolha "Trocar". Se aparecer "Este contêiner não tem a
   SETTINGS_KEK", a demo não recebeu a variável. Se aparecer "Sem SETTINGS_KEK em: …", o serviço citado não recebeu (lá
   continua valendo o `.env`).

Guarde a `SETTINGS_KEK` no mesmo cofre das outras credenciais da VPS. **Nunca** a grave no banco nem em issue, log ou
chat.

No ambiente de dev (NAS), deixe a `SETTINGS_KEK` vazia ou use uma diferente da produção: as linhas cifradas que vierem
da cópia da produção não abrem lá e vale o `.env` do dev.

## Trocar a SETTINGS_KEK (recifrar tudo)

A variável aceita várias chaves separadas por vírgula: cifra com a **primeira** e abre com qualquer uma. A troca não
tem janela de indisponibilidade:

1. Gere a chave nova (`openssl rand -base64 32`).
2. No `.env`, ponha a nova na frente e mantenha a antiga:

   ```sh
   SETTINGS_KEK=<nova>,<antiga>
   ```

3. Recrie todos os serviços (passo 3 acima). Tudo continua abrindo com a antiga.
4. Em Ajustes → Credenciais, clique em **"Recifrar com a chave atual"** (o botão aparece quando há chave gravada com a
   KEK antiga). Ele recifra com a nova cada chave que abre; o histórico registra quem recifrou.
5. Confira que o botão sumiu. Depois tire a antiga do `.env` (`SETTINGS_KEK=<nova>`) e recrie os serviços de novo.

O token das sugestões gravado antes deste mecanismo (cifrado com a `WEBHOOK_SIGNING_SECRET`) continua abrindo enquanto a
demo tiver a `WEBHOOK_SIGNING_SECRET`; o mesmo "Recifrar" o passa para a `SETTINGS_KEK`.

## Se a SETTINGS_KEK se perder

Nada para: sem a KEK (ou com outra), nenhuma linha cifrada abre e **todos os serviços voltam às chaves do `.env`**. A
tela mostra "Não abre com a chave atual" nas chaves afetadas.

1. Confira se o `.env` tem chaves válidas para o que importa (no mínimo `APISPORTS_KEY` e a chave do provedor de IA
   ativo). Se o `.env` estiver vencido, o serviço fica sem a chave nova até o passo 3.
2. Crie uma `SETTINGS_KEK` nova (seção "Criar") e recrie os serviços.
3. Em Credenciais, grave de novo cada chave marcada (o valor antigo não tem como ser recuperado sem a KEK antiga). Ou
   use "Voltar ao .env" para apagar a linha que não abre.

## Conferir

- `docker compose exec ingestor printenv SETTINGS_KEK | wc -c` (só o tamanho; não imprima o valor).
- Log do scheduler: "chaves trocadas no painel aplicadas aos jobs" lista os nomes (nunca os valores). "sobrescritas do
  painel ignoradas" com `sealed` = a linha não abriu nesse serviço.
- Histórico: filtre pela chave (⋮ → "Ver no histórico").
