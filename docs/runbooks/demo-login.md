# Login da demo: bloqueio do código por e-mail

A demo entra só com código por e-mail (`apps/demo/src/lib/auth`). Contra força bruta, além das 5 tentativas por código, `otp-guard.ts` conta os chutes errados no Postgres, no schema `demo_auth`:

- **Pedidos de código** (`otp_request`): um a cada 45 s por e-mail.
- **Chutes errados** (`otp_failure`): só contam os que vêm depois de um pedido de código para aquele e-mail, dentro dos 10 minutos de validade. Sem pedido não há o que acertar, então ninguém trava um e-mail sem que o dono receba os códigos.
- **Bloqueio**: 20 erros na última hora do mesmo IP travam aquele IP para o e-mail. 60 erros somando todos os IPs travam o e-mail inteiro. Travado, o e-mail não pede nem confere código (erro `OTP_LOCKED` na tela de login).
- O bloqueio some sozinho quando os erros saem da janela de uma hora. Chegar a um dos tetos sai no log do contêiner da demo como aviso: `[demo-auth] login por código bloqueado para …`.

## Destravar

**Pelo painel**: em **Ajustes → Usuários → (pessoa) → Sessões**, a linha "tentativas erradas de código na última hora" tem o botão **Desbloquear login**. Ele apaga as tentativas do e-mail, de todos os IPs.

**Admin travado** (sem outro admin para usar o painel): no Postgres da stack, troque o e-mail e rode:

```bash
psql -U galaxie -d galaxie_sports \
  -c "delete from demo_auth.otp_failure where email = lower('admin@exemplo.com');"
```

Para ver antes o que há:

```sql
select ip, count(*), max(created_at)
  from demo_auth.otp_failure
 where email = lower('admin@exemplo.com') and created_at > now() - interval '1 hour'
 group by ip;
```

Se o aviso se repetir para o mesmo e-mail, alguém está pedindo códigos e chutando: o dono recebe um e-mail a cada pedido. Os IPs ficam em `otp_failure.ip`.

## Cabeçalhos de segurança (CSP em observação)

A CSP completa da demo vai como `Content-Security-Policy-Report-Only` (`apps/demo/src/lib/security-headers.ts`), sem endpoint de relatório. Para conferir antes de passar a valer:

1. Abra a demo em produção com o console do navegador aberto.
2. Passe pela home, ao vivo, uma página de evento com vídeo, docs ("Ver código"), Builder e Ajustes.
3. Cada bloqueio que a política faria aparece como aviso `[Report Only]`.

Com o console limpo, troque o cabeçalho para `Content-Security-Policy` no mesmo módulo.
