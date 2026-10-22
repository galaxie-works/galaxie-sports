import 'zod-openapi';
import * as z from 'zod';

const HexColor = z.string().regex(/^#[0-9a-f]{6}$/);

/** Gradiente sugerido a partir da cor primária (mesmo ângulo do token de design). */
export function teamGradient(primary: string): string {
  return `linear-gradient(9deg, #000 0%, ${primary} 100%)`;
}

export const TeamColors = z
  .object({
    primary: HexColor.meta({ description: 'Cor predominante do escudo.', example: '#006937' }),
    secondary: HexColor.nullable().meta({
      description: 'Segunda cor do escudo, com matiz distinto da primária; null quando não há.',
      example: null,
    }),
    monochrome: z.boolean().meta({
      description:
        'Escudo preto/branco/cinza: `primary` é um cinza-escuro neutro (#3a3a3a) para o gradiente continuar legível.',
      example: false,
    }),
    gradient: z.string().meta({
      description: 'CSS pronto para fundos: `linear-gradient(9deg, #000 0%, <primary> 100%)`.',
      example: 'linear-gradient(9deg, #000 0%, #006937 100%)',
    }),
  })
  .meta({
    id: 'TeamColors',
    description:
      'Cores do time extraídas do escudo espelhado (sem chamada externa) e o gradiente sugerido para a identidade visual.',
  });
export type TeamColors = z.infer<typeof TeamColors>;
