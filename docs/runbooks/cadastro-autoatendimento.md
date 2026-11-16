# Cadastro em autoatendimento (plataforma comercial, F2)

O cliente cria a conta sozinho em `/signup`: e-mail de trabalho e código de acesso (o mesmo login por OTP), depois o
assistente da organização (país, termos), da primeira marca (nome, identificador, esportes, domínio, cor) e a
calculadora de capacidade. O provisionamento (`apps/demo/src/lib/client/provision.ts`) é idempotente e serve também à
equipe, pelo botão **Nova organização** em Ajustes › Clientes › Organizações e marcas. A máquina de estados do tenant,
os e-mails dos dias 23 e 29, o trial por módulo pela loja, o Stripe e a marcação automática do checklist ficam para a F3.

## Como ligar

O cadastro público nasce **desligado** e só abre com as duas chaves de runtime abaixo, em Ajustes › Clientes ›
Cadastros e trials (`ops.runtime_setting`; vale sem reiniciar):

| Chave | Padrão | O que faz |
| --- | --- | --- |
| `SIGNUP_ENABLED` | `off` | `on` liga a página `/signup`. |
| `SIGNUP_TERMS_VERSION` | vazio | Identificador da versão dos termos de autoatendimento aprovada pelo advogado (#1022), ex.: `2026-11-v1`. Gravado em `billing.organization.terms_version` a cada aceite. Vazio = o cadastro não abre mesmo ligado (trava jurídica). |
| `SIGNUP_PER_IP_PER_DAY` | `5` | Organizações criadas pelo mesmo IP em 24 h (conta `terms_accepted_ip`). |
| `TRIAL_DAYS` | `30` | Prazo do trial: `api.tenant.trial_ends_at = agora + dias`, gravado na criação (PL3, PL15). |

Desligado, `/signup` mostra "em breve" com o contato comercial, sem formulário. Enquanto isso a equipe cria os
clientes pelo botão **Nova organização**: informa o e-mail do Dono (usuário criado sem senha, como nos convites),
o país, a marca e o motivo; o convite sai por e-mail e as chaves aparecem uma vez na tela, para repassar ao cliente.

## O que o provisionamento cria

| Passo | Cria | Idempotência |
| --- | --- | --- |
| 0 | `billing.organization` (país, moeda e entidade: BR → BRL/Ltda, demais → USD/LLC; faixa; revisão; termos) | upsert por `slug`; o aceite dos termos só entra quando ainda não há |
| 1 | `api.tenant` com plano `fan_experience`, módulos do plano, `markets = [país]`, `trial_ends_at`, `catalog_version`; `capacity_tier` nulo (a faixa é da organização) | upsert por `slug`; o prazo do trial fica o da criação |
| 2 | `api.tenant_member` e `billing.organization_member` com quem criou como Dono | único por tenant/organização e usuário |
| 3 | Chaves secretas `live` e `test` e uma publicável com o host padrão (`https://<slug>.<host da plataforma>`) | pula o que já existe; só com `review_status` fora de `pending`/`rejected` |
| 4 | Tema da marca com a cor informada | pula se a marca já tem tema |
| 5 | Evento `tenant.provisioned` em `ops.change_feed`, com a faixa calculada e o uso declarado no payload | só na criação da marca |

O slug de outra organização ou marca não é tomado: rodar de novo exige ser Dono da organização existente.

## PL2, PL3 e PL7 como implementadas

- **PL2 (e-mail grátis e um trial por domínio).** Domínios de provedor grátis (lista em
  `apps/demo/src/lib/signup/email-domain.ts`) não são barrados: a organização nasce com `review_status = 'pending'` e
  sem chave. A equipe aprova em Organizações e marcas (editar → revisão "Aprovado", com motivo); na aprovação as chaves
  que faltam são emitidas e aparecem uma vez na tela. Com e-mail de empresa, se já existe organização em trial cujo
  Dono tem o mesmo domínio, o cadastro recusa e pede um convite ao Dono.
- **PL3 (trial).** A conta nasce com os três módulos do Fan Experience por `TRIAL_DAYS`, um país e faixa **C1**. A
  calculadora só informa a faixa que o uso declarado pediria (vai no payload do evento `tenant.provisioned`).
- **PL7 (até C2 sozinho).** A calculadora pega a menor faixa de `config/catalog/capacity.yaml` que cobre as três
  medidas (visualizações por mês, pessoas no pico, pessoas escrevendo no chat). C1 e C2 seguem; C3 e C4 viram "pedir
  proposta": a organização é gravada em revisão, com a faixa calculada, sem chaves, e a tela mostra o contato.
- **PL14 (preço).** A tela mostra "a partir de" do plano Fan Experience e da faixa pelo `billing.price` do mercado (ou
  `ZZ`), só se houver preço cadastrado. Nenhum preço no repositório.

## Testes

`apps/demo/src/lib/signup/*.test.ts` (calculadora, domínio grátis, chaves de runtime, regras do assistente) e
`apps/demo/test/signup.integration.test.ts` (provisionamento idempotente, revisão sem chave e aprovação, um trial por
domínio, teto por IP) contra um banco descartável.
