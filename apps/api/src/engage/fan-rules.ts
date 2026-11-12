/**
 * Capacidades que o `GET /v1/fans/me` devolve para o widget esconder botões (#937). Quem decide é o portão de idade
 * (#1106, `ageGate` do `@galaxie/engage`), com a ficha do país, a autorização do responsável e a comprovação: a lista
 * é o que ele libera hoje. O Prêmio vai para o Titular da Conta, não para o Perfil: sem `holder_adult = yes` ele fica
 * pendente com o cliente (#1017, D3).
 */
export const FAN_CAPABILITIES = ['read', 'predict', 'write', 'redeem'] as const;
export type FanCapability = (typeof FAN_CAPABILITIES)[number];
