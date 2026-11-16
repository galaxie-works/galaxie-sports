/**
 * Faixas na Gamificação (arquitetura 03, "Segurança, privacidade e retenção"; revisão de 08/11, que substitui o 18+
 * para o módulo inteiro de 07/11): `under13` fica fora; `13_17` palpita e ganha Pontos, Conquistas e Cartas;
 * `18plus` faz tudo. O Prêmio vai sempre ao Titular da Conta, e o código de lote nunca aparece para Perfil menor.
 */
export type GameAgeBand = 'under13' | '13_17' | '18plus';

export type GameAction = 'predict' | 'earn' | 'collect_card' | 'see_prize_code';

export function gameAllows(band: GameAgeBand | null | undefined, action: GameAction): boolean {
  if (band !== '13_17' && band !== '18plus') return false; // sem faixa, o torcedor não entra
  if (action === 'see_prize_code') return band === '18plus';
  return true;
}
