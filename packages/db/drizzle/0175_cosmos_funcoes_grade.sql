-- Funções da Cosmos nas telas Grade e ofertas e Minha lista de canais (#1008): pedido de revisão da grade em texto
-- livre e lista de canais lida de PDF, print ou planilha. Já ativas, com o mínimo da issue; se a função já foi
-- cadastrada pela tela Funções, fica como está.
INSERT INTO "cosmos"."function_def" ("name", "min_credits", "permission", "screen", "active")
VALUES
  ('lineup.review', 5, 'settings.manage', '/cliente/grade', true),
  ('channels.import', 40, 'settings.manage', '/cliente/canais', true)
ON CONFLICT ("name") DO NOTHING;
