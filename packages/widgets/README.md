# @galaxie/widgets

Widgets React da Galaxie Sports e o gerador do item de registry shadcn usado pelo **Galaxie Sports Builder**.
A operadora monta o widget com a identidade dela na demo e instala no app dela com `npx shadcn add <url>`.

| `kind`           | Componente       | No registry             | Props obrigatórias  | Rota da API (módulo)                                 |
| ---------------- | ---------------- | ----------------------- | ------------------- | ---------------------------------------------------- |
| `match_card`     | `MatchCard`      | `GalaxieMatchCard`      | `eventId`           | `/v1/events/{id}`                                    |
| `live_list`      | `LiveList`       | `GalaxieLiveList`       | —                   | `/v1/events`, `/v1/events/live`                      |
| `standings`      | `StandingsTable` | `GalaxieStandingsTable` | `competitionId`     | `/v1/competitions/{id}/seasons/{s}/standings`        |
| `where_to_watch` | `WhereToWatch`   | `GalaxieWhereToWatch`   | `eventId`, `market` | `/v1/events/{id}/where-to-watch` (`where_to_watch`)  |
| `ai_context`     | `AiContext`      | `GalaxieAiContext`      | `eventId`           | `/v1/events/{id}/context` (`live_intelligence`)      |
| `match_stakes`   | `MatchStakes`    | `GalaxieMatchStakes`    | `eventId`           | `/v1/events/{id}` (stakes, `fan_tags`, `cheer`)      |
| `related_videos` | `RelatedVideos`  | `GalaxieRelatedVideos`  | `eventId`           | `/v1/events/{id}/related` (add-on `related_content`) |
| `head_to_head`   | `HeadToHead`     | `GalaxieHeadToHead`     | `eventId`           | `/v1/events/{id}/h2h`                                |
| `team_schedule`  | `TeamSchedule`   | `GalaxieTeamSchedule`   | `teamId`            | `/v1/teams/{id}/events`                              |

Sem módulo indicado, a rota é do `core_data`. Uma chave publicável presa a um widget só alcança os módulos do
tipo dele (`WIDGET_KIND_MODULES` em `@galaxie/db`); o tenant sem o módulo vê o aviso de 403 no lugar do widget.
Os vídeos tocam no player oficial do YouTube dentro do widget (só `https://www.youtube.com/...` vira iframe).

Os componentes só dependem de React (18 ou 19), não usam Tailwind nem Next e buscam os dados na API pública
(`/v1/...`) com a chave publicável. Têm estados de carregamento, erro (com o 403 de chave sem o módulo
explicado) e vazio, e o placar e os jogos do dia fazem polling leve (30 s com jogo ao vivo, pausado com a aba
escondida). O SSE `/v1/stream` não aceita a chave publicável (o `EventSource` não manda header).

## Instalação pelo registry (app da operadora)

```bash
npx shadcn@latest add https://<demo>/r/<widget>.json
```

O item instala dois arquivos em `components/galaxie/`:

- `galaxie-core.tsx`: núcleo comum (tema, textos, cliente da API, provider). É igual em todos os widgets: na
  segunda instalação o shadcn pula o arquivo por ser idêntico;
- `<nome-do-widget>.tsx`: o widget escolhido, com o tema salvo no Builder embutido (`GALAXIE_THEME`), exportando
  `Galaxie<Componente>`.

Também adiciona `NEXT_PUBLIC_GALAXIE_PUBLISHABLE_KEY` ao `.env.local` e as cores do tema como tokens
(`--gs-primary`…, ou seja, `bg-gs-primary` no Tailwind) no CSS global, para o resto da página acompanhar.

```tsx
import { GalaxieMatchCard } from '@/components/galaxie/placar-operadora-exemplo';

<GalaxieMatchCard />                                     // evento salvo no Builder, chave da env
<GalaxieMatchCard eventId={id} publishableKey="pk_..." /> // ou tudo por prop
<GalaxieMatchCard baseUrl="/api/galaxie" theme={{ primary: '#ff0055' }} />
```

Todas as versões aceitam `publishableKey`, `baseUrl` (ex.: um proxy no backend da operadora, docs/05 §1.3),
`locale` (`pt-BR`, `es`, `en`), `market` (ISO2), `theme` (parcial, por cima do salvo) e `className`.
Com o proxy na mesma origem da página (`baseUrl` relativo, como `/api/galaxie`, ou a própria origem), a chave
pode ficar vazia: o widget chama sem o header `x-galaxie-publishable-key`. Base de outra origem sem chave mostra
o aviso de chave ausente, sem chamar a API.

Polling: 30 s com o jogo ao vivo, 1 min nos 30 min antes do início; jogo agendado mais longe acorda quando entra
nessa janela (no máximo a cada 6 h). Encerrado, adiado ou cancelado não atualiza mais.

## Embed HTML (qualquer site)

Para portais, WordPress e sites sem React: o script registra o elemento `<galaxie-widget>` e cada elemento
lê a configuração salva no Builder em `/e/<id>.json` (tema, idioma, mercado, entidade padrão e base da API).

```html
<script src="https://sports.galaxie.works/embed.js" async></script>
<galaxie-widget widget="<id do widget>" key="gs_pk_live_..."></galaxie-widget>
<!-- opcionais: event-id, competition-id, team-id, locale, market -->
```

- O widget desenha num Shadow DOM: o CSS do tema do site não entra e o do widget não sai.
- As chamadas à API saem da página do portal, então a API confere a origem do site contra as origens
  permitidas da chave publicável. A chave copiada para outro domínio não funciona.
- Salvar o widget no Builder muda o visual em todos os sites (cache de 60 s na configuração).
- `scripts/build-embed.mjs` (no `build`) empacota `src/embed/entry.ts` com o React em `dist/embed.js` e
  exporta o mesmo texto em `@galaxie/widgets/embed-script` (`EMBED_SCRIPT`, `EMBED_VERSION`), que a rota
  `/embed.js` da demo serve. Cerca de 80 KB com gzip, quase tudo React.

## Uso como pacote (demo e Builder)

```tsx
import { DEFAULT_THEMES, GalaxieWidgetProvider, MatchCard, createPreviewFetch } from '@galaxie/widgets';

<GalaxieWidgetProvider
  baseUrl={apiUrl}
  publishableKey={key}
  theme={DEFAULT_THEMES.dark}
  locale="pt-BR"
  market="BR"
>
  <MatchCard eventId={id} />
</GalaxieWidgetProvider>;

// preview sem chave: dados de exemplo no lugar da API (ids em PREVIEW_IDS / WIDGET_CATALOG[kind].exampleProps)
<GalaxieWidgetProvider fetch={createPreviewFetch()} /* … */ />;
```

`WIDGET_CATALOG[kind]` traz nome e descrição em pt/es/en, props obrigatórias e opcionais e as props de exemplo.

## Tema

`WidgetTheme = { primary, background, surface, foreground, mutedForeground, border, radius, fontFamily, density, mode }`.
`themeToCssVars(theme)` gera as CSS variables `--gs-*` que o provider aplica na raiz `.gs-root` (o widget não
depende do CSS global). Presets em `DEFAULT_THEMES`: `dark`, `light`, `emerald` e `sunset` (rótulos em
`THEME_PRESET_LABELS`). Para trocar um detalhe sem mexer no tema, sobrescreva a variable no CSS da página
(`.gs-root { --gs-radius: 4px }`).

## Chave publicável

A chave publicável vai no header `x-galaxie-publishable-key` e só vale para GET em `/v1/*`. Uma chave presa a
um widget libera só os módulos daquele tipo: com o módulo fora do plano a API responde 403 e o widget mostra
"Esta chave não libera este conteúdo". Nunca use a chave secreta (`x-galaxie-key`) no navegador.

## Gerador do item de registry

```ts
import { buildRegistryItem } from '@galaxie/widgets/registry'; // sem React, para rotas de servidor

const item = buildRegistryItem({
  kind: 'match_card',
  name: 'Placar Operadora Exemplo',
  theme,
  apiBaseUrl: 'https://api.galaxie.sports',
  locale: 'pt-BR', // opcionais
  market: 'BR',
  defaults: { eventId },
});
// Response.json(item) numa rota /r/<id>.json → npx shadcn add <url>
```

Pela linha de comando (depois do build): `node scripts/registry-item.mjs match_card "Placar" --event <id> --out item.json`.

**De onde vêm os fontes.** O registry entrega código-fonte, então o conteúdo dos arquivos sai dos próprios
fontes do pacote: `scripts/embed-sources.mjs` lê `src/core/model.ts` + `src/core/react.tsx` (que viram o
`galaxie-core.tsx`) e `src/widgets/*.tsx` (com os imports trocados por `./galaxie-core`) e grava
`src/registry/sources.generated.ts`. O script roda antes de `build`, `typecheck` e `test`, e o arquivo gerado
fica fora do git, então não há cópia manual para envelhecer. Regras que o script valida: `model.ts` não importa
nada; `react.tsx` só importa de `react` e `./model.js`; os widgets só importam de `react` e de `../core`.
