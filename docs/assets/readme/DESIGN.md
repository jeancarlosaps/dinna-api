# Sistema visual dos READMEs Dinna

Regras compartilhadas pelas ilustrações do [dinna-flutter](https://github.com/jeancarlosaps/dinna-flutter) e do [dinna-api](https://github.com/jeancarlosaps/dinna-api). Os dois repositórios usam a mesma linguagem visual com papéis diferentes: o **app** é o salão, claro e acolhedor; a **API** é a operação, em tom espresso.

## Marca

- Wordmark `dinna.` em minúsculas, com o ponto em terracota. É a mesma marca usada nas Atividades 1 e 2.
- Sans 700, tracking −0,035em. Não redesenhe a marca.

## Paleta

Mesmos tokens de [`lib/app/theme/dinna_colors.dart`](https://github.com/jeancarlosaps/dinna-flutter/blob/main/lib/app/theme/dinna_colors.dart), no app, e dos materiais acadêmicos.

| Token           | Hex                   | Uso                                           |
| --------------- | --------------------- | --------------------------------------------- |
| cream           | `#FBF6F0`             | Fundo do app e das ilustrações claras         |
| terracotta      | `#B4532A`             | Marca, ação primária, destaques               |
| terracotta soft | `#F4E3D7`             | Chips, fundos de apoio                        |
| brown (ink)     | `#2A211C`             | Texto principal, moldura do celular           |
| muted           | `#6F625A`             | Texto secundário                              |
| sage            | `#5E7355`             | Sucesso, implementado, restaurante            |
| sage soft       | `#E6ECE1`             | Fundo de status positivo                      |
| amber           | `#A86B12`             | Em andamento                                  |
| amber soft      | `#F6EAD2`             | Pílula de status “em andamento” / “planejado” |
| line            | `#E6DAD0`             | Bordas, divisores                             |
| espresso        | `#211915` → `#3A2B22` | Fundo do hero da API (só nos READMEs)         |

## Tipografia nos SVGs

| Papel           | Família                                                  | Tamanho em 1600px |
| --------------- | -------------------------------------------------------- | ----------------- |
| Wordmark        | Avenir Next → Helvetica Neue → Segoe UI → Roboto → Arial | 168               |
| Tagline         | Iowan Old Style → Charter → Georgia (itálico)            | 46                |
| Título de seção | Serif itálico                                            | 38                |
| Eyebrow         | Sans 700, caixa alta, tracking 4–5                       | 16–18             |
| Rótulo          | Sans 600–700                                             | 19–27             |
| Legenda         | Sans 500                                                 | 17 (mínimo)       |
| Código          | SF Mono → Menlo → Consolas                               | 14–16             |

As fontes não são embutidas e o GitHub usa as do sistema de quem visita. Por isso os layouts reservam folga horizontal para fontes de fallback mais largas.

## Forma

- Moldura das ilustrações: raio 28, borda de 2px (`line` ou `espresso_line`).
- Cards: raio 18–24; chips e pílulas totalmente arredondados.
- Sombras suaves com `feDropShadow` (y 6–24, opacidade 0,10–0,16 no claro e 0,38 no escuro).
- Textura: padrão de pontos com opacidade ≤ 0,07.
- Implementado = traço contínuo e sage; planejado = traço tracejado e `muted`.

## Movimento

- Só nos heros (`hero.svg`): entrada única de até 4 segundos, sem loop.
- `@media (prefers-reduced-motion: reduce)` desliga toda a animação.
- Cada hero animado tem um `hero-still.svg` com a mesma composição, servido pelo `<picture>` do README quando o movimento reduzido está ativo.
- O estado final da animação é igual à versão estática.

## Acessibilidade

- Todo SVG tem `role="img"`, `<title>` e `<desc>`, e todo `<img>` no README tem `alt` descritivo.
- O conteúdo essencial está sempre no Markdown; as imagens ilustram e não substituem o texto.
- As ilustrações têm fundo próprio e funcionam nos temas claro e escuro do GitHub.

## Arquivos deste repositório

| Arquivo                       | Conteúdo                                                                                               |
| ----------------------------- | ------------------------------------------------------------------------------------------------------ |
| `hero.svg` / `hero-still.svg` | “Da mesa à operação”: perfis cliente e restaurante, serviço único e módulos (implementado × planejado) |
| `flow.svg`                    | Ciclo planejado do pedido: `received → preparing → ready → finished`                                   |
| `roadmap.svg`                 | Releases R0–R3 (mesmo arquivo nos dois repositórios)                                                   |

Ao mudar o estado do projeto, atualize os SVGs que representam status (hero da API e `roadmap.svg`) **nos dois repositórios**.
