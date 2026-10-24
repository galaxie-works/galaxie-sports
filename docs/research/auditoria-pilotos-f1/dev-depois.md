# Auditoria dos perfis de piloto da F1

Gerado em 2026-10-24T20:59:43.872Z · dev (NAS), código deste PR com o F1DB reimportado · F1DB v2026.17.0 · temporada atual 2026 (faltam 6 GPs) · idioma pt-BR

- Pilotos com ao menos um GP no F1DB: 792; auditados: 792; prioritários (grid 2026, campeões, top 20 em vitórias e em GPs): 64.
- Problemas: 1834 em 771 pilotos.

## Placar por campo

| Campo | Errados (todos) | Errados (prioritários) | ↗ De outras frentes | Observação |
|---|---:|---:|---:|---|
| País e nacionalidade | 0 de 792 | 0 de 64 |  |  |
| Nascimento (data, local e país) | 0 de 792 | 0 de 64 |  |  |
| Número permanente | 0 de 792 | 0 de 64 |  |  |
| Número da temporada selecionada | 0 de 792 | 0 de 64 |  |  |
| Títulos mundiais (quantidade e anos) | 0 de 792 | 0 de 64 |  |  |
| GPs disputados | 0 de 792 | 0 de 64 |  |  |
| Vitórias | 0 de 792 | 0 de 64 |  |  |
| Pódios | 0 de 792 | 0 de 64 |  |  |
| Poles | 0 de 792 | 0 de 64 |  |  |
| Pontos | 0 de 792 | 0 de 64 |  |  |
| Melhor resultado (com contagem) | 1 de 792 | 0 de 64 |  |  |
| Abandonos | 0 de 792 | 0 de 64 |  |  |
| Equipe da temporada selecionada | 1 de 792 | 0 de 64 |  |  |
| Cor da equipe (curadoria e contraste) | 1 de 792 | 0 de 64 |  |  |
| Pintura da época sem curadoria | 0 de 792 | 0 de 64 | 371 | fora do escopo: lacuna do liveries.yaml (curadoria com fonte e revisão), não erro de código |
| Campanha da temporada atual | 0 de 792 | 0 de 64 |  |  |
| Retrato | 0 de 792 | 0 de 64 | 760 | fora do escopo: retrato mais recente: sessão "Fotos da F1 para o grid atual" |
| Fundo do heading | 0 de 792 | 0 de 64 | 700 | fora do escopo: fotos do grid de 2026 e fallback do carro: sessão "Fotos da F1 para o grid atual" |
| Nome (primeiro nome e sobrenome) | 0 de 792 | 0 de 64 |  |  |

## Problemas

| Piloto | Prioridade | Campo | Valor atual | Valor certo | Fonte |
|---|---|---|---|---|---|
| Guanyu Zhou (`guanyu-zhou`) | — | Melhor resultado (com contagem) | 8º (x1) | 8º (x2) | F1DB v2026.17.0 (race_data RACE_RESULT) |
| Guanyu Zhou (`guanyu-zhou`) | — | Equipe da temporada selecionada | 2024: Sauber F1 Team (sauber) | 2024: kick-sauber | F1DB v2026.17.0 (race_data.constructor_id com mais corridas largadas) |
| Guanyu Zhou (`guanyu-zhou`) | — | Cor da equipe (curadoria e contraste) | 2024: sem pintura | 2024: #00e701 | liveries.yaml (kick-sauber) |

## De outras frentes (só listados)

Só os 64 prioritários; o placar acima conta todos (`--completo` lista todos).

| Piloto | Prioridade | Campo | Valor atual | Valor certo | Fonte |
|---|---|---|---|---|---|
| Alexander Albon (`alexander-albon`) | grid 2026 | Retrato | sem retrato | retrato da Commons | acervo da Commons (assets:commons) |
| Alexander Albon (`alexander-albon`) | grid 2026 | Fundo do heading | sem foto (nenhuma foto de carro no acervo) | carro em CC BY, CC0 ou domínio público | acervo da Commons |
| Arvid Lindblad (`arvid-lindblad`) | grid 2026 | Retrato | sem retrato | retrato da Commons | acervo da Commons (assets:commons) |
| Arvid Lindblad (`arvid-lindblad`) | grid 2026 | Fundo do heading | sem foto (nenhuma foto de carro no acervo) | carro em CC BY, CC0 ou domínio público | acervo da Commons |
| Carlos Sainz Jr. (`carlos-sainz-jr`) | grid 2026, top 20 GPs | Retrato | de 2021 | de 2025 ou 2026 | acervo da Commons |
| Carlos Sainz Jr. (`carlos-sainz-jr`) | grid 2026, top 20 GPs | Fundo do heading | sem foto (carro de destaque só em CC BY-SA) | carro em CC BY, CC0 ou domínio público | acervo da Commons |
| Charles Leclerc (`charles-leclerc`) | grid 2026 | Retrato | sem retrato | retrato da Commons | acervo da Commons (assets:commons) |
| Charles Leclerc (`charles-leclerc`) | grid 2026 | Fundo do heading | sem foto (só há carro em CC BY-SA) | carro em CC BY, CC0 ou domínio público | acervo da Commons |
| Esteban Ocon (`esteban-ocon`) | grid 2026 | Retrato | sem retrato | retrato da Commons | acervo da Commons (assets:commons) |
| Esteban Ocon (`esteban-ocon`) | grid 2026 | Fundo do heading | sem foto (nenhuma foto de carro no acervo) | carro em CC BY, CC0 ou domínio público | acervo da Commons |
| Fernando Alonso (`fernando-alonso`) | grid 2026, campeão, top 20 vitórias, top 20 GPs | Retrato | de 2016 | de 2025 ou 2026 | acervo da Commons |
| Fernando Alonso (`fernando-alonso`) | grid 2026, campeão, top 20 vitórias, top 20 GPs | Fundo do heading | sem foto (carro de destaque só em CC BY-SA) | carro em CC BY, CC0 ou domínio público | acervo da Commons |
| Franco Colapinto (`franco-colapinto`) | grid 2026 | Retrato | sem retrato | retrato da Commons | acervo da Commons (assets:commons) |
| Franco Colapinto (`franco-colapinto`) | grid 2026 | Fundo do heading | sem foto (nenhuma foto de carro no acervo) | carro em CC BY, CC0 ou domínio público | acervo da Commons |
| Gabriel Bortoleto (`gabriel-bortoleto`) | grid 2026 | Retrato | sem retrato | retrato da Commons | acervo da Commons (assets:commons) |
| Gabriel Bortoleto (`gabriel-bortoleto`) | grid 2026 | Fundo do heading | sem foto (nenhuma foto de carro no acervo) | carro em CC BY, CC0 ou domínio público | acervo da Commons |
| George Russell (`george-russell`) | grid 2026 | Retrato | sem retrato | retrato da Commons | acervo da Commons (assets:commons) |
| George Russell (`george-russell`) | grid 2026 | Fundo do heading | sem foto (há carro livre em 2020, mas de outra equipe) | carro em CC BY, CC0 ou domínio público | acervo da Commons |
| Giancarlo Fisichella (`giancarlo-fisichella`) | top 20 GPs | Retrato | sem retrato | retrato da Commons | acervo da Commons (assets:commons) |
| Giancarlo Fisichella (`giancarlo-fisichella`) | top 20 GPs | Fundo do heading | sem foto (carro de destaque só em CC BY-SA) | carro em CC BY, CC0 ou domínio público | acervo da Commons |
| Isack Hadjar (`isack-hadjar`) | grid 2026 | Retrato | sem retrato | retrato da Commons | acervo da Commons (assets:commons) |
| Isack Hadjar (`isack-hadjar`) | grid 2026 | Fundo do heading | sem foto (nenhuma foto de carro no acervo) | carro em CC BY, CC0 ou domínio público | acervo da Commons |
| Jackie Stewart (`jackie-stewart`) | campeão, top 20 vitórias | Retrato | sem retrato | retrato da Commons | acervo da Commons (assets:commons) |
| Jackie Stewart (`jackie-stewart`) | campeão, top 20 vitórias | Fundo do heading | sem foto (carro de destaque só em CC BY-SA) | carro em CC BY, CC0 ou domínio público | acervo da Commons |
| Jody Scheckter (`jody-scheckter`) | campeão | Retrato | sem retrato | retrato da Commons | acervo da Commons (assets:commons) |
| Jody Scheckter (`jody-scheckter`) | campeão | Fundo do heading | sem foto (carro de destaque só em CC BY-SA) | carro em CC BY, CC0 ou domínio público | acervo da Commons |
| John Surtees (`john-surtees`) | campeão | Retrato | sem retrato | retrato da Commons | acervo da Commons (assets:commons) |
| John Surtees (`john-surtees`) | campeão | Fundo do heading | sem foto (carro de destaque só em CC BY-SA) | carro em CC BY, CC0 ou domínio público | acervo da Commons |
| Kimi Antonelli (`kimi-antonelli`) | grid 2026 | Retrato | sem retrato | retrato da Commons | acervo da Commons (assets:commons) |
| Kimi Antonelli (`kimi-antonelli`) | grid 2026 | Fundo do heading | sem foto (nenhuma foto de carro no acervo) | carro em CC BY, CC0 ou domínio público | acervo da Commons |
| Lance Stroll (`lance-stroll`) | grid 2026 | Retrato | sem retrato | retrato da Commons | acervo da Commons (assets:commons) |
| Lance Stroll (`lance-stroll`) | grid 2026 | Fundo do heading | sem foto (nenhuma foto de carro no acervo) | carro em CC BY, CC0 ou domínio público | acervo da Commons |
| Lando Norris (`lando-norris`) | grid 2026, campeão | Retrato | de 2024 | de 2025 ou 2026 | acervo da Commons |
| Lando Norris (`lando-norris`) | grid 2026, campeão | Fundo do heading | sem foto (carro de destaque só em CC BY-SA) | carro em CC BY, CC0 ou domínio público | acervo da Commons |
| Lewis Hamilton (`lewis-hamilton`) | grid 2026, campeão, top 20 vitórias, top 20 GPs | Retrato | de 2022 | de 2025 ou 2026 | acervo da Commons |
| Lewis Hamilton (`lewis-hamilton`) | grid 2026, campeão, top 20 vitórias, top 20 GPs | Fundo do heading | sem foto (carro de destaque é de outra equipe) | carro em CC BY, CC0 ou domínio público | acervo da Commons |
| Liam Lawson (`liam-lawson`) | grid 2026 | Retrato | sem retrato | retrato da Commons | acervo da Commons (assets:commons) |
| Liam Lawson (`liam-lawson`) | grid 2026 | Fundo do heading | sem foto (nenhuma foto de carro no acervo) | carro em CC BY, CC0 ou domínio público | acervo da Commons |
| Max Verstappen (`max-verstappen`) | grid 2026, campeão, top 20 vitórias, top 20 GPs | Retrato | de 2024 | de 2025 ou 2026 | acervo da Commons |
| Max Verstappen (`max-verstappen`) | grid 2026, campeão, top 20 vitórias, top 20 GPs | Fundo do heading | sem foto (carro de destaque só em CC BY-SA) | carro em CC BY, CC0 ou domínio público | acervo da Commons |
| Nico Hülkenberg (`nico-hulkenberg`) | grid 2026, top 20 GPs | Retrato | de 2019 | de 2025 ou 2026 | acervo da Commons |
| Nico Hülkenberg (`nico-hulkenberg`) | grid 2026, top 20 GPs | Fundo do heading | sem foto (carro de destaque é de outra equipe) | carro em CC BY, CC0 ou domínio público | acervo da Commons |
| Nino Farina (`nino-farina`) | campeão | Retrato | sem retrato | retrato da Commons | acervo da Commons (assets:commons) |
| Nino Farina (`nino-farina`) | campeão | Fundo do heading | sem foto (carro de destaque só em CC BY-SA) | carro em CC BY, CC0 ou domínio público | acervo da Commons |
| Oliver Bearman (`oliver-bearman`) | grid 2026 | Retrato | sem retrato | retrato da Commons | acervo da Commons (assets:commons) |
| Oliver Bearman (`oliver-bearman`) | grid 2026 | Fundo do heading | sem foto (só há carro em CC BY-SA) | carro em CC BY, CC0 ou domínio público | acervo da Commons |
| Oscar Piastri (`oscar-piastri`) | grid 2026 | Retrato | sem retrato | retrato da Commons | acervo da Commons (assets:commons) |
| Oscar Piastri (`oscar-piastri`) | grid 2026 | Fundo do heading | sem foto (só há carro em CC BY-SA) | carro em CC BY, CC0 ou domínio público | acervo da Commons |
| Pierre Gasly (`pierre-gasly`) | grid 2026 | Retrato | sem retrato | retrato da Commons | acervo da Commons (assets:commons) |
| Pierre Gasly (`pierre-gasly`) | grid 2026 | Fundo do heading | sem foto (nenhuma foto de carro no acervo) | carro em CC BY, CC0 ou domínio público | acervo da Commons |
| Sergio Pérez (`sergio-perez`) | grid 2026, top 20 GPs | Retrato | sem retrato | retrato da Commons | acervo da Commons (assets:commons) |
| Sergio Pérez (`sergio-perez`) | grid 2026, top 20 GPs | Fundo do heading | sem foto (carro de destaque só em CC BY-SA) | carro em CC BY, CC0 ou domínio público | acervo da Commons |
| Yuki Tsunoda (`yuki-tsunoda`) | grid 2026 | Retrato | sem retrato | retrato da Commons | acervo da Commons (assets:commons) |
| Yuki Tsunoda (`yuki-tsunoda`) | grid 2026 | Fundo do heading | sem foto (nenhuma foto de carro no acervo) | carro em CC BY, CC0 ou domínio público | acervo da Commons |
| Alan Jones (`alan-jones`) | campeão | Fundo do heading | sem foto (carro de destaque só em CC BY-SA) | carro em CC BY, CC0 ou domínio público | acervo da Commons |
| Alberto Ascari (`alberto-ascari`) | campeão | Fundo do heading | sem foto (carro de destaque só em CC BY-SA) | carro em CC BY, CC0 ou domínio público | acervo da Commons |
| David Coulthard (`david-coulthard`) | top 20 GPs | Fundo do heading | sem foto (carro de destaque só em CC BY-SA) | carro em CC BY, CC0 ou domínio público | acervo da Commons |
| Emerson Fittipaldi (`emerson-fittipaldi`) | campeão, top 20 vitórias | Retrato | sem retrato | retrato da Commons | acervo da Commons (assets:commons) |
| Felipe Massa (`felipe-massa`) | top 20 GPs | Fundo do heading | sem foto (carro de destaque só em CC BY-SA) | carro em CC BY, CC0 ou domínio público | acervo da Commons |
| Jarno Trulli (`jarno-trulli`) | top 20 GPs | Fundo do heading | sem foto (carro de destaque só em CC BY-SA) | carro em CC BY, CC0 ou domínio público | acervo da Commons |
| Jenson Button (`jenson-button`) | campeão, top 20 vitórias, top 20 GPs | Fundo do heading | sem foto (carro de destaque só em CC BY-SA) | carro em CC BY, CC0 ou domínio público | acervo da Commons |
| Juan Manuel Fangio (`juan-manuel-fangio`) | campeão, top 20 vitórias | Fundo do heading | sem foto (carro de destaque só em CC BY-SA) | carro em CC BY, CC0 ou domínio público | acervo da Commons |
| Keke Rosberg (`keke-rosberg`) | campeão | Fundo do heading | sem foto (carro de destaque só em CC BY-SA) | carro em CC BY, CC0 ou domínio público | acervo da Commons |
| Kimi Räikkönen (`kimi-raikkonen`) | campeão, top 20 vitórias, top 20 GPs | Fundo do heading | sem foto (carro de destaque só em CC BY-SA) | carro em CC BY, CC0 ou domínio público | acervo da Commons |
| Mario Andretti (`mario-andretti`) | campeão | Fundo do heading | sem foto (carro de destaque só em CC BY-SA) | carro em CC BY, CC0 ou domínio público | acervo da Commons |
| Mark Webber (`mark-webber`) | top 20 GPs | Retrato | sem retrato | retrato da Commons | acervo da Commons (assets:commons) |
| Mike Hawthorn (`mike-hawthorn`) | campeão | Retrato | sem retrato | retrato da Commons | acervo da Commons (assets:commons) |
| Rubens Barrichello (`rubens-barrichello`) | top 20 GPs | Retrato | sem retrato | retrato da Commons | acervo da Commons (assets:commons) |
| Stirling Moss (`stirling-moss`) | top 20 vitórias | Retrato | sem retrato | retrato da Commons | acervo da Commons (assets:commons) |
| Valtteri Bottas (`valtteri-bottas`) | grid 2026, top 20 GPs | Fundo do heading | sem foto (carro de destaque é de outra equipe) | carro em CC BY, CC0 ou domínio público | acervo da Commons |
