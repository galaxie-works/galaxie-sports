# Guia de arte do Catálogo: Cartas, molduras e cosméticos do Perfil

Este guia é a referência de quem gera, revisa ou troca a arte das Cartas e dos cosméticos do Perfil público. Ele é coerente com a seção 5 de [padronizacao.md](../padronizacao.md): a frase de estilo A, as cinco frases de moldura e o negative prompt padrão são copiados de lá e valem literalmente; o validador (`_validar.mjs`) confere que todo `art_prompt` traz a frase da moldura da sua raridade e o enquadramento "vertical trading card", e que todo `art_negative_prompt` começa pelo padrão. Nada aqui muda isso; o guia explica o que fica em volta.

Texto em português; frases de estilo, prompts e nomes de parâmetros em inglês, porque é o que o gerador lê.

## 1. Princípios

1. **Nenhuma entidade real na imagem.** Nem clube, escudo, uniforme reconhecível, estádio real, atleta, técnico, marca, patrocinador, mascote, bandeira nacional, nem texto. A cena é sempre genérica: silhuetas ou figuras estilizadas, bola e equipamento genéricos, arquibancada sem faixas. Se a imagem gerada "parece" alguém ou algum lugar, ela não serve, mesmo que o prompt estivesse certo.
2. **Neutralidade de cor de clube.** Uniformes são sempre `plain white kit` e `plain charcoal kit`. Quando a cena precisa de uma segunda cor num uniforme (calção, meia, detalhe), usar cinza-claro ou bege. Nunca combinar duas cores vivas no mesmo uniforme, nunca listras ou faixas horizontais ou verticais, nunca as combinações que lembram clube famoso (vermelho e preto, azul e grená, preto e branco listrado, verde e branco, amarelo e azul, vermelho e branco em faixas). A paleta do estilo colore a cena (céu, arquibancada, gramado, luz), nunca o uniforme.
3. **Diversidade nas silhuetas.** Gênero, etnia e tipo físico variam dentro de cada Coleção, não só entre Coleções. Esportes femininos aparecem como protagonistas (atacante, goleira, pivô, piloto, lutadora), não só na arquibancada. Regra prática: numa Conquista de 5 Degraus, pelo menos 2 Cartas com figura central feminina; o tom de pele muda de Carta para Carta; corpos altos, baixos, largos e magros.
4. **13+.** Nada de álcool (nem copo na arquibancada), nada de provocação, nada de gesto obsceno. No MMA, a imagem mostra o gesto esportivo (a guarda, a queda, o braço erguido, o abraço no fim), nunca sangue, hematoma, rosto deformado ou golpe conectando no rosto. O negative prompt do MMA ganha `blood, bruises, injuries, pain`.
5. **Rosto nunca reconhecível.** Figuras de costas, de perfil, em contraluz, com o rosto simplificado ao ponto de não ter identidade, ou cobertas por capacete e equipamento. O negative já pede `recognizable faces`; a composição ajuda.
6. **Legível em miniatura.** A Carta aparece com 120 px de largura na estante. A silhueta principal tem que ser lida nesse tamanho: um gesto, uma forma forte, contraste entre figura e fundo. Toda Carta aprovada passa pelo teste de 120 px (seção 6.5).
7. **Placa de título é da interface.** A imagem não tem texto nenhum. O terço inferior fica calmo (gramado, piso, gelo, névoa, gradiente) para a interface desenhar a placa de título por cima, nos três idiomas, com a fonte do estilo.
8. **Nada de compra, sorte ou aposta na imagem.** Sem fichas, dados, roleta, cifrão, carrinho, cofre, vitrine de loja, raspadinha, pacote fechado. A raridade se mostra pela moldura, não por "tesouro".

## 2. Sistema visual: cinco estilos

O estilo é uma única frase em inglês que entra em todo prompt na terceira posição (seção 6.1). O estilo **E · Galaxie (galáctico)** é o padrão do Catálogo desde 16/11, decidido pelo dono depois do lote 0; A, B, C e D são alternativas. A frase do E está em todos os `art_prompt`; trocar de estilo é trocar essa frase (seção 7). Trocar de estilo é trocar essa frase (seção 7).

| | A · Vetor plano | B · Pôster retrô serigrafado | C · Holográfico noturno | D · Aquarela esportiva | E · Galaxie (galáctico, padrão) |
| --- | --- | --- | --- | --- | --- |
| Leitura em 120 px | excelente | muito boa | boa (depende do contraste do glow) | média (lavagem reduz contraste) | boa (silhueta clara sobre fundo escuro) |
| Consistência entre gerações | alta | alta | média | baixa a média | alta nas três peças do lote 0 |
| Custo de revisão humana | baixo | baixo | médio | alto | médio (constelações podem virar "texto") |
| Risco de texto escapar | baixo | médio (pôster "pede" letra) | baixo | baixo | baixo |
| Identidade | limpa, atual, app | nostalgia, álbum de figurinha clássico | game, premium, noite de jogo | editorial, emocional | marca Galaxie, épico, colecionável |

### 2.1 Estilo A · Vetor plano

**Descrição.** Ilustração vetorial plana, formas grandes e simplificadas, bordas limpas, sem contorno preto, sombras em um único tom mais escuro, grão de papel sutil sobre tudo. Lembra cartaz de evento esportivo moderno e ícone de app: lê-se de longe, envelhece bem, sai consistente do gerador.

**Paleta (cena, nunca uniforme).**

| Papel | Hex | Uso |
| --- | --- | --- |
| Creme | `#F4EFE6` | fundo claro, céu de dia, piso |
| Carvão | `#23262B` | uniforme escuro, sombras, noite |
| Verde-gramado | `#2E7D5B` | campo, quadra, área calma do terço inferior |
| Âmbar | `#E8A33D` | luz de refletor, bola, acento único |
| Azul-petróleo | `#2B4C7E` | céu de fim de tarde, arquibancada, água |

O branco do uniforme claro é o sexto tom neutro; o gerador entende `limited five-color palette` como "poucas cores", não como contagem exata.

**Tipografia da placa de título (interface).** Archivo Black para o nome da Carta; Archivo (regular) para a raridade e o verso. Caixa alta no nome, tracking +2%.

**Textura.** Grão de papel fino e uniforme (opacidade 8 a 12%), sem rasgo, sem dobra.

**Iluminação.** Uma fonte só, direcional, sombra chapada em um tom. Refletores como formas geométricas (cones de luz), nunca como flare fotográfico.

**Frase padrão de estilo (copiada de padronizacao.md, literal):**

```
Flat vector illustration, bold simplified shapes, clean edges, limited five-color palette, subtle paper grain, strong silhouette readable at thumbnail size.
```

**Exemplo de prompt completo** (Carta `special`, gol nos acréscimos, Degrau 2):

```
A lone attacker in a plain white kit frozen mid-air just after striking a generic ball, the ball leaving the frame at the top right, two defenders in plain charcoal kits caught flat-footed behind her, a half-full terrace of simplified silhouettes under a dusk sky, floodlights as geometric cones of amber light, long shadows across the grass, the lower part of the pitch left as a calm flat green. Vertical trading card, 3:4, subject centered, calm area at the bottom third for the title plate. Flat vector illustration, bold simplified shapes, clean edges, limited five-color palette, subtle paper grain, strong silhouette readable at thumbnail size. Card frame: brushed steel-blue border with a thin inner line.
```

### 2.2 Estilo B · Pôster retrô serigrafado

**Descrição.** Pôster de jogo impresso em serigrafia nos anos 60 e 70: três ou quatro camadas de tinta chapada, leve desalinhamento entre elas, sombra em retícula (halftone), papel pardo com textura grossa. O charme é a imperfeição controlada; o risco é o gerador querer escrever "título" no pôster, por isso o negative ganha `poster text, headline, typography`.

**Paleta.**

| Papel | Hex | Uso |
| --- | --- | --- |
| Papel pardo | `#E8DCC4` | fundo, "não impresso" |
| Azul-marinho de tinta | `#1F3A5F` | camada principal, silhuetas, noite |
| Tijolo | `#B8453A` | acento, bola, pequena área de energia |
| Mostarda | `#D9A441` | luz, céu de tarde, piso |
| Fumaça | `#6B6B6B` | retícula, sombra, multidão |

Marinho e tijolo nunca aparecem juntos num uniforme (os uniformes seguem brancos e carvão; aqui o carvão vira a tinta marinho escura, o branco vira o papel pardo "em reserva").

**Tipografia da placa de título.** Bebas Neue para o nome; Oswald (light) para raridade e verso. Pode ter um filete duplo acima e abaixo do nome, como rótulo antigo.

**Textura.** Papel grosso com fibras visíveis; retícula de pontos de 45° nas meias-tintas; desalinhamento de 1 a 2 px entre camadas.

**Iluminação.** Sem gradiente contínuo: luz e sombra são duas tintas; o meio-tom é retícula.

**Frase padrão de estilo (substitui a do A em todos os prompts):**

```
Retro screen-printed poster illustration, three to four flat ink layers with slight misregistration, halftone shading, coarse kraft paper texture, strong silhouette readable at thumbnail size.
```

**Exemplo de prompt completo** (Carta `rare`, virada no último quarto, basquete):

```
A tall woman in a plain charcoal kit rising for a layup over a defender in a plain white kit, a generic ball at her fingertips, the hardwood court rendered in two flat ink tones, the crowd as a single halftone band standing up, the scoreboard replaced by an abstract balance bar tipping from one side to the other, the near court left as a calm flat mustard area. Vertical trading card, 3:4, subject centered, calm area at the bottom third for the title plate. Retro screen-printed poster illustration, three to four flat ink layers with slight misregistration, halftone shading, coarse kraft paper texture, strong silhouette readable at thumbnail size. Card frame: deep violet border with faceted corners and a faint glow.
```

### 2.3 Estilo C · Holográfico noturno

**Descrição.** Noite de jogo vista como lâmina holográfica: fundo quase preto, figuras recortadas por luz de borda (rim light) em ciano e magenta, brilho suave e bloom contido, formas limpas por baixo do neon. Combina com a moldura lendária (prismática) e com Conquistas de madrugada e coruja; é o estilo que mais "parece game".

**Paleta.**

| Papel | Hex | Uso |
| --- | --- | --- |
| Noite | `#0B0F1A` | fundo |
| Ciano | `#2EE6D6` | rim light principal, gelo, linhas de quadra |
| Magenta | `#FF4FA3` | rim light secundário, energia, bola |
| Violeta | `#7C5CFF` | glow difuso, arquibancada |
| Branco-gelo | `#E9F1FF` | uniforme claro, pontos de luz |

**Tipografia da placa de título.** Chakra Petch (semibold) para o nome; Space Grotesk para raridade e verso. Sem brilho na tipografia: a placa continua chapada e legível.

**Textura.** Lisa, com leve ruído de sinal (scanlines a 3% de opacidade, opcional). Sem grão de papel.

**Iluminação.** Duas fontes de borda opostas (ciano de um lado, magenta do outro), fundo sem luz de preenchimento; o terço inferior é um gradiente escuro para a placa.

**Frase padrão de estilo:**

```
Holographic night-scene illustration, dark background with cyan and magenta neon rim light, soft glow and restrained bloom, clean simplified shapes, strong silhouette readable at thumbnail size.
```

**Exemplo de prompt completo** (Carta `legendary`, gol na prorrogação do time do coração numa final, hóquei):

```
A skater in a plain white kit sliding on one knee in celebration with the stick raised, a generic puck resting in the net behind, teammates in plain white kits rushing in as glowing silhouettes, a late-night arena with the few remaining fans on their feet as dark shapes, cyan rim light tracing the ice and magenta light on the glass, the lower ice left as a calm dark gradient. Vertical trading card, 3:4, subject centered, calm area at the bottom third for the title plate. Holographic night-scene illustration, dark background with cyan and magenta neon rim light, soft glow and restrained bloom, clean simplified shapes, strong silhouette readable at thumbnail size. Card frame: iridescent prismatic border with light rays and floating particles.
```

### 2.4 Estilo D · Aquarela esportiva

**Descrição.** Ilustração editorial em aquarela solta: lavagens úmido-sobre-úmido com sangramento controlado, esboço a lápis visível por baixo, branco do papel em reserva para a luz. O mais emocional dos quatro, bom para Cartas de resultado e de fidelidade; o mais difícil de manter consistente e o que mais perde contraste em 120 px, então a silhueta central precisa de um tom escuro firme.

**Paleta.**

| Papel | Hex | Uso |
| --- | --- | --- |
| Papel | `#FBF8F2` | reserva de branco, luz, uniforme claro |
| Índigo lavado | `#3C4F76` | silhuetas, uniforme escuro, sombra |
| Terracota | `#C9704A` | bola, pele em contraluz, acento |
| Sálvia | `#7E9C7A` | gramado, quadra, área calma |
| Grafite | `#4A4A4A` | lápis, contorno, multidão |

**Tipografia da placa de título.** Playfair Display (semibold) para o nome; Lora (italic) para raridade e verso.

**Textura.** Papel de aquarela de grão médio; bordas das manchas com "flor" de pigmento; lápis em 30% de opacidade.

**Iluminação.** Natural, difusa; a luz é o papel sem tinta, nunca branco pintado por cima.

**Frase padrão de estilo:**

```
Loose sports watercolor illustration, wet-on-wet washes with controlled bleeding, visible pencil underdrawing, white paper reserve for highlights, strong silhouette readable at thumbnail size.
```

**Exemplo de prompt completo** (Carta `historic`, bloqueio decisivo no quinto set, vôlei feminino):

```
Two women in plain white kits forming a wall at the net with arms fully extended, a generic ball crushed against their hands, an attacker in a plain charcoal kit landing below them, the sports hall dissolving into loose indigo and sage washes, afternoon sunlight through high windows left as white paper, the floor fading into a calm pale wash. Vertical trading card, 3:4, subject centered, calm area at the bottom third for the title plate. Loose sports watercolor illustration, wet-on-wet washes with controlled bleeding, visible pencil underdrawing, white paper reserve for highlights, strong silhouette readable at thumbnail size. Card frame: warm amber border with an engraved laurel pattern and a soft outer glow.
```

### 2.5 Estilo E · Galaxie (galáctico, padrão)

**Descrição.** O mesmo desenho de formas simplificadas do estilo A, com o cenário levado ao espaço: o campo ou a quadra flutuam como uma plataforma, a arquibancada se dissolve em campo de estrelas, os refletores viram pequenos sóis, e linhas de constelação acompanham o gesto do atleta. É o estilo que conversa com o nome Galaxie e o que mais diferencia o produto numa demonstração; **é o padrão do Catálogo desde 16/11**, e a frase dele está em todos os `art_prompt`. Provado em 16/11 no lote 0 (Degraus 1, 3 e 5 de "Gol nos acréscimos"): leu bem em miniatura, manteve a progressão e não deixou texto escapar; a moldura lendária prismática combinou melhor com ele do que com o A.

**Paleta.**

| Papel | Hex | Uso |
| --- | --- | --- |
| Espaço profundo | `#0B1026` | fundo, arquibancada ao longe |
| Nebulosa índigo | `#2E2A7A` | gradiente do céu, sombra |
| Nebulosa violeta | `#7A3FB0` | gradiente do céu, brilho secundário |
| Luz estelar | `#F4F1E6` | uniformes, estrelas, constelações |
| Âmbar solar | `#F2B544` | refletores, raios do gol, cometa |

**Tipografia da placa de título.** Space Grotesk (semibold) para o nome; Inter para raridade e verso.

**Textura.** Grão fino de filme; estrelas em três tamanhos; constelações como linhas finas com nós brilhantes.

**Iluminação.** Luz vinda do gol ou dos refletores-sóis, contraluz na silhueta; o gramado conserva um verde-petróleo para o olho reconhecer o esporte.

**Frase padrão de estilo:**

```
Cosmic illustration style: deep-space backdrop with nebula gradients in indigo and violet, dense star field, soft glowing constellation lines tracing the action, bold simplified shapes with clean edges, subtle film grain, strong silhouette readable at thumbnail size.
```

**Como adaptar a cena.** A cena da Carta não muda; acrescentam-se à primeira frase os ganchos espaciais ("the pitch floating as a glowing platform in deep space", "stands fading into a star field", "floodlights shaped like small suns", "a spiral galaxy behind the stadium"). No Lendário, raios do gol "like a supernova" e o relógio "made of stars dissolving into stardust".

**Exemplo de prompt completo** (Carta `common`, gol nos acréscimos, Degrau 1):

```
A lone stylized striker in a plain white kit sliding on one knee after scoring, generic ball resting in the net behind, the pitch floating as a glowing platform in deep space, a half-empty generic stand fading into a star field, a tall blank scoreboard silhouette with no digits. Vertical trading card, 3:4, subject centered, calm area at the bottom third for the title plate. Cosmic illustration style: deep-space backdrop with nebula gradients in indigo and violet, dense star field, soft glowing constellation lines tracing the action, bold simplified shapes with clean edges, subtle film grain, strong silhouette readable at thumbnail size. Card frame: plain slate-grey border, matte finish.
```

## 3. Molduras por raridade

A moldura é o que o torcedor lê sem ler: cinco raridades, cinco materiais, cinco níveis de luz. A frase de cada uma é a de padronizacao.md e não muda com o estilo; o que o estilo faz é renderizar o mesmo material do seu jeito.

| Raridade | Frase padrão (literal) | Cor base | Material | Cantos | Brilho | Partículas |
| --- | --- | --- | --- | --- | --- | --- |
| `common` | `Card frame: plain slate-grey border, matte finish.` | ardósia `#6B7280` | fosco, chapado | retos, raio pequeno | nenhum | nenhuma |
| `special` | `Card frame: brushed steel-blue border with a thin inner line.` | azul-aço `#4F7CAC` | metal escovado | retos, chanfro mínimo | nenhum | nenhuma |
| `rare` | `Card frame: deep violet border with faceted corners and a faint glow.` | violeta `#5B2A86` | lapidado | facetados (corte em 45°) | leve, interno | nenhuma |
| `historic` | `Card frame: warm amber border with an engraved laurel pattern and a soft outer glow.` | âmbar `#D08A1B` | metal gravado com louro | retos com gravura | suave, externo | nenhuma |
| `legendary` | `Card frame: iridescent prismatic border with light rays and floating particles.` | prisma `#7CF5FF` → `#B98CFF` → `#FFD36E` → `#FF8FB1` | iridescente | retos, com raios saindo dos cantos | forte, externo com raios | poucas e grandes |

Espessura da borda: 4% da largura da Carta (cerca de 5 px em 120 px, 38 px em 960 px). Em `legendary`, os raios e as partículas ficam **fora** da borda, no fundo da imagem, para não comer a área da cena. Pedir no prompt, quando o gerador exagerar: `few large particles, rays only at the corners`.

### 3.1 Selo de raridade

Um ícone abstrato por raridade, sem texto, desenhado **pela interface** (vetor), no canto superior direito, sobre a moldura. Ele não entra no prompt: assim fica idêntico em todas as Cartas e não depende do gerador.

| Raridade | Selo | Forma |
| --- | --- | --- |
| `common` | Ponto | círculo cheio |
| `special` | Losango | losango com linha interna |
| `rare` | Gema | estrela de quatro pontas facetada |
| `historic` | Louro | anel de louro aberto em cima |
| `legendary` | Prisma | estrela de cinco pontas com três raios |

Cor do selo: a cor base da moldura sobre fundo escuro semitransparente. Tamanho: 10% da largura da Carta.

### 3.2 Como cada estilo renderiza a moldura

- **A (vetor plano):** borda em dois tons chapados (cor base e um tom mais escuro no lado da sombra); o glow do `rare` e do `historic` vira um halo chapado de um tom; os raios do `legendary` são triângulos finos.
- **B (pôster):** borda como mais uma camada de tinta, com o mesmo desalinhamento; o glow vira retícula clara em volta; a gravura de louro do `historic` fica em linha fina de uma tinta; o prisma do `legendary` são as quatro tintas em faixas.
- **C (holográfico):** o estilo nasce para isso: o glow é real, o `legendary` ganha bloom; cuidado para o `common` e o `special` **não** brilharem (acrescentar `matte, no glow on the frame` quando escapar).
- **D (aquarela):** a moldura é sempre **nítida**, nunca lavada: é o único elemento da Carta que não é aquarela, para a raridade continuar legível. Acrescentar `crisp solid card frame, not painted` quando o gerador dissolver a borda.

## 4. Composição das Cartas

### 4.1 Formato e áreas

- Proporção **3:4 vertical**. Master em 1920 × 2560 px; servir em 600 × 800, 300 × 400 e 120 × 160.
- **Área da cena:** os 70% superiores. O centro de massa da figura principal fica entre 35% e 50% da altura (um pouco acima do centro geométrico), horizontalmente centrado ou na regra dos terços.
- **Área calma:** os 30% inferiores. Tom contínuo e baixo contraste (gramado, piso, gelo, névoa, gradiente), sem figura, sem detalhe, sem linha forte. É onde a interface desenha a placa de título (fundo semitransparente da cor Carvão a 60%, texto na fonte do estilo). A frase `calm area at the bottom third for the title plate` já pede isso; se a cena invadir, cortar a figura pela cintura e empurrar o horizonte para cima.
- **Margem de segurança:** 6% em todos os lados, dentro da moldura; nada importante encosta na borda.
- **Horizonte:** sempre no terço superior ou no meio, nunca no terço inferior.

### 4.2 Enquadramento por tipo de Conquista

| Tipo | Enquadramento | Cena típica |
| --- | --- | --- |
| Momento com minuto (gol nos acréscimos, cartão, VAR) | **Ação congelada**: uma figura dominante no pico do gesto, plano médio, leve contra-plongée | o chute, o salto, o braço do árbitro erguido em silhueta, a bola saindo do quadro |
| Momento sem minuto (triple-double, no-hitter, volta mais rápida) | **Gesto síntese** do feito: a figura repetida em três fases, ou o objeto do feito em destaque | a rebatedora de costas com o taco baixo, três fantasmas da mesma jogadora, o carro cruzando a linha em faixa de luz |
| Resultado (vitória, virada, goleada, prorrogação) | **Celebração** (grupo de costas ou de perfil, braços erguidos) ou **placar abstrato** (duas barras, uma maior, sem dígito) | time abraçado visto de trás, barras de luz desequilibradas sobre a arquibancada |
| Participação (assistir, palpitar, votar) | **Torcedor na arquibancada**: de costas ou 3/4, cachecol liso, plano médio ou geral | uma pessoa de pé no meio de assentos vazios; mão erguida numa fileira cheia |
| Explorador (ligas, países, esportes) | **Mapa abstrato, estrada ou céu**: linhas de rota, bússola, horizonte com vários estádios como formas; **nunca** contorno de país real | estrada que cruza três horizontes, constelação de pontos ligados |
| Madrugador | **Céu de amanhecer**: gradiente frio para quente, luz baixa rasante, xícara de chá ou café é permitido, nada de bebida alcoólica | torcedor com cobertor na janela, campo com orvalho |
| Coruja | **Céu noturno**: lua, poucas estrelas, luz de tela ou abajur no rosto em silhueta | sofá no escuro com o brilho da tela, estádio apagado ao fundo com um refletor aceso |
| Conhecedor (trivia) | lousa com diagramas abstratos, livro aberto sem texto, prancheta tática com setas | |
| Comunidade (enquete, convite) | **Grupo**: três a cinco torcedores diversos, de costas, cachecóis lisos | |
| Consumo (resumo, escalação) | tela ou folha com blocos abstratos (nunca texto legível), mão segurando | |
| Colecionador | álbum aberto com retângulos em branco, estante de Cartas vistas de lado | |

### 4.3 As 5 Cartas de uma Conquista contam uma progressão

A mesma cena, o mesmo esqueleto de composição e a mesma seed; o que muda são cinco eixos, sempre nesta direção:

| Eixo | Bronze (1) | Prata (2) | Ouro (3) | Platina (4) | Lendário (5) |
| --- | --- | --- | --- | --- | --- |
| Escala | uma figura, plano médio | duas ou três figuras | grupo, plano geral | estádio inteiro | vista aérea ou do céu, o estádio como ponto de luz |
| Hora do dia | manhã, luz rasante | tarde | crepúsculo, refletores acendendo | noite sob refletores | noite profunda com raios de luz (ou aurora) |
| Multidão | arquibancada vazia ou treino | metade cheia | cheia | lotada, de pé | transbordando, bandeiras lisas ao vento |
| Intensidade | calma, gesto contido | movimento | pico do gesto | clímax com confete ou neve | épico, câmera baixa, silhueta contra a luz |
| Clima | céu limpo | nuvens leves | vento (bandeiras lisas, cabelo) | chuva ou confete | tempestade abrindo, névoa no chão |

Regra de escrita: o prompt do Degrau N é o do Degrau 1 com os cinco eixos trocados, nada mais. Assim o álbum lê como série e a geração em lote fica previsível. A moldura muda sozinha pela raridade (`common` → `special` → `special` → `rare` → `historic` ou `legendary`).

## 5. Cosméticos do Perfil

Os cosméticos seguem o mesmo estilo das Cartas (mesma frase de estilo, mesma paleta) e o mesmo negative padrão. Tudo se ganha por Nível, Coleção ou Conquista; nada na arte sugere compra.

### 5.1 Molduras de avatar (circulares)

Seis molduras por faixa de Nível, mais as especiais de Coleção completa e de Degrau Lendário. O anel ocupa os 12% externos de um quadrado 1024 × 1024 com fundo e centro transparentes; o avatar fica por baixo. Frase de enquadramento para molduras: `Circular avatar ring, 1:1, transparent background and empty transparent center, the ring occupies only the outer twelve percent of the canvas.` O negative ganha `face, portrait, person, photo in the center, filled center`.

| Faixa | Nome de trabalho | Visual | Animação |
| --- | --- | --- | --- |
| Níveis 1-2 | Arquibancada | anel fino de ardósia fosca, uma ranhura como assento | estática |
| Níveis 3-4 | Aço | anel de azul-aço escovado com linha interna fina | estática |
| Níveis 5-6 | Lapidada | anel violeta com oito facetas e halo interno leve | estática (halo fixo) |
| Níveis 7-8 | Louro | anel âmbar com gravura de louro e halo externo | **pulso**: o halo externo cresce de 0 a 6% do raio e volta, 3 s, ease-in-out |
| Nível 9 | Estelar | anel âmbar-claro com pequenas estrelas gravadas e halo | **órbita**: quatro partículas percorrem o anel em velocidades diferentes, 4 s por volta, sem piscar |
| Nível 10 | Prisma | anel iridescente com raios curtos nos quatro cantos | **varredura**: a faixa iridescente gira 360° em 4 s; as partículas da Estelar continuam |

Especiais: `frame.collection.<esporte>` (anel do material da raridade mais alta da Coleção, com o equipamento do esporte gravado em silhueta, estática) e `frame.legendary_step` (anel prismático com o ícone da Família gravado, com a varredura do Nível 10).

**Regras de animação** (valem para todas): loop curto de 2 a 4 s; só translação, rotação, escala e opacidade; variação de luminância no máximo 20% entre o quadro mais claro e o mais escuro; nunca mais de um ciclo por segundo; nada pisca, nada inverte cor; respeitar `prefers-reduced-motion` com a **versão estática** (o quadro do meio do loop, no brilho médio), que também é o fallback para clientes sem suporte e para o chat e o Ranking. Formato: anel estático em PNG com alfa (fonte da IA), animação feita pela interface sobre ele (CSS ou Lottie), nunca GIF gerado por IA.

### 5.2 Selos de Nível

Dez ícones, um tema genérico de esporte que sobe "do gramado às estrelas", desenhados como vetor pela interface no estilo escolhido (chapado em A, tinta em B, neon em C, aquarela com contorno firme em D). Cor do selo acompanha a moldura da faixa.

| Nível | Selo | Forma |
| --- | --- | --- |
| 1 | Bola | círculo com gomos abstratos |
| 2 | Ingresso | retângulo com picote, sem texto |
| 3 | Cachecol | faixa ondulada lisa |
| 4 | Assento | cadeira de arquibancada vista de frente |
| 5 | Bandeira | bandeira lisa ao vento, uma cor |
| 6 | Refletor | torre com cone de luz |
| 7 | Pódio | três blocos |
| 8 | Louro | coroa de louro fechada |
| 9 | Estrela | estrela de cinco pontas |
| 10 | Constelação | sete pontos ligados em forma de bola |

### 5.3 Planos de fundo do Perfil

Cena ampla, sem figura protagonista, gerada em **duas proporções** com a mesma seed e a cena recomposta (não recortada): 16:9 em 1920 × 1080 e 9:16 em 1080 × 1920. Frase de enquadramento: `Wide establishing scene, 16:9 (ou 9:16), no focal subject, calm low-detail area across the center for overlaid text, horizon in the upper third.`

- **Área calma central:** 60% da largura por 40% da altura, sem detalhe, sem alto contraste. É onde ficam o Apelido, o título e o Nível.
- **Teste de legibilidade:** com overlay preto a 40% sobre a imagem inteira, texto branco de 16 px na área central precisa de contraste de pelo menos 4,5:1. Se não passar, escurecer o centro no prompt (`darker, hazier center`) ou trocar a cena.
- **Cenas genéricas** (5): amanhecer sobre um campo vazio; refletores de um estádio vistos de fora, à noite; túnel de vestiário para a luz; chuva na arquibancada vazia; constelação sobre um gramado.
- **Por esporte** (3 cada): o lugar do esporte sem gente e sem marca (gelo recém-raspado; a reta de uma pista com o asfalto molhado; o octógono vazio sob um refletor; a quadra de areia ao pôr do sol). Nunca um estádio ou autódromo reconhecível; o negative ganha `recognizable venue, landmark, skyline`.

### 5.4 Títulos

Texto curto abaixo do Apelido, desenhado pela interface, nunca imagem. Tipografia: a fonte de corpo do estilo (Archivo, Oswald, Space Grotesk ou Lora), caixa alta, tamanho de legenda. A cor vem da raridade da Conquista que destrava o título:

| Raridade da Conquista | Cor do título | Detalhe |
| --- | --- | --- |
| `common` | ardósia `#6B7280` | nenhum |
| `special` | azul-aço `#4F7CAC` | nenhum |
| `rare` | violeta `#5B2A86` (claro no tema escuro: `#B98CFF`) | nenhum |
| `historic` | âmbar `#D08A1B` | um ponto de louro antes do texto |
| `legendary` | gradiente prismático **estático** | nenhum brilho, nenhuma animação |

### 5.5 Discrição no chat e no Ranking

No chat do jogo e nas listas do Ranking aparecem **só a moldura do avatar e o título**; nunca o plano de fundo, nunca a vitrine. A moldura usa a versão estática (sem pulso, órbita ou varredura); o título fica em tamanho de legenda, sem gradiente animado e sem brilho. A animação existe só na página do Perfil e no cabeçalho dele. O torcedor escolhe o que mostra, campo a campo, como já acontece com a privacidade do Perfil.

## 6. Receita de prompt

### 6.1 Ordem fixa

Todo `art_prompt` é uma sequência de frases separadas por ponto, nesta ordem, sem pular nenhuma:

1. **Cena**: o que acontece, quem (figuras com `plain white kit` ou `plain charcoal kit`), onde (lugar genérico), quando (hora do dia e clima, pelos eixos da seção 4.3), e a instrução do terço inferior calmo descrita na própria cena (`the lower part ... left as a calm flat ...`).
2. **Enquadramento**: `Vertical trading card, 3:4, subject centered, calm area at the bottom third for the title plate.`
3. **Estilo**: a frase padrão do estilo em uso (seção 2).
4. **Moldura**: a frase padrão da raridade da Carta (seção 3).

O validador procura a frase da moldura e o texto "vertical trading card"; o resto é revisão de gente.

### 6.2 Negative prompt

Padrão (literal; pode acrescentar, nunca tirar):

```
logos, crests, badges, brand names, sponsor marks, readable text, letters, numbers, jersey numbers, recognizable faces, real athletes, real stadiums, club colors, national flags, watermark, blurry, extra limbs, deformed hands
```

Acréscimos por caso, sempre depois do padrão, separados por vírgula:

| Caso | Acrescentar |
| --- | --- |
| MMA | `blood, bruises, injuries, pain, strike landing on the face` |
| Explorador com mapa | `real map, country outlines, borders, place names` |
| Torcedor na arquibancada | `banners with writing, flags with symbols, beer, cups` |
| Estilo B | `poster text, headline, typography, logo lockup` |
| Estilo C | `glow on common or special frame` |
| Estilo D | `washed-out frame, painted border` |
| Fundos | `recognizable venue, landmark, skyline, people in the center` |
| Molduras de avatar | `face, portrait, person, photo in the center, filled center` |

### 6.3 Parâmetros sugeridos por tipo de gerador

Sem citar produto: o que importa é a família de controle que o gerador oferece.

| Tipo de gerador | Proporção e tamanho | Seed e consistência | Outros |
| --- | --- | --- | --- |
| Difusão com seed, CFG e passos expostos | Cartas 960 × 1280 (3:4 exato), depois upscale 2× para 1920 × 2560; fundos 1920 × 1080 e 1080 × 1920; molduras 1024 × 1024 com alfa; selos 512 × 512 | **seed fixa por Coleção** (um inteiro derivado do id da Coleção, registrado em `cartas/colecoes.json` ou no script de geração); mesma seed para as 5 Cartas de uma Conquista | CFG 5 a 7; 30 a 40 passos; o negative no campo próprio; imagem de referência de estilo = a primeira Carta aprovada da Coleção, peso médio |
| Prompt em linguagem natural, sem seed exposta | pedir `3:4 vertical`; tamanho máximo que o gerador der, depois redimensionar | usar a primeira Carta aprovada da Coleção como **imagem de referência** em toda geração seguinte e repetir o prompt palavra por palavra | pedir `no text anywhere in the image` no fim do prompt, porque esses geradores tendem a ignorar negative |
| Gerador com "código de estilo" ou referência de estilo persistente | igual à linha de cima | criar um código por estilo (A, B, C, D) a partir das Cartas-ouro (seção 7) e reutilizar | |

Geração em lote: por Coleção, na ordem dos `card_key`, Degrau 1 ao 5, para a progressão sair da mesma seed. Guardar o prompt exato usado, a seed e o gerador junto do arquivo (nome `<card_key>.png` e `<card_key>.json` ao lado).

### 6.4 Entrega de arquivos

- Carta: master PNG 1920 × 2560; derivados WebP 600 × 800, 300 × 400 e 120 × 160 (qualidade 85).
- Fundo: PNG 1920 × 1080 e 1080 × 1920; derivados WebP.
- Moldura de avatar: PNG 1024 × 1024 com alfa; a interface anima.
- Selo: SVG (desenhado), com PNG 512 × 512 de apoio.
- Nome: `<card_key>.<ext>`, `<id do cosmético>.<ext>`; nunca espaço nem acento.

### 6.5 Orçamento: o que gerar, quando, e o que nunca gerar

Medido em 16/11 (lote 0): o modelo que entrega o estilo custa **50 créditos por Carta em 1k** (Nano Banana 2.1 ou Flux.2 Pro; o Auto cobra 65; 2k cobra 65). Os modelos baratos foram testados e não servem: Flux.2 Klein (10 créditos) escreveu texto inventado na placa de título, e Flux.1 Fast (5) ignorou o estilo e a moldura. A economia vem do escopo, não do modelo.

| Conjunto | Cartas | Créditos a 50 |
| --- | --- | --- |
| Catálogo inteiro | 1.172 | 58,6 mil |
| Só Conquistas ativas, sem prompt repetido (basquete e NBA compartilham 63 cenas) | cerca de 960 | cerca de 48 mil |
| MVP do #910 (comuns, futebol, basquete, futebol americano), ativas | 352 | 17,6 mil |
| Comuns e futebol, ativas | 198 | 9,9 mil |
| Conjunto de demonstração (7 Cartas-ouro + uma Coleção inteira do futebol) | cerca de 25 | cerca de 1,3 mil |

**Portões (cada um com o OK do dono e o número de créditos escrito na issue #1283 antes de rodar):**

1. **Agora:** só as 7 Cartas-ouro no estilo Galaxie (cerca de 350). Nada mais até o widget da estante existir.
2. **Quando a estante (#919, #926) mostrar Carta sem arte com um placeholder por raridade:** o conjunto de demonstração (cerca de 1,3 mil). O produto roda com placeholder; a arte entra por esporte, à medida que os clientes pedirem.
3. **Quando o motor conceder os momentos do futebol (fase 2) e a fase 0 estiver respondida:** comuns e futebol ativas (9,9 mil). Antes disso as decisões do dono ainda podem mudar Carta única em cinco Degraus ou tirar uma família inteira.
4. **Por esporte, quando os fatos dele estiverem no motor e houver cliente para ele:** 60 a 90 Cartas por pacote (3 a 4,6 mil); basquete e NBA juntos aproveitam as 63 cenas iguais.

**Nunca:** Carta de Conquista inativa (143 Cartas, 7,2 mil créditos jogados fora); o Catálogo inteiro de uma vez; o Catálogo regerado na paleta de um prospect (seção 7.1); moldura por IA depois que a interface passar a desenhá-la (a moldura desenhada pela interface elimina a maior causa de regeração e permite o tema do cliente gratuito).

**Reserva de regeração:** 15% do lote. Lote que estourar para, e o motivo (texto escapando, cor de clube, mão deformada) volta para o prompt antes de continuar. Gasto real anotado na #1283 a cada lote.

### 6.6 Checklist de revisão humana (cada imagem, antes de aprovar)

Olhar o master e depois a versão de 120 px.

- [ ] **Texto escapou?** Qualquer letra, número, placar, nome em faixa, marca em bola ou chuteira. Reprovar.
- [ ] **Logo ou escudo?** Inclusive "inventado" que lembre um real, e inclusive na moldura. Reprovar.
- [ ] **Rosto reconhecível?** Se dá para dizer "parece fulano", reprovar; se o rosto tem identidade clara, pedir de costas ou em contraluz.
- [ ] **Cor de clube?** Uniforme com duas cores vivas, listra, faixa, ou branco e carvão com acento que lembra clube. Reprovar.
- [ ] **Lugar reconhecível?** Arquibancada, arco, fachada ou pista que lembre estádio ou autódromo real. Reprovar.
- [ ] **Bandeira nacional ou mapa real?** Reprovar.
- [ ] **Gesto violento, sangue, dano, álcool?** Reprovar (MMA: só gesto esportivo).
- [ ] **Diversidade na série?** Nas 5 Cartas da Conquista, gênero, tom de pele e tipo físico variam; esporte feminino presente na Coleção.
- [ ] **Terço inferior calmo?** Nada importante atrás da placa; simular a placa (faixa escura a 60% com o nome) e conferir.
- [ ] **Lê em 120 px?** A silhueta e a moldura se distinguem; dá para dizer a raridade sem o selo.
- [ ] **Moldura certa?** Material e cor batem com a raridade do `card_key`; em A, B e D não há glow em `common` e `special`.
- [ ] **Progressão?** Lado a lado, as 5 Cartas sobem nos cinco eixos e parecem a mesma cena.
- [ ] **Anatomia?** Mãos, membros, equipamento (bola com gomos coerentes, taco, stick, capacete) sem deformação.
- [ ] **Validador:** o `art_prompt` passou em `node docs/gamificacao/catalogo/_validar.mjs`. A lista de entidades do validador casa por **prefixo**: palavras como `interval`, `intermission`, `international`, `olympic`, `bullseye`, `warriors`, `cowboys` geram aviso; trocar por sinônimo em vez de ignorar o aviso.

## 7. Como trocar de estilo

A troca é uma decisão do dono e vale para o Catálogo inteiro; não há Carta em estilo diferente das outras.

**O que muda:**

1. A **frase de estilo** (posição 3 de todo `art_prompt`): busca e troca da frase exata do estilo antigo pela do novo, em `cartas/*.json` e em `cosmeticos/molduras.json` e `cosmeticos/fundos.json`. É uma substituição literal de uma linha.
2. Os **acréscimos de negative** do estilo (tabela da seção 6.2), se houver.
3. Na interface: a **fonte da placa de título** e as cores de interface (placa, selo, títulos) se o dono quiser alinhar à paleta do novo estilo. As cores das molduras por raridade (seção 3) ficam as mesmas: só o acabamento muda com o estilo.
4. A **imagem de referência** de cada Coleção, que precisa ser regerada.

**O que não muda:** a cena de cada Carta, a frase de enquadramento, as cinco frases de moldura, o negative padrão, a raridade, a seed por Coleção, as regras de composição e de progressão, as regras de animação das molduras de avatar, as descrições dos selos e dos títulos, e a regra de discrição no chat e no Ranking.

**Processo:**

1. Gerar as **Cartas-ouro** do novo estilo: uma Carta por raridade (uma `common`, uma `special`, uma `rare`, uma `historic`, uma `legendary`), mais um fundo 16:9 e a moldura de avatar do Nível 10: sete peças. Passar o checklist da seção 6.5 em cada uma, inclusive o teste de 120 px.
2. Aprovação do dono com as Cartas-ouro lado a lado com as do estilo atual, em 600 px e em 120 px.
3. Substituir a frase em todos os arquivos, rodar o validador, regerar por Coleção na ordem dos `card_key`, revisar por amostragem (toda `legendary` e `historic`, uma em cada cinco das outras).
4. Publicar o Catálogo inteiro de uma vez; não misturar estilos na estante.

Para testar um estilo sem decidir, gerar só as Cartas-ouro: custa poucas imagens e mostra a diferença real.

### 7.1 Tema do cliente: a paleta como parâmetro

Além do estilo, cada programa pode ter a arte nas **cores do cliente** (operadora, emissora, app). É o caminho de "arte própria do cliente" da #924 e um argumento de venda: a mesma estante aparece na identidade visual de quem a oferece. Provado em 16/11 com a Carta Bronze de "Gol nos acréscimos" em três paletas (preto com acento carmesim; violeta a índigo com brilho magenta; azul-marinho com ciano elétrico), a partir do mesmo prompt e da mesma seed.

**Como funciona.** A paleta entra como uma frase a mais no prompt, logo depois da frase de estilo e antes da moldura:

```
Client palette: <fundo e arquibancada>, <piso>, every light, accent and glow in <cor de destaque>, white kit as the only other color.
```

A cena, o enquadramento, o estilo, a moldura e o negative não mudam. O estilo Galaxie aceita a troca das duas cores de nebulosa pela paleta do cliente (o fundo escuro fica); o A aceita qualquer paleta.

**Regras.**

1. **Só cores, nunca marca.** Nenhum logotipo, nome, slogan ou tipografia do cliente entra no prompt nem na imagem; a identidade é a paleta. O negative padrão continua.
2. **A paleta do cliente não fica neste repositório.** Nomes de clientes e suas cores ficam no cadastro do programa (`game.program`, campo de tema, a criar na issue de cosméticos) ou no Brand Kit do Magnific; aqui só o mecanismo e exemplos por cor.
3. **Tema do cliente em dois níveis, pelo custo.** O nível padrão é **gratuito**: a arte neutra do Catálogo com a interface (moldura, placa de título, fundo da estante, selo) nas cores do cliente, configurada no programa. O nível completo, a arte inteira regerada com a frase de paleta, custa o Catálogo de novo (cerca de 50 mil créditos) e **só se faz com contrato assinado e esse custo no preço**; nunca por prospecção. Não se mistura Carta neutra com Carta temática na mesma estante.
4. **Para venda, só as Cartas-ouro.** Para um prospect concreto (proposta em andamento), as sete peças da seção 7 na paleta dele, cerca de 350 créditos; nada além disso antes do contrato.
5. **Moldura por raridade.** Com paleta escura, a moldura `common` (cinza fosco) perde leitura; a segunda rodada (seção 8) resolve com a moldura desenhada pela interface.
6. **Produção com Brand Kit.** Para o cliente real, o Brand Kit do Magnific com o modelo Magnific One aplica a paleta de forma mais fiel do que a frase; a frase serve para a demonstração e para gerar em outros modelos.

## 8. Pontos em aberto para o dono

- A moldura é hoje desenhada pela IA (a frase está no prompt). Isso mantém a coerência da padronização e passa no validador, mas a largura e o acabamento da borda variam de geração para geração, e em 120 px a diferença entre `rare` e `historic` pode ficar sutil. Recomendação para uma segunda rodada: a interface desenhar também a moldura em vetor por cima da imagem (como já faz com a placa e o selo), mantendo a frase no prompt para o fundo "combinar". Nada muda nos arquivos.
- A frase de enquadramento diz `subject centered`; este guia lê isso como centrado na horizontal, com o centro de massa um pouco acima do centro para liberar o terço inferior. Se a leitura for outra, ajustar a seção 4.1, não a frase.
