# Cosméticos do Perfil público

Níveis, molduras de avatar, planos de fundo e títulos do Perfil do torcedor. Tudo se ganha por Nível, Coleção completa ou Degrau Lendário de uma Conquista; nada se compra. Formato e regras de texto em [padronizacao.md](../padronizacao.md) (seção 7); arte, animação e discrição em [arte/guia.md](../arte/guia.md) (seção 5). Validar com `node docs/gamificacao/catalogo/_validar.mjs cosmeticos`.

## Arquivos

| Arquivo | O que tem |
| --- | --- |
| `niveis.json` | Os 10 Níveis: `min_points` fixos (0, 100, 300, 700, 1.500, 3.000, 6.000, 10.000, 16.000, 25.000), nome nos três idiomas, selo (`badge`) e `badge_prompt`. Sem `unlock`: o Nível vem dos Pontos. |
| `molduras.json` | Anéis circulares do avatar: seis por faixa de Nível (`frame.level_*`), 18 de Coleção completa e 8 de Degrau Lendário. As de Nível 7-8, 9 e 10 e quatro das de Degrau Lendário são animadas (`animation` descreve o loop de 2 a 4 s). |
| `fundos.json` | Planos de fundo do Perfil: 54 de Coleção completa e 5 genéricos por Nível (`background.common.level_*`). Fundo não anima. Cada prompt descreve a cena 16:9 e pede a recomposição 9:16 na mesma frase. |
| `titulos.json` | Texto curto abaixo do Apelido: 37 de Coleção completa e 15 de Degrau Lendário. Sem arte: a interface desenha, na cor da raridade da Conquista que destrava. |

## Quantos há, por tipo e por destrave

| Tipo | Por Nível | Por Coleção | Por Conquista (Degrau Lendário) | Total | Animados |
| --- | --- | --- | --- | --- | --- |
| Níveis | 10 (são o próprio Nível) | – | – | 10 | – |
| Molduras | 6 | 18 | 8 | 32 | 7 |
| Fundos | 5 | 54 | 0 | 59 | 0 |
| Títulos | 0 | 37 | 15 | 52 | 0 |
| **Total** | 21 | 109 | 23 | 153 | 7 |

Todas as 109 Coleções de `cartas/colecoes.json` destravam exatamente um cosmético (18 molduras, 54 fundos, 37 títulos), com o id que a Coleção aponta. Fundos por esporte: cada um dos 12 esportes tem entre 3 (Fórmula 1) e 5 fundos vindos das Coleções, por isso não foi preciso completar com fundos por Nível ou Conquista do esporte.

## Vitrine (o que o torcedor fixa no Perfil)

A vitrine é a faixa do Perfil onde o torcedor fixa Conquistas e Cartas escolhidas por ele. O número de vagas cresce com o Nível:

| Nível | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Vagas | 3 | 3 | 4 | 5 | 5 | 6 | 7 | 8 | 8 | 9 |

Regras de ordem:

- A ordem é do torcedor: ele arrasta as peças; a primeira vaga é a que aparece também no cabeçalho do Perfil ao lado do Nível.
- Vaga vazia é preenchida automaticamente pela conquista mais recente (Degrau ou Carta) até o torcedor mexer; quando ele reordena uma vez, o preenchimento automático para e só volta se ele esvaziar a vaga.
- Carta e Conquista contam igual na vitrine; uma Coleção completa pode ser fixada como peça única (mostra a capa da Coleção).
- Subir de Nível abre a vaga nova vazia (com o preenchimento automático); cair de Nível não existe, então a vitrine nunca encolhe.

## Regra de exibição

- O torcedor escolhe o que mostra. A privacidade campo a campo que já existe no Perfil vale para cada cosmético: moldura, fundo, título e vitrine têm o próprio interruptor, e o padrão é mostrar.
- Um cosmético destravado fica no armário do torcedor; ele equipa um de cada tipo (uma moldura, um fundo, um título). Trocar é livre e sem custo; desequipar também.
- **No chat do jogo e no Ranking aparecem só a moldura do avatar e o título**, nunca o fundo nem a vitrine. A moldura usa a versão estática (sem pulso, órbita ou varredura) e o título vai em tamanho de legenda, sem gradiente animado e sem brilho. A animação existe só na página do Perfil e no cabeçalho dele.
- `prefers-reduced-motion` e clientes sem suporte recebem a versão estática (o quadro do meio do loop), que é a mesma do chat e do Ranking.
- Nada no Perfil sugere compra: o armário mostra o que falta destravar e o que destrava (Nível, Coleção ou Conquista), nunca um preço.

## Como adicionar um cosmético

1. Id no padrão: `frame.<nome>`, `background.<esporte|common>.<nome>`, `title.<nome>` (esporte com hífen vira sublinhado).
2. `name` nos três idiomas (título: 2 a 3 palavras, até 24 caracteres; sem metal, sem provocação, sem entidade real).
3. `unlock` com `level`, `collection` (Coleção existente) ou `achievement` + `step` (só Degrau que existe; Lendário é o `step: 5` de Conquista ativa com 5 Degraus).
4. `animated` e, se true, `animation` dentro das regras do guia (loop de 2 a 4 s, sem flash, luminância até 20%).
5. Moldura e fundo: `art_prompt` com a frase de enquadramento do guia e a frase de estilo A, `art_negative_prompt` começando pelo negative padrão.
6. Lista em ordem por id e `node docs/gamificacao/catalogo/_validar.mjs cosmeticos` até `0 erro(s)`.
