-- Função da Cosmos para as perguntas sobre os dados (#1006), no painel do assistente. Já ativa, com o mínimo da issue;
-- se a função já foi cadastrada pela tela Funções, fica como está.
INSERT INTO "cosmos"."function_def" ("name", "min_credits", "permission", "screen", "active")
VALUES ('assistant.data', 3, 'cosmos.assistant.ask', NULL, true)
ON CONFLICT ("name") DO NOTHING;
