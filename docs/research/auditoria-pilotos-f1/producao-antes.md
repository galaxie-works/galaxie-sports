# Auditoria dos perfis de piloto da F1

Gerado em 2026-10-24T20:58:26.699Z · produção, código 0084176 (main), antes · F1DB v2026.17.0 · temporada atual 2026 (faltam 6 GPs) · idioma pt-BR

- Pilotos com ao menos um GP no F1DB: 792; auditados: 792; prioritários (grid 2026, campeões, top 20 em vitórias e em GPs): 64.
- Problemas: 2510 em 785 pilotos.

## Placar por campo

| Campo | Errados (todos) | Errados (prioritários) | ↗ De outras frentes | Observação |
|---|---:|---:|---:|---|
| País e nacionalidade | 3 de 792 | 1 de 64 | 151 |  |
| Nascimento (data, local e país) | 3 de 792 | 1 de 64 | 155 |  |
| Número permanente | 0 de 792 | 0 de 64 |  |  |
| Número da temporada selecionada | 15 de 792 | 0 de 64 |  |  |
| Títulos mundiais (quantidade e anos) | 0 de 792 | 0 de 64 |  |  |
| GPs disputados | 238 de 792 | 47 de 64 |  |  |
| Vitórias | 4 de 792 | 2 de 64 |  |  |
| Pódios | 14 de 792 | 5 de 64 |  |  |
| Poles | 13 de 792 | 10 de 64 |  |  |
| Pontos | 0 de 792 | 0 de 64 |  |  |
| Melhor resultado (com contagem) | 14 de 792 | 2 de 64 |  |  |
| Abandonos | 32 de 792 | 13 de 64 |  |  |
| Equipe da temporada selecionada | 4 de 792 | 0 de 64 |  |  |
| Cor da equipe (curadoria e contraste) | 2 de 792 | 0 de 64 |  |  |
| Pintura da época sem curadoria | 0 de 792 | 0 de 64 | 376 | fora do escopo: lacuna do liveries.yaml (curadoria com fonte e revisão), não erro de código |
| Campanha da temporada atual | 0 de 792 | 0 de 64 |  |  |
| Retrato | 0 de 792 | 0 de 64 | 748 | fora do escopo: retrato mais recente: sessão "Fotos da F1 para o grid atual" |
| Fundo do heading | 0 de 792 | 0 de 64 | 737 | fora do escopo: fotos do grid de 2026 e fallback do carro: sessão "Fotos da F1 para o grid atual" |
| Nome (primeiro nome e sobrenome) | 1 de 792 | 1 de 64 |  |  |

## Problemas

| Piloto | Prioridade | Campo | Valor atual | Valor certo | Fonte |
|---|---|---|---|---|---|
| Stirling Moss (`stirling-moss`) | top 20 vitórias | GPs disputados | 67 | 66 | F1DB v2026.17.0 (driver.total_race_starts) |
| Stirling Moss (`stirling-moss`) | top 20 vitórias | Vitórias | 15 | 16 | F1DB v2026.17.0 (driver.total_race_wins) |
| Stirling Moss (`stirling-moss`) | top 20 vitórias | Pódios | 21 | 24 | F1DB v2026.17.0 (driver.total_podiums) |
| Stirling Moss (`stirling-moss`) | top 20 vitórias | Abandonos | 31 | 27 | F1DB v2026.17.0 (race_data RACE_RESULT position_text = 'DNF') |
| Stirling Moss (`stirling-moss`) | top 20 vitórias | Melhor resultado (com contagem) | 1º (x15) | 1º (x16) | F1DB v2026.17.0 (race_data RACE_RESULT) |
| Carlos Sainz Jr. (`carlos-sainz-jr`) | grid 2026, top 20 GPs | GPs disputados | 249 | 246 | F1DB v2026.17.0 (driver.total_race_starts) |
| Carlos Sainz Jr. (`carlos-sainz-jr`) | grid 2026, top 20 GPs | Poles | 5 | 6 | F1DB v2026.17.0 (driver.total_pole_positions) |
| Carlos Sainz Jr. (`carlos-sainz-jr`) | grid 2026, top 20 GPs | Abandonos | 41 | 40 | F1DB v2026.17.0 (race_data RACE_RESULT position_text = 'DNF') |
| Carlos Sainz Jr. (`carlos-sainz-jr`) | grid 2026, top 20 GPs | Nome (primeiro nome e sobrenome) | Carlos Sainz \| Jr | Carlos \| Sainz Jr. | F1DB v2026.17.0 (driver.name e last_name) |
| Charles Leclerc (`charles-leclerc`) | grid 2026 | País e nacionalidade | — | MC Mônaco | F1DB v2026.17.0 (driver.nationality_country_id = Monaco) |
| Charles Leclerc (`charles-leclerc`) | grid 2026 | Nascimento (data, local e país) | 1997-10-16 · Monte Carlo ·  | 1997-10-16 · Monte Carlo · MC | F1DB v2026.17.0 (driver.date_of_birth, place_of_birth, country_of_birth) |
| Charles Leclerc (`charles-leclerc`) | grid 2026 | GPs disputados | 190 | 188 | F1DB v2026.17.0 (driver.total_race_starts) |
| Charles Leclerc (`charles-leclerc`) | grid 2026 | Poles | 24 | 27 | F1DB v2026.17.0 (driver.total_pole_positions) |
| George Russell (`george-russell`) | grid 2026 | Poles | 11 | 12 | F1DB v2026.17.0 (driver.total_pole_positions) |
| George Russell (`george-russell`) | grid 2026 | Abandonos | 18 | 17 | F1DB v2026.17.0 (race_data RACE_RESULT position_text = 'DNF') |
| Arvid Lindblad (`arvid-lindblad`) | grid 2026 | GPs disputados | 17 | 16 | F1DB v2026.17.0 (driver.total_race_starts) |
| Juan Manuel Fangio (`juan-manuel-fangio`) | campeão, top 20 vitórias | Vitórias | 22 | 24 | F1DB v2026.17.0 (driver.total_race_wins) |
| Juan Manuel Fangio (`juan-manuel-fangio`) | campeão, top 20 vitórias | Pódios | 31 | 35 | F1DB v2026.17.0 (driver.total_podiums) |
| Juan Manuel Fangio (`juan-manuel-fangio`) | campeão, top 20 vitórias | Abandonos | 12 | 10 | F1DB v2026.17.0 (race_data RACE_RESULT position_text = 'DNF') |
| Juan Manuel Fangio (`juan-manuel-fangio`) | campeão, top 20 vitórias | Melhor resultado (com contagem) | 1º (x22) | 1º (x24) | F1DB v2026.17.0 (race_data RACE_RESULT) |
| Lando Norris (`lando-norris`) | grid 2026, campeão | GPs disputados | 169 | 168 | F1DB v2026.17.0 (driver.total_race_starts) |
| Lando Norris (`lando-norris`) | grid 2026, campeão | Abandonos | 13 | 12 | F1DB v2026.17.0 (race_data RACE_RESULT position_text = 'DNF') |
| Lewis Hamilton (`lewis-hamilton`) | grid 2026, campeão, top 20 vitórias, top 20 GPs | Poles | 105 | 104 | F1DB v2026.17.0 (driver.total_pole_positions) |
| Mike Hawthorn (`mike-hawthorn`) | campeão | GPs disputados | 47 | 45 | F1DB v2026.17.0 (driver.total_race_starts) |
| Mike Hawthorn (`mike-hawthorn`) | campeão | Pódios | 17 | 18 | F1DB v2026.17.0 (driver.total_podiums) |
| Mike Hawthorn (`mike-hawthorn`) | campeão | Abandonos | 11 | 9 | F1DB v2026.17.0 (race_data RACE_RESULT position_text = 'DNF') |
| Alexander Albon (`alexander-albon`) | grid 2026 | GPs disputados | 146 | 144 | F1DB v2026.17.0 (driver.total_race_starts) |
| Fernando Alonso (`fernando-alonso`) | grid 2026, campeão, top 20 vitórias, top 20 GPs | GPs disputados | 445 | 443 | F1DB v2026.17.0 (driver.total_race_starts) |
| Fernando Alonso (`fernando-alonso`) | grid 2026, campeão, top 20 vitórias, top 20 GPs | Poles | 23 | 22 | F1DB v2026.17.0 (driver.total_pole_positions) |
| Jim Clark (`jim-clark`) | campeão, top 20 vitórias | GPs disputados | 73 | 72 | F1DB v2026.17.0 (driver.total_race_starts) |
| Jim Clark (`jim-clark`) | campeão, top 20 vitórias | Abandonos | 24 | 23 | F1DB v2026.17.0 (race_data RACE_RESULT position_text = 'DNF') |
| Lance Stroll (`lance-stroll`) | grid 2026 | GPs disputados | 209 | 206 | F1DB v2026.17.0 (driver.total_race_starts) |
| Lance Stroll (`lance-stroll`) | grid 2026 | Abandonos | 36 | 35 | F1DB v2026.17.0 (race_data RACE_RESULT position_text = 'DNF') |
| Sergio Pérez (`sergio-perez`) | grid 2026, top 20 GPs | GPs disputados | 300 | 298 | F1DB v2026.17.0 (driver.total_race_starts) |
| Sergio Pérez (`sergio-perez`) | grid 2026, top 20 GPs | Abandonos | 35 | 34 | F1DB v2026.17.0 (race_data RACE_RESULT position_text = 'DNF') |
| Alberto Ascari (`alberto-ascari`) | campeão | Pódios | 15 | 17 | F1DB v2026.17.0 (driver.total_podiums) |
| Alberto Ascari (`alberto-ascari`) | campeão | Abandonos | 12 | 9 | F1DB v2026.17.0 (race_data RACE_RESULT position_text = 'DNF') |
| Damon Hill (`damon-hill`) | campeão, top 20 vitórias | GPs disputados | 116 | 115 | F1DB v2026.17.0 (driver.total_race_starts) |
| David Coulthard (`david-coulthard`) | top 20 GPs | GPs disputados | 247 | 246 | F1DB v2026.17.0 (driver.total_race_starts) |
| Franco Colapinto (`franco-colapinto`) | grid 2026 | GPs disputados | 44 | 43 | F1DB v2026.17.0 (driver.total_race_starts) |
| Gabriel Bortoleto (`gabriel-bortoleto`) | grid 2026 | GPs disputados | 41 | 40 | F1DB v2026.17.0 (driver.total_race_starts) |
| Graham Hill (`graham-hill`) | campeão | GPs disputados | 177 | 176 | F1DB v2026.17.0 (driver.total_race_starts) |
| Jackie Stewart (`jackie-stewart`) | campeão, top 20 vitórias | GPs disputados | 100 | 99 | F1DB v2026.17.0 (driver.total_race_starts) |
| Jacques Villeneuve (`jacques-villeneuve`) | campeão | GPs disputados | 165 | 163 | F1DB v2026.17.0 (driver.total_race_starts) |
| James Hunt (`james-hunt`) | campeão | GPs disputados | 93 | 92 | F1DB v2026.17.0 (driver.total_race_starts) |
| Jenson Button (`jenson-button`) | campeão, top 20 vitórias, top 20 GPs | GPs disputados | 309 | 306 | F1DB v2026.17.0 (driver.total_race_starts) |
| John Surtees (`john-surtees`) | campeão | GPs disputados | 113 | 111 | F1DB v2026.17.0 (driver.total_race_starts) |
| Kimi Räikkönen (`kimi-raikkonen`) | campeão, top 20 vitórias, top 20 GPs | GPs disputados | 352 | 350 | F1DB v2026.17.0 (driver.total_race_starts) |
| Kimi Räikkönen (`kimi-raikkonen`) | campeão, top 20 vitórias, top 20 GPs | Poles | 19 | 18 | F1DB v2026.17.0 (driver.total_pole_positions) |
| Liam Lawson (`liam-lawson`) | grid 2026 | Abandonos | 7 | 6 | F1DB v2026.17.0 (race_data RACE_RESULT position_text = 'DNF') |
| Max Verstappen (`max-verstappen`) | grid 2026, campeão, top 20 vitórias, top 20 GPs | Poles | 54 | 50 | F1DB v2026.17.0 (driver.total_pole_positions) |
| Michael Schumacher (`michael-schumacher`) | campeão, top 20 vitórias, top 20 GPs | GPs disputados | 308 | 306 | F1DB v2026.17.0 (driver.total_race_starts) |
| Michael Schumacher (`michael-schumacher`) | campeão, top 20 vitórias, top 20 GPs | Poles | 69 | 68 | F1DB v2026.17.0 (driver.total_pole_positions) |
| Nico Hülkenberg (`nico-hulkenberg`) | grid 2026, top 20 GPs | GPs disputados | 271 | 266 | F1DB v2026.17.0 (driver.total_race_starts) |
| Nigel Mansell (`nigel-mansell`) | campeão, top 20 vitórias | GPs disputados | 189 | 187 | F1DB v2026.17.0 (driver.total_race_starts) |
| Nino Farina (`nino-farina`) | campeão | GPs disputados | 34 | 33 | F1DB v2026.17.0 (driver.total_race_starts) |
| Nino Farina (`nino-farina`) | campeão | Pódios | 18 | 19 | F1DB v2026.17.0 (driver.total_podiums) |
| Nino Farina (`nino-farina`) | campeão | Abandonos | 8 | 7 | F1DB v2026.17.0 (race_data RACE_RESULT position_text = 'DNF') |
| Pierre Gasly (`pierre-gasly`) | grid 2026 | GPs disputados | 195 | 194 | F1DB v2026.17.0 (driver.total_race_starts) |
| Valtteri Bottas (`valtteri-bottas`) | grid 2026, top 20 GPs | GPs disputados | 264 | 263 | F1DB v2026.17.0 (driver.total_race_starts) |
| Valtteri Bottas (`valtteri-bottas`) | grid 2026, top 20 GPs | Poles | 19 | 20 | F1DB v2026.17.0 (driver.total_pole_positions) |
| Yuki Tsunoda (`yuki-tsunoda`) | grid 2026 | GPs disputados | 117 | 114 | F1DB v2026.17.0 (driver.total_race_starts) |
| Giancarlo Fisichella (`giancarlo-fisichella`) | top 20 GPs | GPs disputados | 230 | 229 | F1DB v2026.17.0 (driver.total_race_starts) |
| Jack Brabham (`jack-brabham`) | campeão | GPs disputados | 128 | 126 | F1DB v2026.17.0 (driver.total_race_starts) |
| Jack Brabham (`jack-brabham`) | campeão | Abandonos | 53 | 52 | F1DB v2026.17.0 (race_data RACE_RESULT position_text = 'DNF') |
| Jarno Trulli (`jarno-trulli`) | top 20 GPs | GPs disputados | 256 | 252 | F1DB v2026.17.0 (driver.total_race_starts) |
| Mark Webber (`mark-webber`) | top 20 GPs | GPs disputados | 217 | 215 | F1DB v2026.17.0 (driver.total_race_starts) |
| Mark Webber (`mark-webber`) | top 20 GPs | Poles | 12 | 13 | F1DB v2026.17.0 (driver.total_pole_positions) |
| Oscar Piastri (`oscar-piastri`) | grid 2026 | GPs disputados | 87 | 85 | F1DB v2026.17.0 (driver.total_race_starts) |
| Alain Prost (`alain-prost`) | campeão, top 20 vitórias | GPs disputados | 202 | 199 | F1DB v2026.17.0 (driver.total_race_starts) |
| Alan Jones (`alan-jones`) | campeão | GPs disputados | 117 | 116 | F1DB v2026.17.0 (driver.total_race_starts) |
| Emerson Fittipaldi (`emerson-fittipaldi`) | campeão, top 20 vitórias | GPs disputados | 146 | 144 | F1DB v2026.17.0 (driver.total_race_starts) |
| Felipe Massa (`felipe-massa`) | top 20 GPs | GPs disputados | 271 | 269 | F1DB v2026.17.0 (driver.total_race_starts) |
| Jochen Rindt (`jochen-rindt`) | campeão | GPs disputados | 61 | 60 | F1DB v2026.17.0 (driver.total_race_starts) |
| Mario Andretti (`mario-andretti`) | campeão | GPs disputados | 130 | 128 | F1DB v2026.17.0 (driver.total_race_starts) |
| Mika Häkkinen (`mika-hakkinen`) | campeão, top 20 vitórias | GPs disputados | 163 | 161 | F1DB v2026.17.0 (driver.total_race_starts) |
| Nelson Piquet (`nelson-piquet`) | campeão, top 20 vitórias | GPs disputados | 205 | 203 | F1DB v2026.17.0 (driver.total_race_starts) |
| Niki Lauda (`niki-lauda`) | campeão, top 20 vitórias | GPs disputados | 175 | 171 | F1DB v2026.17.0 (driver.total_race_starts) |
| Phil Hill (`phil-hill`) | campeão | GPs disputados | 51 | 48 | F1DB v2026.17.0 (driver.total_race_starts) |
| Riccardo Patrese (`riccardo-patrese`) | top 20 GPs | GPs disputados | 257 | 256 | F1DB v2026.17.0 (driver.total_race_starts) |
| Rubens Barrichello (`rubens-barrichello`) | top 20 GPs | GPs disputados | 325 | 322 | F1DB v2026.17.0 (driver.total_race_starts) |
| Sebastian Vettel (`sebastian-vettel`) | campeão, top 20 vitórias, top 20 GPs | GPs disputados | 300 | 299 | F1DB v2026.17.0 (driver.total_race_starts) |
| Tony Brooks (`tony-brooks`) | — | GPs disputados | 39 | 38 | F1DB v2026.17.0 (driver.total_race_starts) |
| Tony Brooks (`tony-brooks`) | — | Vitórias | 5 | 6 | F1DB v2026.17.0 (driver.total_race_wins) |
| Tony Brooks (`tony-brooks`) | — | Pódios | 9 | 10 | F1DB v2026.17.0 (driver.total_podiums) |
| Tony Brooks (`tony-brooks`) | — | Poles | 2 | 3 | F1DB v2026.17.0 (driver.total_pole_positions) |
| Tony Brooks (`tony-brooks`) | — | Abandonos | 17 | 16 | F1DB v2026.17.0 (race_data RACE_RESULT position_text = 'DNF') |
| Tony Brooks (`tony-brooks`) | — | Melhor resultado (com contagem) | 1º (x5) | 1º (x6) | F1DB v2026.17.0 (race_data RACE_RESULT) |
| Peter Collins (`peter-collins`) | — | GPs disputados | 34 | 32 | F1DB v2026.17.0 (driver.total_race_starts) |
| Peter Collins (`peter-collins`) | — | Pódios | 8 | 9 | F1DB v2026.17.0 (driver.total_podiums) |
| Peter Collins (`peter-collins`) | — | Abandonos | 19 | 16 | F1DB v2026.17.0 (race_data RACE_RESULT position_text = 'DNF') |
| Peter Collins (`peter-collins`) | — | Número da temporada selecionada | 1956: 2 | 1956: 26 | F1DB v2026.17.0 (race_data.driver_number nas corridas) |
| Cliff Allison (`cliff-allison`) | — | GPs disputados | 17 | 16 | F1DB v2026.17.0 (driver.total_race_starts) |
| Cliff Allison (`cliff-allison`) | — | Poles | 1 | 0 | F1DB v2026.17.0 (driver.total_pole_positions) |
| Cliff Allison (`cliff-allison`) | — | Número da temporada selecionada | 1961: 32 | 1961: 16 | F1DB v2026.17.0 (race_data.driver_number nas corridas) |
| Bill Aston (`bill-aston`) | — | GPs disputados | 2 | 1 | F1DB v2026.17.0 (driver.total_race_starts) |
| Bob Scott (`bob-scott`) | — | Melhor resultado (com contagem) | 25º (x1) | 12º (x1) | F1DB v2026.17.0 (race_data RACE_RESULT) |
| Bob Scott (`bob-scott`) | — | Número da temporada selecionada | 1954: 74 | 1954: 27 | F1DB v2026.17.0 (race_data.driver_number nas corridas) |
| Bob Scott (`bob-scott`) | — | Equipe da temporada selecionada | 1954: Schroeder (schroeder) | 1954: stevens | F1DB v2026.17.0 (race_data.constructor_id com mais corridas largadas) |
| Brian Henton (`brian-henton`) | — | GPs disputados | 20 | 19 | F1DB v2026.17.0 (driver.total_race_starts) |
| Brian Redman (`brian-redman`) | — | GPs disputados | 14 | 12 | F1DB v2026.17.0 (driver.total_race_starts) |
| Cesare Perdisa (`cesare-perdisa`) | — | GPs disputados | 8 | 7 | F1DB v2026.17.0 (driver.total_race_starts) |
| Cesare Perdisa (`cesare-perdisa`) | — | Pódios | 1 | 2 | F1DB v2026.17.0 (driver.total_podiums) |
| Cesare Perdisa (`cesare-perdisa`) | — | Abandonos | 1 | 0 | F1DB v2026.17.0 (race_data RACE_RESULT position_text = 'DNF') |
| Cesare Perdisa (`cesare-perdisa`) | — | Melhor resultado (com contagem) | 3º (x1) | 3º (x2) | F1DB v2026.17.0 (race_data RACE_RESULT) |
| Chris Craft (`chris-craft`) | — | GPs disputados | 2 | 1 | F1DB v2026.17.0 (driver.total_race_starts) |
| David Purley (`david-purley`) | — | GPs disputados | 8 | 7 | F1DB v2026.17.0 (driver.total_race_starts) |
| Derek Bell (`derek-bell`) | — | GPs disputados | 11 | 9 | F1DB v2026.17.0 (driver.total_race_starts) |
| Derek Warwick (`derek-warwick`) | — | GPs disputados | 148 | 147 | F1DB v2026.17.0 (driver.total_race_starts) |
| Guy Edwards (`guy-edwards`) | — | GPs disputados | 12 | 11 | F1DB v2026.17.0 (driver.total_race_starts) |
| Ian Burgess (`ian-burgess`) | — | GPs disputados | 18 | 16 | F1DB v2026.17.0 (driver.total_race_starts) |
| Jack Fairman (`jack-fairman`) | — | GPs disputados | 13 | 12 | F1DB v2026.17.0 (driver.total_race_starts) |
| Jackie Oliver (`jackie-oliver`) | — | GPs disputados | 52 | 50 | F1DB v2026.17.0 (driver.total_race_starts) |
| Johnny Claes (`johnny-claes`) | — | GPs disputados | 24 | 23 | F1DB v2026.17.0 (driver.total_race_starts) |
| Johnny Claes (`johnny-claes`) | — | Equipe da temporada selecionada | 1955: Maserati (maserati) | 1955: ferrari | F1DB v2026.17.0 (race_data.constructor_id com mais corridas largadas) |
| Johnny Claes (`johnny-claes`) | — | Cor da equipe (curadoria e contraste) | 1955: #c8102e | 1955: #dc0000 | liveries.yaml (ferrari) |
| Jonathan Palmer (`jonathan-palmer`) | — | GPs disputados | 84 | 83 | F1DB v2026.17.0 (driver.total_race_starts) |
| Luigi Fagioli (`luigi-fagioli`) | — | Vitórias | 0 | 1 | F1DB v2026.17.0 (driver.total_race_wins) |
| Luigi Fagioli (`luigi-fagioli`) | — | Pódios | 5 | 6 | F1DB v2026.17.0 (driver.total_podiums) |
| Luigi Fagioli (`luigi-fagioli`) | — | Melhor resultado (com contagem) | 2º (x4) | 1º (x1) | F1DB v2026.17.0 (race_data RACE_RESULT) |
| Luigi Fagioli (`luigi-fagioli`) | — | Número da temporada selecionada | 1951: 4 | 1951: 8 | F1DB v2026.17.0 (race_data.driver_number nas corridas) |
| Mike Spence (`mike-spence`) | — | GPs disputados | 37 | 36 | F1DB v2026.17.0 (driver.total_race_starts) |
| Mike Spence (`mike-spence`) | — | Abandonos | 16 | 15 | F1DB v2026.17.0 (race_data RACE_RESULT position_text = 'DNF') |
| Piers Courage (`piers-courage`) | — | GPs disputados | 30 | 28 | F1DB v2026.17.0 (driver.total_race_starts) |
| Richard Robarts (`richard-robarts`) | — | GPs disputados | 4 | 3 | F1DB v2026.17.0 (driver.total_race_starts) |
| Roy Salvadori (`roy-salvadori`) | — | GPs disputados | 49 | 47 | F1DB v2026.17.0 (driver.total_race_starts) |
| Rupert Keegan (`rupert-keegan`) | — | GPs disputados | 27 | 25 | F1DB v2026.17.0 (driver.total_race_starts) |
| Al Pease (`al-pease`) | — | GPs disputados | 3 | 2 | F1DB v2026.17.0 (driver.total_race_starts) |
| Alan Brown (`alan-brown`) | — | GPs disputados | 9 | 8 | F1DB v2026.17.0 (driver.total_race_starts) |
| Alfonso de Portago (`alfonso-de-portago`) | — | Pódios | 0 | 1 | F1DB v2026.17.0 (driver.total_podiums) |
| Alfonso de Portago (`alfonso-de-portago`) | — | Melhor resultado (com contagem) | 5º (x1) | 2º (x1) | F1DB v2026.17.0 (race_data RACE_RESULT) |
| Allan McNish (`allan-mcnish`) | — | GPs disputados | 17 | 16 | F1DB v2026.17.0 (driver.total_race_starts) |
| Bob Anderson (`bob-anderson`) | — | GPs disputados | 28 | 25 | F1DB v2026.17.0 (driver.total_race_starts) |
| David Murray (`david-murray`) | — | GPs disputados | 5 | 4 | F1DB v2026.17.0 (driver.total_race_starts) |
| David Piper (`david-piper`) | — | GPs disputados | 3 | 2 | F1DB v2026.17.0 (driver.total_race_starts) |
| Duane Carter (`duane-carter`) | — | Pódios | 0 | 1 | F1DB v2026.17.0 (driver.total_podiums) |
| Duane Carter (`duane-carter`) | — | Melhor resultado (com contagem) | 4º (x1) | 3º (x1) | F1DB v2026.17.0 (race_data RACE_RESULT) |
| George Fonder (`george-fonder`) | — | Número da temporada selecionada | 1954: 33 | 1954: 71 | F1DB v2026.17.0 (race_data.driver_number nas corridas) |
| George Fonder (`george-fonder`) | — | Equipe da temporada selecionada | 1954: Schroeder (schroeder) | 1954: kurtis-kraft | F1DB v2026.17.0 (race_data.constructor_id com mais corridas largadas) |
| Henry Taylor (`henry-taylor`) | — | GPs disputados | 10 | 8 | F1DB v2026.17.0 (driver.total_race_starts) |
| Horace Gould (`horace-gould`) | — | GPs disputados | 17 | 14 | F1DB v2026.17.0 (driver.total_race_starts) |
| Ian Ashley (`ian-ashley`) | — | GPs disputados | 6 | 4 | F1DB v2026.17.0 (driver.total_race_starts) |
| Innes Ireland (`innes-ireland`) | — | GPs disputados | 53 | 50 | F1DB v2026.17.0 (driver.total_race_starts) |
| Jan Flinterman (`jan-flinterman`) | — | Abandonos | 1 | 0 | F1DB v2026.17.0 (race_data RACE_RESULT position_text = 'DNF') |
| Jan Flinterman (`jan-flinterman`) | — | Melhor resultado (com contagem) | — | 9º (x1) | F1DB v2026.17.0 (race_data RACE_RESULT) |
| Jan Flinterman (`jan-flinterman`) | — | Número da temporada selecionada | 1952: 20 | 1952: 16 | F1DB v2026.17.0 (race_data.driver_number nas corridas) |
| Jean Behra (`jean-behra`) | — | GPs disputados | 53 | 52 | F1DB v2026.17.0 (driver.total_race_starts) |
| Jean Behra (`jean-behra`) | — | Pódios | 8 | 9 | F1DB v2026.17.0 (driver.total_podiums) |
| Jean Behra (`jean-behra`) | — | Abandonos | 29 | 26 | F1DB v2026.17.0 (race_data RACE_RESULT position_text = 'DNF') |
| John Miles (`john-miles`) | — | GPs disputados | 13 | 12 | F1DB v2026.17.0 (driver.total_race_starts) |
| Johnny Herbert (`johnny-herbert`) | — | GPs disputados | 162 | 160 | F1DB v2026.17.0 (driver.total_race_starts) |
| Jolyon Palmer (`jolyon-palmer`) | — | GPs disputados | 37 | 35 | F1DB v2026.17.0 (driver.total_race_starts) |
| Ken Wharton (`ken-wharton`) | — | GPs disputados | 16 | 15 | F1DB v2026.17.0 (driver.total_race_starts) |
| Lance Reventlow (`lance-reventlow`) | — | GPs disputados | 3 | 1 | F1DB v2026.17.0 (driver.total_race_starts) |
| Lella Lombardi (`lella-lombardi`) | — | GPs disputados | 13 | 12 | F1DB v2026.17.0 (driver.total_race_starts) |
| Lella Lombardi (`lella-lombardi`) | — | Número da temporada selecionada | 1976: 33 | 1976: 10 | F1DB v2026.17.0 (race_data.driver_number nas corridas) |
| Louis Chiron (`louis-chiron`) | — | País e nacionalidade | — | MC Mônaco | F1DB v2026.17.0 (driver.nationality_country_id = Monaco) |
| Louis Chiron (`louis-chiron`) | — | Nascimento (data, local e país) | 1899-08-03 · Monte Carlo ·  | 1899-08-03 · Monte Carlo · MC | F1DB v2026.17.0 (driver.date_of_birth, place_of_birth, country_of_birth) |
| Louis Chiron (`louis-chiron`) | — | GPs disputados | 18 | 15 | F1DB v2026.17.0 (driver.total_race_starts) |
| Martin Brundle (`martin-brundle`) | — | GPs disputados | 161 | 160 | F1DB v2026.17.0 (driver.total_race_starts) |
| Martin Donnelly (`martin-donnelly`) | — | GPs disputados | 15 | 14 | F1DB v2026.17.0 (driver.total_race_starts) |
| Maurice Trintignant (`maurice-trintignant`) | — | GPs disputados | 83 | 82 | F1DB v2026.17.0 (driver.total_race_starts) |
| Maurice Trintignant (`maurice-trintignant`) | — | Pódios | 8 | 9 | F1DB v2026.17.0 (driver.total_podiums) |
| Maurice Trintignant (`maurice-trintignant`) | — | Abandonos | 40 | 39 | F1DB v2026.17.0 (race_data RACE_RESULT position_text = 'DNF') |
| Mike Taylor (`mike-taylor`) | — | GPs disputados | 2 | 1 | F1DB v2026.17.0 (driver.total_race_starts) |
| Olivier Beretta (`olivier-beretta`) | — | País e nacionalidade | — | MC Mônaco | F1DB v2026.17.0 (driver.nationality_country_id = Monaco) |
| Olivier Beretta (`olivier-beretta`) | — | Nascimento (data, local e país) | 1969-11-23 · Monte Carlo ·  | 1969-11-23 · Monte Carlo · MC | F1DB v2026.17.0 (driver.date_of_birth, place_of_birth, country_of_birth) |
| Peter Arundell (`peter-arundell`) | — | GPs disputados | 13 | 11 | F1DB v2026.17.0 (driver.total_race_starts) |
| Peter Gethin (`peter-gethin`) | — | GPs disputados | 31 | 30 | F1DB v2026.17.0 (driver.total_race_starts) |
| Peter Whitehead (`peter-whitehead`) | — | GPs disputados | 11 | 10 | F1DB v2026.17.0 (driver.total_race_starts) |
| Reg Parnell (`reg-parnell`) | — | GPs disputados | 7 | 6 | F1DB v2026.17.0 (driver.total_race_starts) |
| Richard Attwood (`richard-attwood`) | — | GPs disputados | 18 | 17 | F1DB v2026.17.0 (driver.total_race_starts) |
| Rodney Nuckey (`rodney-nuckey`) | — | GPs disputados | 2 | 1 | F1DB v2026.17.0 (driver.total_race_starts) |
| Sergio Mantovani (`sergio-mantovani`) | — | GPs disputados | 8 | 7 | F1DB v2026.17.0 (driver.total_race_starts) |
| Sergio Mantovani (`sergio-mantovani`) | — | Abandonos | 2 | 1 | F1DB v2026.17.0 (race_data RACE_RESULT position_text = 'DNF') |
| Sergio Mantovani (`sergio-mantovani`) | — | Número da temporada selecionada | 1955: 20 | 1955: 22 | F1DB v2026.17.0 (race_data.driver_number nas corridas) |
| Tony Marsh (`tony-marsh`) | — | GPs disputados | 5 | 4 | F1DB v2026.17.0 (driver.total_race_starts) |
| Vic Wilson (`vic-wilson`) | — | GPs disputados | 2 | 1 | F1DB v2026.17.0 (driver.total_race_starts) |
| Will Stevens (`will-stevens`) | — | GPs disputados | 20 | 18 | F1DB v2026.17.0 (driver.total_race_starts) |
| Adrián Campos (`adrian-campos`) | — | GPs disputados | 18 | 17 | F1DB v2026.17.0 (driver.total_race_starts) |
| Alex Yoong (`alex-yoong`) | — | GPs disputados | 15 | 14 | F1DB v2026.17.0 (driver.total_race_starts) |
| André Pilette (`andre-pilette`) | — | GPs disputados | 10 | 9 | F1DB v2026.17.0 (driver.total_race_starts) |
| Andrea de Adamich (`andrea-de-adamich`) | — | GPs disputados | 31 | 30 | F1DB v2026.17.0 (driver.total_race_starts) |
| Andrea de Cesaris (`andrea-de-cesaris`) | — | GPs disputados | 210 | 207 | F1DB v2026.17.0 (driver.total_race_starts) |
| Andrea Montermini (`andrea-montermini`) | — | GPs disputados | 22 | 19 | F1DB v2026.17.0 (driver.total_race_starts) |
| Arturo Merzario (`arturo-merzario`) | — | GPs disputados | 59 | 57 | F1DB v2026.17.0 (driver.total_race_starts) |
| Beppe Gabbiani (`beppe-gabbiani`) | — | Número da temporada selecionada | 1981: 31 | 1981: 32 | F1DB v2026.17.0 (race_data.driver_number nas corridas) |
| Carel Godin de Beaufort (`carel-godin-de-beaufort`) | — | GPs disputados | 29 | 28 | F1DB v2026.17.0 (driver.total_race_starts) |
| Carroll Shelby (`carroll-shelby`) | — | Abandonos | 5 | 4 | F1DB v2026.17.0 (race_data RACE_RESULT position_text = 'DNF') |
| Carroll Shelby (`carroll-shelby`) | — | Melhor resultado (com contagem) | 8º (x1) | 4º (x1) | F1DB v2026.17.0 (race_data RACE_RESULT) |
| Chico Serra (`chico-serra`) | — | GPs disputados | 19 | 18 | F1DB v2026.17.0 (driver.total_race_starts) |
| Chris Amon (`chris-amon`) | — | GPs disputados | 104 | 96 | F1DB v2026.17.0 (driver.total_race_starts) |
| Christian Danner (`christian-danner`) | — | GPs disputados | 37 | 36 | F1DB v2026.17.0 (driver.total_race_starts) |
| Christian Klien (`christian-klien`) | — | GPs disputados | 51 | 49 | F1DB v2026.17.0 (driver.total_race_starts) |
| Chuck Daigh (`chuck-daigh`) | — | GPs disputados | 5 | 3 | F1DB v2026.17.0 (driver.total_race_starts) |
| Chuck Stevenson (`chuck-stevenson`) | — | Melhor resultado (com contagem) | 12º (x1) | 9º (x1) | F1DB v2026.17.0 (race_data RACE_RESULT) |
| Dieter Quester (`dieter-quester`) | — | GPs disputados | 2 | 1 | F1DB v2026.17.0 (driver.total_race_starts) |
| Domenico Schiattarella (`domenico-schiattarella`) | — | GPs disputados | 7 | 6 | F1DB v2026.17.0 (driver.total_race_starts) |
| Élie Bayol (`elie-bayol`) | — | GPs disputados | 8 | 7 | F1DB v2026.17.0 (driver.total_race_starts) |
| Eric van de Poele (`eric-van-de-poele`) | — | Número da temporada selecionada | 1992: 7 | 1992: 14 | F1DB v2026.17.0 (race_data.driver_number nas corridas) |
| Eugène Chaboud (`eugene-chaboud`) | — | Melhor resultado (com contagem) | 8º (x1) | 5º (x1) | F1DB v2026.17.0 (race_data RACE_RESULT) |
| Felice Bonetto (`felice-bonetto`) | — | GPs disputados | 16 | 15 | F1DB v2026.17.0 (driver.total_race_starts) |
| Felice Bonetto (`felice-bonetto`) | — | Abandonos | 6 | 5 | F1DB v2026.17.0 (race_data RACE_RESULT position_text = 'DNF') |
| François Migault (`francois-migault`) | — | GPs disputados | 15 | 13 | F1DB v2026.17.0 (driver.total_race_starts) |
| Fred Wacker (`fred-wacker`) | — | GPs disputados | 5 | 3 | F1DB v2026.17.0 (driver.total_race_starts) |
| Gene Hartley (`gene-hartley`) | — | Melhor resultado (com contagem) | 10º (x1) | 9º (x1) | F1DB v2026.17.0 (race_data RACE_RESULT) |
| George Follmer (`george-follmer`) | — | GPs disputados | 13 | 12 | F1DB v2026.17.0 (driver.total_race_starts) |
| Gijs van Lennep (`gijs-van-lennep`) | — | GPs disputados | 9 | 8 | F1DB v2026.17.0 (driver.total_race_starts) |
| Guanyu Zhou (`guanyu-zhou`) | — | Equipe da temporada selecionada | 2024: Sauber F1 Team (sauber) | 2024: kick-sauber | F1DB v2026.17.0 (race_data.constructor_id com mais corridas largadas) |
| Guanyu Zhou (`guanyu-zhou`) | — | Cor da equipe (curadoria e contraste) | 2024: #9d2235 | 2024: #00e701 | liveries.yaml (kick-sauber) |
| Hans Stuck (`hans-stuck`) | — | GPs disputados | 4 | 3 | F1DB v2026.17.0 (driver.total_race_starts) |
| Hans-Joachim Stuck (`hans-joachim-stuck`) | — | GPs disputados | 77 | 74 | F1DB v2026.17.0 (driver.total_race_starts) |
| Harald Ertl (`harald-ertl`) | — | GPs disputados | 20 | 19 | F1DB v2026.17.0 (driver.total_race_starts) |
| Harry Schell (`harry-schell`) | — | GPs disputados | 57 | 56 | F1DB v2026.17.0 (driver.total_race_starts) |
| Harry Schell (`harry-schell`) | — | Abandonos | 30 | 26 | F1DB v2026.17.0 (race_data RACE_RESULT position_text = 'DNF') |
| Henri Pescarolo (`henri-pescarolo`) | — | GPs disputados | 61 | 57 | F1DB v2026.17.0 (driver.total_race_starts) |
| Howden Ganley (`howden-ganley`) | — | GPs disputados | 38 | 35 | F1DB v2026.17.0 (driver.total_race_starts) |
| Huub Rothengatter (`huub-rothengatter`) | — | GPs disputados | 27 | 25 | F1DB v2026.17.0 (driver.total_race_starts) |
| Ivan Capelli (`ivan-capelli`) | — | GPs disputados | 95 | 93 | F1DB v2026.17.0 (driver.total_race_starts) |
| Jerry Hoyt (`jerry-hoyt`) | — | Melhor resultado (com contagem) | 21º (x1) | 8º (x1) | F1DB v2026.17.0 (race_data RACE_RESULT) |
| Jos Verstappen (`jos-verstappen`) | — | GPs disputados | 107 | 106 | F1DB v2026.17.0 (driver.total_race_starts) |
| José Froilán González (`jose-froilan-gonzalez`) | — | Pódios | 13 | 15 | F1DB v2026.17.0 (driver.total_podiums) |
| José Froilán González (`jose-froilan-gonzalez`) | — | Abandonos | 10 | 7 | F1DB v2026.17.0 (race_data RACE_RESULT position_text = 'DNF') |
| Juan Pablo Montoya (`juan-pablo-montoya`) | — | GPs disputados | 95 | 94 | F1DB v2026.17.0 (driver.total_race_starts) |
| Juan Pablo Montoya (`juan-pablo-montoya`) | — | Poles | 12 | 13 | F1DB v2026.17.0 (driver.total_pole_positions) |
| Karl Wendlinger (`karl-wendlinger`) | — | GPs disputados | 42 | 41 | F1DB v2026.17.0 (driver.total_race_starts) |
| Kevin Magnussen (`kevin-magnussen`) | — | GPs disputados | 186 | 185 | F1DB v2026.17.0 (driver.total_race_starts) |
| Kevin Magnussen (`kevin-magnussen`) | — | Abandonos | 29 | 28 | F1DB v2026.17.0 (race_data RACE_RESULT position_text = 'DNF') |
| Lamberto Leoni (`lamberto-leoni`) | — | GPs disputados | 2 | 1 | F1DB v2026.17.0 (driver.total_race_starts) |
| Luigi Musso (`luigi-musso`) | — | GPs disputados | 25 | 24 | F1DB v2026.17.0 (driver.total_race_starts) |
| Luigi Musso (`luigi-musso`) | — | Abandonos | 11 | 10 | F1DB v2026.17.0 (race_data RACE_RESULT position_text = 'DNF') |
| Luigi Villoresi (`luigi-villoresi`) | — | GPs disputados | 33 | 31 | F1DB v2026.17.0 (driver.total_race_starts) |
| Luigi Villoresi (`luigi-villoresi`) | — | Abandonos | 14 | 13 | F1DB v2026.17.0 (race_data RACE_RESULT position_text = 'DNF') |
| Manfred Winkelhock (`manfred-winkelhock`) | — | GPs disputados | 50 | 47 | F1DB v2026.17.0 (driver.total_race_starts) |
| Marc Surer (`marc-surer`) | — | GPs disputados | 83 | 82 | F1DB v2026.17.0 (driver.total_race_starts) |
| Mark Donohue (`mark-donohue`) | — | GPs disputados | 16 | 14 | F1DB v2026.17.0 (driver.total_race_starts) |
| Massimo Natili (`massimo-natili`) | — | GPs disputados | 2 | 1 | F1DB v2026.17.0 (driver.total_race_starts) |
| Massimo Natili (`massimo-natili`) | — | Número da temporada selecionada | 1961: 62 | 1961: 58 | F1DB v2026.17.0 (race_data.driver_number nas corridas) |
| Masten Gregory (`masten-gregory`) | — | GPs disputados | 40 | 38 | F1DB v2026.17.0 (driver.total_race_starts) |
| Masten Gregory (`masten-gregory`) | — | Abandonos | 17 | 16 | F1DB v2026.17.0 (race_data RACE_RESULT position_text = 'DNF') |
| Maurício Gugelmin (`mauricio-gugelmin`) | — | GPs disputados | 75 | 74 | F1DB v2026.17.0 (driver.total_race_starts) |
| Mike Thackwell (`mike-thackwell`) | — | Número da temporada selecionada | 1984: 10 | 1984: 4 | F1DB v2026.17.0 (race_data.driver_number nas corridas) |
| Nanni Galli (`nanni-galli`) | — | GPs disputados | 18 | 17 | F1DB v2026.17.0 (driver.total_race_starts) |
| Pedro de la Rosa (`pedro-de-la-rosa`) | — | GPs disputados | 106 | 104 | F1DB v2026.17.0 (driver.total_race_starts) |
| Piercarlo Ghinzani (`piercarlo-ghinzani`) | — | GPs disputados | 79 | 72 | F1DB v2026.17.0 (driver.total_race_starts) |
| Pierre-Henri Raphanel (`pierre-henri-raphanel`) | — | Número da temporada selecionada | 1989: 39 | 1989: 32 | F1DB v2026.17.0 (race_data.driver_number nas corridas) |
| Ricardo Rosset (`ricardo-rosset`) | — | GPs disputados | 27 | 26 | F1DB v2026.17.0 (driver.total_race_starts) |
| Riccardo Paletti (`riccardo-paletti`) | — | GPs disputados | 3 | 2 | F1DB v2026.17.0 (driver.total_race_starts) |
| Rikky von Opel (`rikky-von-opel`) | — | GPs disputados | 12 | 10 | F1DB v2026.17.0 (driver.total_race_starts) |
| Robert Manzon (`robert-manzon`) | — | GPs disputados | 29 | 28 | F1DB v2026.17.0 (driver.total_race_starts) |
| Roberto Guerrero (`roberto-guerrero`) | — | GPs disputados | 22 | 21 | F1DB v2026.17.0 (driver.total_race_starts) |
| Roberto Moreno (`roberto-moreno`) | — | GPs disputados | 43 | 42 | F1DB v2026.17.0 (driver.total_race_starts) |
| Roland Ratzenberger (`roland-ratzenberger`) | — | GPs disputados | 2 | 1 | F1DB v2026.17.0 (driver.total_race_starts) |
| Rolf Stommelen (`rolf-stommelen`) | — | GPs disputados | 56 | 54 | F1DB v2026.17.0 (driver.total_race_starts) |
| Silvio Moser (`silvio-moser`) | — | GPs disputados | 14 | 12 | F1DB v2026.17.0 (driver.total_race_starts) |
| Stefano Modena (`stefano-modena`) | — | GPs disputados | 73 | 70 | F1DB v2026.17.0 (driver.total_race_starts) |
| Tarso Marques (`tarso-marques`) | — | GPs disputados | 25 | 24 | F1DB v2026.17.0 (driver.total_race_starts) |
| Tom Belsø (`tom-belso`) | — | GPs disputados | 3 | 2 | F1DB v2026.17.0 (driver.total_race_starts) |
| Troy Ruttman (`troy-ruttman`) | — | GPs disputados | 9 | 8 | F1DB v2026.17.0 (driver.total_race_starts) |
| Vern Schuppan (`vern-schuppan`) | — | GPs disputados | 10 | 9 | F1DB v2026.17.0 (driver.total_race_starts) |
| Vittorio Brambilla (`vittorio-brambilla`) | — | GPs disputados | 75 | 74 | F1DB v2026.17.0 (driver.total_race_starts) |
| Wolfgang Seidel (`wolfgang-seidel`) | — | GPs disputados | 12 | 10 | F1DB v2026.17.0 (driver.total_race_starts) |
| Aguri Suzuki (`aguri-suzuki`) | — | GPs disputados | 66 | 65 | F1DB v2026.17.0 (driver.total_race_starts) |
| Alessandro Nannini (`alessandro-nannini`) | — | GPs disputados | 77 | 76 | F1DB v2026.17.0 (driver.total_race_starts) |
| Alessandro Pesenti-Rossi (`alessandro-pesenti-rossi`) | — | Número da temporada selecionada | 1976: 40 | 1976: 37 | F1DB v2026.17.0 (race_data.driver_number nas corridas) |
| Alex Caffi (`alex-caffi`) | — | GPs disputados | 57 | 56 | F1DB v2026.17.0 (driver.total_race_starts) |
| Alex Zanardi (`alex-zanardi`) | — | GPs disputados | 42 | 41 | F1DB v2026.17.0 (driver.total_race_starts) |
| Bobby Unser (`bobby-unser`) | — | GPs disputados | 2 | 1 | F1DB v2026.17.0 (driver.total_race_starts) |
| Brett Lunger (`brett-lunger`) | — | GPs disputados | 35 | 34 | F1DB v2026.17.0 (driver.total_race_starts) |
| Bruce McLaren (`bruce-mclaren`) | — | GPs disputados | 104 | 100 | F1DB v2026.17.0 (driver.total_race_starts) |
| Carlos Menditéguy (`carlos-menditeguy`) | — | GPs disputados | 11 | 10 | F1DB v2026.17.0 (driver.total_race_starts) |
| Charles de Tornaco (`charles-de-tornaco`) | — | GPs disputados | 3 | 2 | F1DB v2026.17.0 (driver.total_race_starts) |
| Dan Gurney (`dan-gurney`) | — | GPs disputados | 87 | 86 | F1DB v2026.17.0 (driver.total_race_starts) |
| Daniil Kvyat (`daniil-kvyat`) | — | GPs disputados | 112 | 110 | F1DB v2026.17.0 (driver.total_race_starts) |
| Dave Charlton (`dave-charlton`) | — | GPs disputados | 12 | 11 | F1DB v2026.17.0 (driver.total_race_starts) |
| Didier Pironi (`didier-pironi`) | — | GPs disputados | 72 | 70 | F1DB v2026.17.0 (driver.total_race_starts) |
| Eugenio Castellotti (`eugenio-castellotti`) | — | Abandonos | 9 | 6 | F1DB v2026.17.0 (race_data RACE_RESULT position_text = 'DNF') |
| Felipe Nasr (`felipe-nasr`) | — | GPs disputados | 40 | 39 | F1DB v2026.17.0 (driver.total_race_starts) |
| François Hesnault (`francois-hesnault`) | — | GPs disputados | 20 | 19 | F1DB v2026.17.0 (driver.total_race_starts) |
| Gerhard Mitter (`gerhard-mitter`) | — | GPs disputados | 7 | 5 | F1DB v2026.17.0 (driver.total_race_starts) |
| Gianni Morbidelli (`gianni-morbidelli`) | — | GPs disputados | 68 | 67 | F1DB v2026.17.0 (driver.total_race_starts) |
| Gilles Villeneuve (`gilles-villeneuve`) | — | GPs disputados | 68 | 67 | F1DB v2026.17.0 (driver.total_race_starts) |
| Gino Munaron (`gino-munaron`) | — | Número da temporada selecionada | 1960: 30 | 1960: 4 | F1DB v2026.17.0 (race_data.driver_number nas corridas) |
| Gunnar Nilsson (`gunnar-nilsson`) | — | GPs disputados | 32 | 31 | F1DB v2026.17.0 (driver.total_race_starts) |
| Guy Ligier (`guy-ligier`) | — | GPs disputados | 13 | 12 | F1DB v2026.17.0 (driver.total_race_starts) |
| Hans Herrmann (`hans-herrmann`) | — | GPs disputados | 19 | 18 | F1DB v2026.17.0 (driver.total_race_starts) |
| Heikki Kovalainen (`heikki-kovalainen`) | — | GPs disputados | 112 | 111 | F1DB v2026.17.0 (driver.total_race_starts) |
| Heinz-Harald Frentzen (`heinz-harald-frentzen`) | — | GPs disputados | 158 | 156 | F1DB v2026.17.0 (driver.total_race_starts) |
| Hubert Hahne (`hubert-hahne`) | — | GPs disputados | 4 | 3 | F1DB v2026.17.0 (driver.total_race_starts) |
| Jacky Ickx (`jacky-ickx`) | — | GPs disputados | 117 | 116 | F1DB v2026.17.0 (driver.total_race_starts) |
| Jacques Laffite (`jacques-laffite`) | — | GPs disputados | 177 | 176 | F1DB v2026.17.0 (driver.total_race_starts) |
| Jacques Swaters (`jacques-swaters`) | — | GPs disputados | 8 | 7 | F1DB v2026.17.0 (driver.total_race_starts) |
| Jan Magnussen (`jan-magnussen`) | — | GPs disputados | 25 | 24 | F1DB v2026.17.0 (driver.total_race_starts) |
| Jean Alesi (`jean-alesi`) | — | GPs disputados | 202 | 201 | F1DB v2026.17.0 (driver.total_race_starts) |
| Jean-Pierre Jabouille (`jean-pierre-jabouille`) | — | GPs disputados | 51 | 49 | F1DB v2026.17.0 (driver.total_race_starts) |
| Jean-Pierre Jarier (`jean-pierre-jarier`) | — | GPs disputados | 138 | 135 | F1DB v2026.17.0 (driver.total_race_starts) |
| Jim Hall (`jim-hall`) | — | GPs disputados | 12 | 11 | F1DB v2026.17.0 (driver.total_race_starts) |
| Jo Bonnier (`jo-bonnier`) | — | GPs disputados | 105 | 104 | F1DB v2026.17.0 (driver.total_race_starts) |
| Jo Siffert (`jo-siffert`) | — | GPs disputados | 97 | 96 | F1DB v2026.17.0 (driver.total_race_starts) |
| Kamui Kobayashi (`kamui-kobayashi`) | — | GPs disputados | 76 | 75 | F1DB v2026.17.0 (driver.total_race_starts) |
| Karl Kling (`karl-kling`) | — | Abandonos | 6 | 5 | F1DB v2026.17.0 (race_data RACE_RESULT position_text = 'DNF') |
| Louis Rosier (`louis-rosier`) | — | Abandonos | 13 | 12 | F1DB v2026.17.0 (race_data RACE_RESULT position_text = 'DNF') |
| Luca Badoer (`luca-badoer`) | — | GPs disputados | 52 | 50 | F1DB v2026.17.0 (driver.total_race_starts) |
| Lucas di Grassi (`lucas-di-grassi`) | — | GPs disputados | 19 | 18 | F1DB v2026.17.0 (driver.total_race_starts) |
| Luigi Piotti (`luigi-piotti`) | — | GPs disputados | 7 | 5 | F1DB v2026.17.0 (driver.total_race_starts) |
| Michael May (`michael-may`) | — | GPs disputados | 3 | 2 | F1DB v2026.17.0 (driver.total_race_starts) |
| Mick Schumacher (`mick-schumacher`) | — | GPs disputados | 44 | 43 | F1DB v2026.17.0 (driver.total_race_starts) |
| Mika Salo (`mika-salo`) | — | GPs disputados | 111 | 109 | F1DB v2026.17.0 (driver.total_race_starts) |
| Nick Heidfeld (`nick-heidfeld`) | — | GPs disputados | 185 | 183 | F1DB v2026.17.0 (driver.total_race_starts) |
| Nicola Larini (`nicola-larini`) | — | GPs disputados | 50 | 49 | F1DB v2026.17.0 (driver.total_race_starts) |
| Nikita Mazepin (`nikita-mazepin`) | — | GPs disputados | 22 | 21 | F1DB v2026.17.0 (driver.total_race_starts) |
| Olivier Panis (`olivier-panis`) | — | GPs disputados | 158 | 157 | F1DB v2026.17.0 (driver.total_race_starts) |
| Onofre Marimón (`onofre-marimon`) | — | GPs disputados | 12 | 11 | F1DB v2026.17.0 (driver.total_race_starts) |
| Paddy Driver (`paddy-driver`) | — | GPs disputados | 2 | 1 | F1DB v2026.17.0 (driver.total_race_starts) |
| Pastor Maldonado (`pastor-maldonado`) | — | GPs disputados | 96 | 95 | F1DB v2026.17.0 (driver.total_race_starts) |
| Patrick Nève (`patrick-neve`) | — | GPs disputados | 11 | 10 | F1DB v2026.17.0 (driver.total_race_starts) |
| Patrick Tambay (`patrick-tambay`) | — | GPs disputados | 118 | 113 | F1DB v2026.17.0 (driver.total_race_starts) |
| Pedro Diniz (`pedro-diniz`) | — | GPs disputados | 99 | 98 | F1DB v2026.17.0 (driver.total_race_starts) |
| Philippe Alliot (`philippe-alliot`) | — | GPs disputados | 111 | 110 | F1DB v2026.17.0 (driver.total_race_starts) |
| Pierluigi Martini (`pierluigi-martini`) | — | GPs disputados | 120 | 117 | F1DB v2026.17.0 (driver.total_race_starts) |
| Piero Taruffi (`piero-taruffi`) | — | GPs disputados | 19 | 18 | F1DB v2026.17.0 (driver.total_race_starts) |
| René Arnoux (`rene-arnoux`) | — | GPs disputados | 151 | 149 | F1DB v2026.17.0 (driver.total_race_starts) |
| Ricardo Rodríguez (`ricardo-rodriguez`) | — | GPs disputados | 6 | 5 | F1DB v2026.17.0 (driver.total_race_starts) |
| Ricardo Zonta (`ricardo-zonta`) | — | GPs disputados | 37 | 36 | F1DB v2026.17.0 (driver.total_race_starts) |
| Roberto Merhi (`roberto-merhi`) | — | GPs disputados | 14 | 13 | F1DB v2026.17.0 (driver.total_race_starts) |
| Romain Grosjean (`romain-grosjean`) | — | GPs disputados | 181 | 179 | F1DB v2026.17.0 (driver.total_race_starts) |
| Rudi Fischer (`rudi-fischer`) | — | GPs disputados | 8 | 7 | F1DB v2026.17.0 (driver.total_race_starts) |
| Stoffel Vandoorne (`stoffel-vandoorne`) | — | GPs disputados | 42 | 41 | F1DB v2026.17.0 (driver.total_race_starts) |
| Takuma Sato (`takuma-sato`) | — | GPs disputados | 91 | 90 | F1DB v2026.17.0 (driver.total_race_starts) |
| Timo Glock (`timo-glock`) | — | GPs disputados | 95 | 91 | F1DB v2026.17.0 (driver.total_race_starts) |
| Tony Maggs (`tony-maggs`) | — | GPs disputados | 27 | 25 | F1DB v2026.17.0 (driver.total_race_starts) |
| Vitaly Petrov (`vitaly-petrov`) | — | GPs disputados | 58 | 57 | F1DB v2026.17.0 (driver.total_race_starts) |
| Willy Mairesse (`willy-mairesse`) | — | GPs disputados | 13 | 12 | F1DB v2026.17.0 (driver.total_race_starts) |
| Wilson Fittipaldi (`wilson-fittipaldi`) | — | GPs disputados | 36 | 35 | F1DB v2026.17.0 (driver.total_race_starts) |
| Wolfgang von Trips (`wolfgang-von-trips`) | — | GPs disputados | 29 | 27 | F1DB v2026.17.0 (driver.total_race_starts) |
| François Cevert (`francois-cevert`) | — | GPs disputados | 48 | 47 | F1DB v2026.17.0 (driver.total_race_starts) |
| Jochen Mass (`jochen-mass`) | — | GPs disputados | 107 | 105 | F1DB v2026.17.0 (driver.total_race_starts) |
| Johnny Cecotto (`johnny-cecotto`) | — | GPs disputados | 19 | 18 | F1DB v2026.17.0 (driver.total_race_starts) |
| Ludovico Scarfiotti (`ludovico-scarfiotti`) | — | GPs disputados | 12 | 10 | F1DB v2026.17.0 (driver.total_race_starts) |
| Peter Revson (`peter-revson`) | — | GPs disputados | 31 | 30 | F1DB v2026.17.0 (driver.total_race_starts) |
| Reine Wisell (`reine-wisell`) | — | GPs disputados | 23 | 22 | F1DB v2026.17.0 (driver.total_race_starts) |
| Richie Ginther (`richie-ginther`) | — | GPs disputados | 53 | 52 | F1DB v2026.17.0 (driver.total_race_starts) |
| Satoru Nakajima (`satoru-nakajima`) | — | GPs disputados | 75 | 74 | F1DB v2026.17.0 (driver.total_race_starts) |

## De outras frentes (só listados)

Só os 64 prioritários; o placar acima conta todos (`--completo` lista todos).

| Piloto | Prioridade | Campo | Valor atual | Valor certo | Fonte |
|---|---|---|---|---|---|
| Stirling Moss (`stirling-moss`) | top 20 vitórias | País e nacionalidade | GB Wales | GB Reino Unido | F1DB v2026.17.0 (driver.nationality_country_id = United Kingdom) |
| Stirling Moss (`stirling-moss`) | top 20 vitórias | Nascimento (data, local e país) | país: Wales | país: Reino Unido | F1DB v2026.17.0 (driver.country_of_birth_country_id) |
| Carlos Sainz Jr. (`carlos-sainz-jr`) | grid 2026, top 20 GPs | Retrato | de 2021 | de 2025 ou 2026 | acervo da Commons |
| Carlos Sainz Jr. (`carlos-sainz-jr`) | grid 2026, top 20 GPs | Fundo do heading | sem foto (há carro livre em 2018, mas de outra equipe) | carro em CC BY, CC0 ou domínio público | acervo da Commons |
| Charles Leclerc (`charles-leclerc`) | grid 2026 | Retrato | sem retrato | retrato da Commons | acervo da Commons (assets:commons) |
| Charles Leclerc (`charles-leclerc`) | grid 2026 | Fundo do heading | sem foto (só há carro em CC BY-SA) | carro em CC BY, CC0 ou domínio público | acervo da Commons |
| George Russell (`george-russell`) | grid 2026 | País e nacionalidade | GB Wales | GB Reino Unido | F1DB v2026.17.0 (driver.nationality_country_id = United Kingdom) |
| George Russell (`george-russell`) | grid 2026 | Nascimento (data, local e país) | país: Wales | país: Reino Unido | F1DB v2026.17.0 (driver.country_of_birth_country_id) |
| George Russell (`george-russell`) | grid 2026 | Retrato | sem retrato | retrato da Commons | acervo da Commons (assets:commons) |
| George Russell (`george-russell`) | grid 2026 | Fundo do heading | sem foto (há carro livre em 2020, mas de outra equipe) | carro em CC BY, CC0 ou domínio público | acervo da Commons |
| Arvid Lindblad (`arvid-lindblad`) | grid 2026 | País e nacionalidade | GB Wales | GB Reino Unido | F1DB v2026.17.0 (driver.nationality_country_id = United Kingdom) |
| Arvid Lindblad (`arvid-lindblad`) | grid 2026 | Nascimento (data, local e país) | país: Wales | país: Reino Unido | F1DB v2026.17.0 (driver.country_of_birth_country_id) |
| Arvid Lindblad (`arvid-lindblad`) | grid 2026 | Retrato | sem retrato | retrato da Commons | acervo da Commons (assets:commons) |
| Arvid Lindblad (`arvid-lindblad`) | grid 2026 | Fundo do heading | sem foto (nenhuma foto de carro no acervo) | carro em CC BY, CC0 ou domínio público | acervo da Commons |
| Juan Manuel Fangio (`juan-manuel-fangio`) | campeão, top 20 vitórias | Fundo do heading | sem foto (só há carro em CC BY-SA) | carro em CC BY, CC0 ou domínio público | acervo da Commons |
| Lando Norris (`lando-norris`) | grid 2026, campeão | País e nacionalidade | GB Wales | GB Reino Unido | F1DB v2026.17.0 (driver.nationality_country_id = United Kingdom) |
| Lando Norris (`lando-norris`) | grid 2026, campeão | Nascimento (data, local e país) | país: Wales | país: Reino Unido | F1DB v2026.17.0 (driver.country_of_birth_country_id) |
| Lando Norris (`lando-norris`) | grid 2026, campeão | Retrato | de 2024 | de 2025 ou 2026 | acervo da Commons |
| Lewis Hamilton (`lewis-hamilton`) | grid 2026, campeão, top 20 vitórias, top 20 GPs | País e nacionalidade | GB Wales | GB Reino Unido | F1DB v2026.17.0 (driver.nationality_country_id = United Kingdom) |
| Lewis Hamilton (`lewis-hamilton`) | grid 2026, campeão, top 20 vitórias, top 20 GPs | Nascimento (data, local e país) | país: Wales | país: Reino Unido | F1DB v2026.17.0 (driver.country_of_birth_country_id) |
| Lewis Hamilton (`lewis-hamilton`) | grid 2026, campeão, top 20 vitórias, top 20 GPs | Retrato | de 2013 | de 2025 ou 2026 | acervo da Commons |
| Lewis Hamilton (`lewis-hamilton`) | grid 2026, campeão, top 20 vitórias, top 20 GPs | Fundo do heading | sem foto (carro de destaque é de outra equipe) | carro em CC BY, CC0 ou domínio público | acervo da Commons |
| Mike Hawthorn (`mike-hawthorn`) | campeão | País e nacionalidade | GB Wales | GB Reino Unido | F1DB v2026.17.0 (driver.nationality_country_id = United Kingdom) |
| Mike Hawthorn (`mike-hawthorn`) | campeão | Nascimento (data, local e país) | país: Wales | país: Reino Unido | F1DB v2026.17.0 (driver.country_of_birth_country_id) |
| Alexander Albon (`alexander-albon`) | grid 2026 | Nascimento (data, local e país) | país: Wales | país: Reino Unido | F1DB v2026.17.0 (driver.country_of_birth_country_id) |
| Alexander Albon (`alexander-albon`) | grid 2026 | Retrato | sem retrato | retrato da Commons | acervo da Commons (assets:commons) |
| Alexander Albon (`alexander-albon`) | grid 2026 | Fundo do heading | sem foto (nenhuma foto de carro no acervo) | carro em CC BY, CC0 ou domínio público | acervo da Commons |
| Fernando Alonso (`fernando-alonso`) | grid 2026, campeão, top 20 vitórias, top 20 GPs | Retrato | de 2016 | de 2025 ou 2026 | acervo da Commons |
| Fernando Alonso (`fernando-alonso`) | grid 2026, campeão, top 20 vitórias, top 20 GPs | Fundo do heading | sem foto (carro de destaque é de outra equipe) | carro em CC BY, CC0 ou domínio público | acervo da Commons |
| Jim Clark (`jim-clark`) | campeão, top 20 vitórias | País e nacionalidade | GB Wales | GB Reino Unido | F1DB v2026.17.0 (driver.nationality_country_id = United Kingdom) |
| Jim Clark (`jim-clark`) | campeão, top 20 vitórias | Nascimento (data, local e país) | país: Wales | país: Reino Unido | F1DB v2026.17.0 (driver.country_of_birth_country_id) |
| Lance Stroll (`lance-stroll`) | grid 2026 | Retrato | sem retrato | retrato da Commons | acervo da Commons (assets:commons) |
| Lance Stroll (`lance-stroll`) | grid 2026 | Fundo do heading | sem foto (nenhuma foto de carro no acervo) | carro em CC BY, CC0 ou domínio público | acervo da Commons |
| Oliver Bearman (`oliver-bearman`) | grid 2026 | País e nacionalidade | GB Wales | GB Reino Unido | F1DB v2026.17.0 (driver.nationality_country_id = United Kingdom) |
| Oliver Bearman (`oliver-bearman`) | grid 2026 | Nascimento (data, local e país) | país: Wales | país: Reino Unido | F1DB v2026.17.0 (driver.country_of_birth_country_id) |
| Oliver Bearman (`oliver-bearman`) | grid 2026 | Retrato | sem retrato | retrato da Commons | acervo da Commons (assets:commons) |
| Oliver Bearman (`oliver-bearman`) | grid 2026 | Fundo do heading | sem foto (só há carro em CC BY-SA) | carro em CC BY, CC0 ou domínio público | acervo da Commons |
| Sergio Pérez (`sergio-perez`) | grid 2026, top 20 GPs | Retrato | de 2012 | de 2025 ou 2026 | acervo da Commons |
| Sergio Pérez (`sergio-perez`) | grid 2026, top 20 GPs | Fundo do heading | sem foto (só há carro em CC BY-SA) | carro em CC BY, CC0 ou domínio público | acervo da Commons |
| Alberto Ascari (`alberto-ascari`) | campeão | Fundo do heading | sem foto (só há carro em CC BY-SA) | carro em CC BY, CC0 ou domínio público | acervo da Commons |
| Damon Hill (`damon-hill`) | campeão, top 20 vitórias | País e nacionalidade | GB Wales | GB Reino Unido | F1DB v2026.17.0 (driver.nationality_country_id = United Kingdom) |
| Damon Hill (`damon-hill`) | campeão, top 20 vitórias | Nascimento (data, local e país) | país: Wales | país: Reino Unido | F1DB v2026.17.0 (driver.country_of_birth_country_id) |
| David Coulthard (`david-coulthard`) | top 20 GPs | País e nacionalidade | GB Wales | GB Reino Unido | F1DB v2026.17.0 (driver.nationality_country_id = United Kingdom) |
| David Coulthard (`david-coulthard`) | top 20 GPs | Nascimento (data, local e país) | país: Wales | país: Reino Unido | F1DB v2026.17.0 (driver.country_of_birth_country_id) |
| Franco Colapinto (`franco-colapinto`) | grid 2026 | Retrato | sem retrato | retrato da Commons | acervo da Commons (assets:commons) |
| Franco Colapinto (`franco-colapinto`) | grid 2026 | Fundo do heading | sem foto (nenhuma foto de carro no acervo) | carro em CC BY, CC0 ou domínio público | acervo da Commons |
| Gabriel Bortoleto (`gabriel-bortoleto`) | grid 2026 | Retrato | sem retrato | retrato da Commons | acervo da Commons (assets:commons) |
| Gabriel Bortoleto (`gabriel-bortoleto`) | grid 2026 | Fundo do heading | sem foto (nenhuma foto de carro no acervo) | carro em CC BY, CC0 ou domínio público | acervo da Commons |
| Graham Hill (`graham-hill`) | campeão | País e nacionalidade | GB Wales | GB Reino Unido | F1DB v2026.17.0 (driver.nationality_country_id = United Kingdom) |
| Graham Hill (`graham-hill`) | campeão | Nascimento (data, local e país) | país: Wales | país: Reino Unido | F1DB v2026.17.0 (driver.country_of_birth_country_id) |
| Jackie Stewart (`jackie-stewart`) | campeão, top 20 vitórias | País e nacionalidade | GB Wales | GB Reino Unido | F1DB v2026.17.0 (driver.nationality_country_id = United Kingdom) |
| Jackie Stewart (`jackie-stewart`) | campeão, top 20 vitórias | Nascimento (data, local e país) | país: Wales | país: Reino Unido | F1DB v2026.17.0 (driver.country_of_birth_country_id) |
| Jacques Villeneuve (`jacques-villeneuve`) | campeão | Retrato | sem retrato | retrato da Commons | acervo da Commons (assets:commons) |
| Jacques Villeneuve (`jacques-villeneuve`) | campeão | Fundo do heading | sem foto (só há carro em CC BY-SA) | carro em CC BY, CC0 ou domínio público | acervo da Commons |
| James Hunt (`james-hunt`) | campeão | País e nacionalidade | GB Wales | GB Reino Unido | F1DB v2026.17.0 (driver.nationality_country_id = United Kingdom) |
| James Hunt (`james-hunt`) | campeão | Nascimento (data, local e país) | país: Wales | país: Reino Unido | F1DB v2026.17.0 (driver.country_of_birth_country_id) |
| Jenson Button (`jenson-button`) | campeão, top 20 vitórias, top 20 GPs | País e nacionalidade | GB Wales | GB Reino Unido | F1DB v2026.17.0 (driver.nationality_country_id = United Kingdom) |
| Jenson Button (`jenson-button`) | campeão, top 20 vitórias, top 20 GPs | Nascimento (data, local e país) | país: Wales | país: Reino Unido | F1DB v2026.17.0 (driver.country_of_birth_country_id) |
| John Surtees (`john-surtees`) | campeão | País e nacionalidade | GB Wales | GB Reino Unido | F1DB v2026.17.0 (driver.nationality_country_id = United Kingdom) |
| John Surtees (`john-surtees`) | campeão | Nascimento (data, local e país) | país: Wales | país: Reino Unido | F1DB v2026.17.0 (driver.country_of_birth_country_id) |
| Kimi Räikkönen (`kimi-raikkonen`) | campeão, top 20 vitórias, top 20 GPs | Fundo do heading | sem foto (só há carro em CC BY-SA) | carro em CC BY, CC0 ou domínio público | acervo da Commons |
| Liam Lawson (`liam-lawson`) | grid 2026 | Retrato | sem retrato | retrato da Commons | acervo da Commons (assets:commons) |
| Liam Lawson (`liam-lawson`) | grid 2026 | Fundo do heading | sem foto (nenhuma foto de carro no acervo) | carro em CC BY, CC0 ou domínio público | acervo da Commons |
| Max Verstappen (`max-verstappen`) | grid 2026, campeão, top 20 vitórias, top 20 GPs | Retrato | de 2024 | de 2025 ou 2026 | acervo da Commons |
| Max Verstappen (`max-verstappen`) | grid 2026, campeão, top 20 vitórias, top 20 GPs | Fundo do heading | sem foto (só há carro em CC BY-SA) | carro em CC BY, CC0 ou domínio público | acervo da Commons |
| Michael Schumacher (`michael-schumacher`) | campeão, top 20 vitórias, top 20 GPs | Fundo do heading | sem foto (só há carro em CC BY-SA) | carro em CC BY, CC0 ou domínio público | acervo da Commons |
| Nico Hülkenberg (`nico-hulkenberg`) | grid 2026, top 20 GPs | Retrato | de 2019 | de 2025 ou 2026 | acervo da Commons |
| Nico Hülkenberg (`nico-hulkenberg`) | grid 2026, top 20 GPs | Fundo do heading | sem foto (carro de destaque é de outra equipe) | carro em CC BY, CC0 ou domínio público | acervo da Commons |
| Nigel Mansell (`nigel-mansell`) | campeão, top 20 vitórias | País e nacionalidade | GB Wales | GB Reino Unido | F1DB v2026.17.0 (driver.nationality_country_id = United Kingdom) |
| Nigel Mansell (`nigel-mansell`) | campeão, top 20 vitórias | Nascimento (data, local e país) | país: Wales | país: Reino Unido | F1DB v2026.17.0 (driver.country_of_birth_country_id) |
| Pierre Gasly (`pierre-gasly`) | grid 2026 | Retrato | sem retrato | retrato da Commons | acervo da Commons (assets:commons) |
| Pierre Gasly (`pierre-gasly`) | grid 2026 | Fundo do heading | sem foto (nenhuma foto de carro no acervo) | carro em CC BY, CC0 ou domínio público | acervo da Commons |
| Valtteri Bottas (`valtteri-bottas`) | grid 2026, top 20 GPs | Fundo do heading | sem foto (carro de destaque é de outra equipe) | carro em CC BY, CC0 ou domínio público | acervo da Commons |
| Yuki Tsunoda (`yuki-tsunoda`) | grid 2026 | Retrato | sem retrato | retrato da Commons | acervo da Commons (assets:commons) |
| Yuki Tsunoda (`yuki-tsunoda`) | grid 2026 | Fundo do heading | sem foto (nenhuma foto de carro no acervo) | carro em CC BY, CC0 ou domínio público | acervo da Commons |
| Esteban Ocon (`esteban-ocon`) | grid 2026 | Retrato | sem retrato | retrato da Commons | acervo da Commons (assets:commons) |
| Esteban Ocon (`esteban-ocon`) | grid 2026 | Fundo do heading | sem foto (nenhuma foto de carro no acervo) | carro em CC BY, CC0 ou domínio público | acervo da Commons |
| Giancarlo Fisichella (`giancarlo-fisichella`) | top 20 GPs | Fundo do heading | sem foto (só há carro em CC BY-SA) | carro em CC BY, CC0 ou domínio público | acervo da Commons |
| Isack Hadjar (`isack-hadjar`) | grid 2026 | Retrato | sem retrato | retrato da Commons | acervo da Commons (assets:commons) |
| Isack Hadjar (`isack-hadjar`) | grid 2026 | Fundo do heading | sem foto (nenhuma foto de carro no acervo) | carro em CC BY, CC0 ou domínio público | acervo da Commons |
| Jarno Trulli (`jarno-trulli`) | top 20 GPs | Fundo do heading | sem foto (só há carro em CC BY-SA) | carro em CC BY, CC0 ou domínio público | acervo da Commons |
| Kimi Antonelli (`kimi-antonelli`) | grid 2026 | Retrato | sem retrato | retrato da Commons | acervo da Commons (assets:commons) |
| Kimi Antonelli (`kimi-antonelli`) | grid 2026 | Fundo do heading | sem foto (nenhuma foto de carro no acervo) | carro em CC BY, CC0 ou domínio público | acervo da Commons |
| Oscar Piastri (`oscar-piastri`) | grid 2026 | Retrato | sem retrato | retrato da Commons | acervo da Commons (assets:commons) |
| Jody Scheckter (`jody-scheckter`) | campeão | Fundo do heading | sem foto (só há carro em CC BY-SA) | carro em CC BY, CC0 ou domínio público | acervo da Commons |
