# Recomendação — desenho da V1

> **Status:** aceito como desenho (SCRUM-60). Sem código de produção.  
> O contrato HTTP normativo está em [`api-contract.md`](api-contract.md), na seção `POST /ai/recommendation`.  
> Este arquivo define perguntas, regras, fallback, política alimentar e estados de tela.  
> A rota ainda não existe. O formato preliminar, com `preferences` string e resposta `productIds` + `fallback`, fica revogado.

## Objetivo

O cliente responde um formulário curto e recebe até três pratos que existem e estão disponíveis no cardápio. A sugestão não cria pedido e não mexe no carrinho. Quem quiser pedir continua pelo cardápio, como no R1.

O fluxo de referência é o do app cliente, no quadro “Me ajuda a escolher”. Os pratos desenhados ali (moqueca, salmão) ilustram a tela. Não são ids do cardápio. A API só pode devolver `productId` lido do banco naquela requisição.

## Escopo

### V1 — esta release

Perguntas de escolha fixa, no Flutter, viram um objeto `preferences`. A API valida esse objeto, lê os produtos disponíveis e escolhe com uma função determinística. O mesmo objeto é a entrada de um provedor externo, quando a SCRUM-62 o ligar.

Não entra nesta versão:

- texto livre na tela ou no JSON;
- segunda rota;
- SDK ou chamada externa;
- gravação de preferência, pedido ou carrinho;
- campo antecipando a versão seguinte. `additionalProperties: false` recusa qualquer campo fora do contrato, inclusive `text`.

### V2 — evolução, sem construir agora

Uma versão futura pode interpretar uma frase e produzir o **mesmo** objeto normalizado que o formulário produz hoje. A validação, o filtro e o fallback não mudam de caminho. Não há dois selecionadores.

O objeto normalizado, interno à API, é:

| Campo          | Valores                                                                                        |
| -------------- | ---------------------------------------------------------------------------------------------- |
| `budget`       | `up_to_20`, `from_21_to_35`, `from_36_to_60`, `unlimited`                                      |
| `hunger`       | `little`, `normal`, `big`                                                                      |
| `protein`      | `chicken`, `fish`, `beef`, `vegetarian`                                                        |
| `style`        | `light`, `balanced`, `full`                                                                    |
| `taste`        | `savory`, `sweet`                                                                              |
| `restrictions` | lista única, nesta ordem estável: `no_onion`, `no_gluten`, `no_lactose`, `vegan`, `no_seafood` |

Na V1 o body HTTP já é esse objeto, com `restrictions` opcional. A ordem enviada pelo cliente não importa: a API ordena pela tabela acima antes de montar o motivo. Não se cria interface, classe base nem porta genérica além da função de seleção e de uma função de provedor, esta só na SCRUM-62, para o teste trocar o Gemini por um fake.

## Perguntas e opções

Os rótulos são os do quadro. Os valores são os que viajam entre Flutter e API. O rótulo pode mudar sem mudar o valor.

| Pergunta na tela                          | Campo          | Obrigatória no envio | Seleção  | Rótulo            | Valor           |
| ----------------------------------------- | -------------- | -------------------- | -------- | ----------------- | --------------- |
| Quanto quer gastar?                       | `budget`       | sim                  | única    | Até R$ 20         | `up_to_20`      |
|                                           |                |                      |          | R$ 21–35          | `from_21_to_35` |
|                                           |                |                      |          | R$ 36–60          | `from_36_to_60` |
|                                           |                |                      |          | Sem limite        | `unlimited`     |
| Qual o tamanho da fome?                   | `hunger`       | sim                  | única    | Pouca             | `little`        |
|                                           |                |                      |          | Normal            | `normal`        |
|                                           |                |                      |          | Muita             | `big`           |
| Proteína preferida                        | `protein`      | sim                  | única    | Frango            | `chicken`       |
|                                           |                |                      |          | Peixe             | `fish`          |
|                                           |                |                      |          | Carne             | `beef`          |
|                                           |                |                      |          | Vegetariano       | `vegetarian`    |
| Leve ou completo?                         | `style`        | sim                  | única    | Leve              | `light`         |
|                                           |                |                      |          | Equilibrado       | `balanced`      |
|                                           |                |                      |          | Completo          | `full`          |
| Doce ou salgado?                          | `taste`        | sim                  | única    | Salgado           | `savory`        |
|                                           |                |                      |          | Doce              | `sweet`         |
| Restrições (opcional, pode marcar várias) | `restrictions` | não                  | múltipla | Sem cebola        | `no_onion`      |
|                                           |                |                      |          | Sem glúten        | `no_gluten`     |
|                                           |                |                      |          | Sem lactose       | `no_lactose`    |
|                                           |                |                      |          | Vegano            | `vegan`         |
|                                           |                |                      |          | Sem frutos do mar | `no_seafood`    |

Não há pergunta além destas, nem campo de frase. “Carne” é `beef`: frango e peixe têm valor próprio.

### O que a tela faz com pergunta em branco

As cinco escolhas únicas precisam ter uma opção marcada para o botão “Me sugere um prato” habilitar. Restrição pode ficar toda desmarcada. Não se assume “Sem limite”, “Normal” ou qualquer outro default no lugar de uma pergunta pulada.

“Suas respostas ficam salvas neste celular para a próxima vez.” é o texto do quadro e só pode aparecer quando a SCRUM-68 gravar e restaurar de fato. A SCRUM-61 não promete isso.

### O que a API faz com pergunta ausente

Campo obrigatório ausente, `null` ou fora do enum é `400 VALIDATION_ERROR`. `restrictions` ausente equivale a `[]`. `restrictions: null`, item repetido ou item fora do enum é `400`. Não há default de orçamento, fome, proteína, estilo ou sabor.

### Faixas em centavos

O cliente envia o valor estável, nunca um número em reais.

| Valor           | Inclui `priceCents`  |
| --------------- | -------------------- |
| `up_to_20`      | 0 a 2000             |
| `from_21_to_35` | 2100 a 3500          |
| `from_36_to_60` | 3600 a 6000          |
| `unlimited`     | qualquer inteiro ≥ 0 |

As pontas entram. `2000` é “Até R$ 20”. `2100` é “R$ 21–35”. `3500` é “R$ 21–35”. `3600` é “R$ 36–60”. `6000` é “R$ 36–60”.

`2001`–`2099` e `3501`–`3599` não cabem em faixa limitada. Só aparecem com `unlimited`. Isso evita tratar R$ 20,50 como se fosse “R$ 21–35”.

### Combinações

Contradição, recusada com `400` antes de ler regra de cardápio:

- `fish` junto com `no_seafood`;
- `chicken`, `fish` ou `beef` junto com `vegan`.

Combinação apenas improvável não é erro. `fish` com `sweet`, por exemplo, segue o filtro e pode terminar em lista vazia. `vegetarian` com `vegan` é válido: a restrição crítica decide o resultado, como abaixo.

## Payload e resposta

O body, os quatro pares `provider`/`outcome`, o motivo e os erros estão no contrato. Resumo operacional:

1. Validar o JSON e as contradições.
2. Ler uma vez os produtos `available: true`. Esse array é o snapshot da requisição. Provedor e fallback usam o mesmo array, sem uma segunda consulta no meio.
3. Se o snapshot está vazio, responder `provider: not_called`, `outcome: empty_catalog`, `products: []`. Não chamar o Gemini.
4. Montar o conjunto elegível com as regras deste arquivo.
5. Se o conjunto está vazio, responder `provider: not_called`, `outcome: no_compatible_products`, `products: []`. Não chamar o Gemini.
6. Se o conjunto tem itens, a SCRUM-62 pode consultar o Gemini com timeout. Ids aproveitáveis, na ordem devolvida e sem completar até `limit`, respondem `provider: answered`.
7. Chave ausente, timeout, falha de rede, JSON inválido ou nenhum id aproveitável não produzem erro HTTP. O fallback ordena o conjunto elegível e a resposta é `provider: unavailable` e `outcome: suggestions`. O conjunto vazio não chega neste passo: ele já respondeu `not_called`.

`reason` é montado pela API nos dois caminhos. Frase, nome ou preço devolvidos pelo Gemini são descartados.

Partes do motivo, nesta ordem, separadas por `", "`:

1. proteína: `Frango`, `Peixe`, `Carne` ou `Vegetariano`;
2. faixa, só quando não é `unlimited`: `Até R$ 20`, `R$ 21–35` ou `R$ 36–60`;
3. sabor: `Salgado` ou `Doce`;
4. só se `no_onion` foi pedido e o prato passou nesse filtro: `sem cebola na lista cadastrada`.

Fome e estilo não entram no motivo. Restrição crítica não entra, porque ela não produz sugestão. A frase do quadro “Peixe, até R$ 60, sem cebola” mostra onde o motivo fica e quais filtros o cliente reconhece. O texto da API não troca a faixa escolhida por “até R$ 60”, porque isso incluiria preços que o filtro excluiu, e não diz “sem cebola” sozinho, porque a lista cadastrada não prova o preparo.

Nome, preço, imagem e categoria exibidos vêm do `Product` já carregado pelo app, pelo `productId`. `imageUrl: null` usa o mesmo vazio do cardápio. Se, na hora de pintar, o id sumiu ou ficou `available: false`, o card é omitido. Se nenhum card sobrar, a tela trata como falha recuperável, não como prato inventado.

## Regras de recomendação

A função de seleção recebe o snapshot, as preferências normalizadas e `limit`. Ela não sorteia, não usa relógio e não depende da ordem que o SQLite devolveu. O desempate final é `id` ascendente, comparação de string UTF-8.

Um produto só é elegível se todas as linhas abaixo passam.

| Regra             | Efeito                                                                                                                                                       |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Disponibilidade   | `available: true` no snapshot. `p8` do seed, indisponível, nunca entra                                                                                       |
| Bebida            | `category === "bebidas"` fica de fora. O fluxo sugere prato, não bebida. Outro slug não é tratado como bebida                                                |
| Orçamento         | Faixa fechada da tabela de centavos. `unlimited` não corta preço                                                                                             |
| Sabor             | `sweet`: só `category === "sobremesas"`. `savory`: qualquer categoria restante, exceto `sobremesas` e `bebidas`. Outro slug de doce não é inferido pelo nome |
| Proteína          | Só com evidência positiva no texto do produto, pelas listas abaixo. Sem evidência, o produto sai                                                             |
| `no_onion`        | Se a lista de ingredientes é `[]`, sai. Se há token de cebola, sai. Lista não vazia e sem token pode ficar                                                   |
| Restrição crítica | `no_gluten`, `no_lactose`, `vegan`, `no_seafood`: o produto sai. O cadastro não tem atributo confiável para mantê-lo                                         |
| Duplicata         | `id` é chave primária. Se o provedor repetir um id, fica a primeira ocorrência                                                                               |

`style` é obrigatório no contrato e não exclui nem reordena. O cardápio não tem campo de porção ou de prato leve/completo. Usar preço ou categoria para simular isso inventaria um atributo. Um teste deve mostrar que `light` e `full`, com o resto igual, devolvem os mesmos ids na mesma ordem.

`hunger` não exclui. Só ordena o conjunto que já passou:

| `hunger`                  | Ordem primária                            | Empate         |
| ------------------------- | ----------------------------------------- | -------------- |
| `little`                  | `priceCents` crescente                    | `id` crescente |
| `big`                     | `priceCents` decrescente                  | `id` crescente |
| `normal` e faixa limitada | menor distância absoluta ao meio da faixa | `id` crescente |
| `normal` e `unlimited`    | `priceCents` crescente                    | `id` crescente |

Meio da faixa: `up_to_20` = 1000, `from_21_to_35` = 2800, `from_36_to_60` = 4800. No `unlimited`, não se calcula mediana do conjunto: o resultado não pode mudar porque outro prato entrou na lista.

O fallback devolve os `limit` primeiros dessa ordem. O Gemini, quando usado, só pode reordenar um subconjunto do conjunto elegível. Não acrescenta id de fora. Se sobrar menos que `limit`, a API não completa com o fallback.

### Evidência no texto

A comparação não grava nada no produto. Para cada um de `name`, `description` e cada item de `ingredients`:

1. normalizar com NFD;
2. remover marcas combinantes (`\p{M}`);
3. passar a minúsculas pelo Unicode padrão, sem locale;
4. procurar o token com limite de letra: o caractere anterior e o seguinte, se existirem, não podem ser letra.

`frango` casa em “Frango grelhado”. `boi` casa em “carne de boi” e não casa dentro de “boina”. Acentos não separam `salmão` de `salmao`. O limite de letra não reduz plural: `cebola` não casa em `cebolas`, então o plural entra como token próprio. `cebolinha` não é `cebola` e continua de fora.

Tokens de proteína, já sem acento. A forma do plural acompanha o singular na mesma coluna:

| Preferência  | Entra se encontrar                                                                                              | Não usa como evidência                             |
| ------------ | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `chicken`    | `frango`, `frangos`, `chicken`, `chickens`                                                                      | `carne` solta, `blend`                             |
| `fish`       | `peixe`, `peixes`, `salmao`, `salmoes`, `tilapia`, `tilapias`, `bacalhau`, `bacalhaus`, `atum`, `atuns`, `fish` | `camarao`, `camaroes` e outros frutos do mar       |
| `beef`       | `bovina`, `bovinas`, `bovino`, `bovinos`, `beef`                                                                | `carne`, `carnes`, `boi`, `bois`, `blend`, `bacon` |
| `vegetarian` | lista de ingredientes não vazia e nenhum token de carne animal                                                  | lista vazia                                        |

Carne animal, para excluir `vegetarian`: os tokens positivos de frango, peixe e carne bovina, mais `carne`, `carnes`, `boi`, `bois`, `bacon`, `porco`, `porcos`, `suino`, `suinos`, `suina`, `suinas`, `presunto`, `presuntos`, `camarao`, `camaroes`, `lula`, `lulas`, `polvo`, `polvos`, `ostra`, `ostras`, `marisco`, `mariscos`, `siri`, `siris`, `caranguejo`, `caranguejos`, `lagosta`, `lagostas`.

`carne` e `boi` tiram o prato de `vegetarian` e não o colocam em `beef`. “Carne moída” e “carne de boi” não identificam a espécie que o token `bovina` exigiria, e também não são ausência de carne. “Carne de soja” sai pelo mesmo token: a V1 não interpreta o qualificativo. Ovo, leite, queijo e mel não tiram `vegetarian`. Também não provam `vegan`.

Token de cebola: `cebola`, `cebolas`, `onion`, `onions`.

Não há lista de tokens para declarar glúten, lactose, vegano ou fruto do mar como ausência. A restrição crítica exclui antes disso. Token de conflito continua inútil na V1, porque o produto já saiu.

### O que o seed de demonstração produz

Valores com `style` indiferente. `restrictions` vazio, salvo quando a linha diz o contrário. Catálogo = `p1`–`p12` do seed, com `p8` indisponível e bebidas de fora.

| Preferências                                                        | Resultado esperado no fallback, `limit` 3                                                    |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `up_to_20`, `normal`, `vegetarian`, `savory`, sem restrição         | só `p3`. Motivo: `Vegetariano, Até R$ 20, Salgado`                                           |
| `from_36_to_60`, `big`, `beef`, `savory`, `no_onion`                | só `p2`. `p9` tem cebola. Motivo: `Carne, R$ 36–60, Salgado, sem cebola na lista cadastrada` |
| `unlimited`, `little`, `beef`, `savory`, sem restrição              | `p1`, `p2`, `p9` (preço 3290, 3890, 4290)                                                    |
| `unlimited`, `big`, `beef`, `savory`, sem restrição                 | `p9`, `p2`, `p1`                                                                             |
| `unlimited`, `little`, `chicken`, `savory`                          | `no_compatible_products`. O seed não tem token de frango                                     |
| `unlimited`, `normal`, `fish`, `savory`                             | `no_compatible_products`. O seed não tem token de peixe                                      |
| qualquer uma com `no_gluten`, `no_lactose`, `vegan` ou `no_seafood` | `no_compatible_products`                                                                     |
| `fish` + `no_seafood`, ou `beef` + `vegan`                          | `400`, sem consultar o cardápio                                                              |
| nenhum `available: true`                                            | `empty_catalog`                                                                              |
| preço 2050 ou 3550, faixa limitada                                  | fora. Com `unlimited`, a faixa deixa de excluir                                              |

`light` e `full` não aparecem nessa tabela porque não mudam ids nem ordem.

## Política de restrições alimentares

`ingredients` é lista informativa. Já está no contrato de produto: não é laudo, não detecta alergênico e não cobre contaminação cruzada. Lista vazia significa composição não cadastrada, não “não leva nada”. A API não completa essa lista com `name` ou `description` na gravação; a recomendação pode ler os três textos só para achar menção positiva, nunca para concluir ausência.

Três camadas:

| Camada                                     | Exemplos                                                                              | Efeito na sugestão                                                               |
| ------------------------------------------ | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Preferência culinária                      | orçamento, fome, proteína, estilo, doce/salgado                                       | filtra ou ordena só com campo real do produto. Estilo fica só registrado         |
| Restrição declarada no formulário          | `no_onion`                                                                            | tira o que cita cebola e o que não tem lista. Não afirma preparo livre de cebola |
| Alergia ou restrição que exige confirmação | `no_gluten`, `no_lactose`, `vegan`, `no_seafood`, e qualquer alergia dita pela pessoa | sem atributo confiável, não há sugestão. A pessoa confirma com a equipe          |

A frase do quadro fica visível no formulário, no resultado, no fallback e na lista vazia:

> Tem alergia? Confirme os ingredientes com a equipe antes de pedir.

Essa frase não é um selo do prato. A sugestão não recebe “sem glúten”, “sem lactose”, “vegano” ou “sem frutos do mar”.

Quando a restrição crítica esvazia o conjunto, a resposta conservadora é a lista vazia com `no_compatible_products`, não uma lista “aproximada”. O fallback não afrouxa restrição crítica, proteína, sabor nem orçamento para preencher card.

Um atributo alimentar confiável, se existir um dia, será campo de cadastro revisto no contrato de `Product`. Não será inferido pelo Gemini nem pela ausência de uma palavra.

## Fallback

O fallback é a função de seleção deste arquivo. Ele roda quando o provedor não será chamado por falha, ou quando a SCRUM-62 ainda não o tiver ligado: sem chave, a SCRUM-62 trata o provedor como indisponível e usa o mesmo fallback, desde que o conjunto elegível não esteja vazio. Conjunto vazio continua `not_called`, porque não há o que pedir ao provedor.

Critérios objetivos:

- lê o snapshot atual, não uma lista fixa de ids;
- ignora `available: false`;
- aplica orçamento, sabor, proteína e `no_onion` como na tabela de regras;
- não inventa atributo para fome além da ordenação por `priceCents`, nem inventa atributo para estilo;
- a mesma entrada produz a mesma saída;
- desempate por `id`;
- sem id repetido;
- cardápio sem produto disponível: `empty_catalog`;
- produtos disponíveis, nenhum elegível: `no_compatible_products`;
- não devolve item com conflito conhecido, nem item que a restrição crítica não permite afirmar;
- não devolve os primeiros da tabela nem uma amostra aleatória.

O texto antigo do contrato, “primeiros N disponíveis por categoria popular”, não vale mais.

## Provedor externo

Caminho previsto, não implementado:

```text
Flutter → POST /ai/recommendation → seleção na API → Gemini
```

A chave fica só no processo da API, em `GEMINI_API_KEY`. Não vai para o Flutter, para o log, para o corpo de erro nem para o repositório. Assinatura de estudante do Gemini não conta como crédito de API. Chave ausente ou em branco é provedor indisponível, não uma tentativa anônima.

Quando a SCRUM-62 chamar o provedor, a chamada leva somente o necessário para escolher ids dentro do conjunto já elegível:

- ids e os campos usados na elegibilidade: `name`, `category`, `priceCents`, `ingredients`;
- as preferências normalizadas;
- `limit`.

Não leva `table`, imagem, pedido, carrinho, chave ou cabeçalho de autorização da API. `description` pode ir porque a evidência de proteína também a lê; continua sendo texto de apresentação, não laudo.

Timeout padrão de 8000 ms, com `AbortSignal`. Uma variável futura `GEMINI_TIMEOUT_MS`, inteiro de 1000 a 15000, pode substituir o padrão. Ela não entra em `src/config/env.ts` nesta story. Estouro cancela a chamada e aciona o fallback.

A resposta do Gemini só é lida como lista de ids. A API:

- descarta id ausente do snapshot, indisponível ou fora do conjunto elegível;
- descarta duplicata, mantendo a primeira;
- corta em `limit`;
- ignora nome, preço e frase produzidos lá;
- se não sobrar id, executa o fallback no mesmo snapshot.

A chamada deve usar `fetch` do Node. Esta story não adiciona SDK nem dependência. Teste da SCRUM-62 injeta um fake: não há rede, não há chave e o relógio do timeout é controlado.

O módulo futuro fica em `src/modules/recommendations/`, registrado em `buildApp` como produtos e pedidos. A função pura de seleção é o núcleo testável. A rota só valida, lê o snapshot e devolve o JSON do contrato.

## Segurança e privacidade

- Sem autenticação, como o resto do MVP. Qualquer cliente HTTP pode chamar a rota quando ela existir. O desenho não guarda a requisição.
- Preferência alimentar não vai para log de aplicação. Erro 500 continua com a mensagem genérica `Erro interno`.
- `table` é contexto opcional da jornada. Não ordena, não filtra, não é persistido e não segue para o Gemini.
- A rota não escreve em `products`, `orders`, `order_items` nem `idempotency_keys`. `Idempotency-Key` recebida é ignorada.
- Repetir o POST com o mesmo body pode mudar o resultado se o cardápio mudou. Com o mesmo snapshot e o caminho de fallback, o resultado é estável.
- Falha do provedor não vira 500 quando o fallback termina. 500 fica para falha ao ler o banco ou ao executar o próprio fallback.

## Estados de interface

A SCRUM-61 acrescenta a rota. Nome proposto, ainda sem código: `/recommendation`, aberto a partir de `/menu`, levando a mesa que o cardápio já tem. Não substitui `/menu`. O `Preference` atual, `{ "text": "..." }`, não é o estado deste formulário e não deve ser enviado como `preferences`.

A tela reutiliza o que o app já tem: indicador central de progresso, como o cardápio, e `DinnaEmptyState` para vazio e falha. Nome, preço e imagem vêm de `ProductRepository`, não de um preço paralelo. Alvo de toque de 48, rolagem do formulário e do resultado, e o mesmo cuidado com `textScaler` que o cardápio já mede. Grupo de opção única é rádio; restrição é caixa de seleção. O valor estável não aparece na tela. O foco não fica preso. Voltar no meio do carregamento cancela a espera na tela e retorna ao formulário com as respostas intactas. Voltar do formulário retorna ao cardápio.

| Passo                                                                                           | O que a pessoa vê                                                                                                                                                                                             | O que não acontece                                        |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| 1. Abrir “Me ajuda a escolher” no cardápio                                                      | Formulário com as seis perguntas e o aviso de alergia                                                                                                                                                         | Campo de texto livre                                      |
| 2. Responder                                                                                    | Uma opção por pergunta obrigatória; várias restrições, ou nenhuma                                                                                                                                             | Default silencioso                                        |
| 3. “Me sugere um prato”                                                                         | Só habilitado com as cinco obrigatórias respondidas                                                                                                                                                           | `POST /orders`                                            |
| 4. Carregando                                                                                   | Indicador de progresso. Respostas conservadas                                                                                                                                                                 | Travar cardápio, carrinho ou pedido: a pessoa pode voltar |
| 5. Sugestões (`answered` ou fallback com itens, pintado sem a faixa de falha quando `answered`) | Até 3 cards: imagem, nome, preço e `reason`. Aviso de alergia continua                                                                                                                                        | Preço vindo da resposta da recomendação                   |
| 6. Fallback (`unavailable` + `suggestions`)                                                     | Faixa do quadro: “A Dinna não respondeu agora” e “Seu pedido continua funcionando normalmente. Separei pratos do cardápio que batem com os seus filtros.” Abaixo, os cards                                    | Lista aleatória                                           |
| 7. Nada compatível (`no_compatible_products`)                                                   | `DinnaEmptyState`. Título: “Nenhum prato compatível”. Texto: “Não há, no cardápio disponível, um prato que respeite essas respostas sem completar informação que o cadastro não tem.” Mais o aviso de alergia | Afrouxar filtro crítico                                   |
| 8. Cardápio sem produto disponível (`empty_catalog`)                                            | Título: “Cardápio vazio”. Texto: “O restaurante ainda não tem pratos disponíveis para sugerir.”                                                                                                               | Inventar prato                                            |
| 9. Sem resposta HTTP 200                                                                        | Título: “Não foi possível pedir uma sugestão”. Texto: “O cardápio, o carrinho e o pedido continuam disponíveis.”                                                                                              | Bloquear o pedido do R1                                   |
| 10. Tentar de novo                                                                              | No fallback, o rótulo do quadro é “Tentar a Dinna de novo”. Nos outros erros, “Tentar de novo”. Reenvia o mesmo body                                                                                          | Apagar as respostas                                       |
| 11. Voltar ao cardápio                                                                          | “Ver cardápio completo”                                                                                                                                                                                       | Criar pedido                                              |
| 12. Carrinho                                                                                    | Fora desta story. A SCRUM-65 inclui o prato sugerido no carrinho existente, quantidade 1, e segue a revisão do R1                                                                                             | A recomendação não envia o pedido                         |

O quadro não tem uma tela separada de “nenhum prato compatível”. Os textos dos passos 7, 8 e 9 ficam definidos aqui para a implementação não improvisar. O passo 6 usa as frases já desenhadas.

## Dependências entre stories

| Story    | O que entrega                                                                                                                        | Depende deste desenho                                |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| SCRUM-60 | Este desenho e o contrato. Sem Gemini e sem Flutter                                                                                  | —                                                    |
| SCRUM-61 | Formulário, validação local e envio do objeto. Restrição marcada é filtro, não texto solto. O pedido do R1 segue sem passar por aqui | Contrato e perguntas                                 |
| SCRUM-62 | Rota, leitura do snapshot, timeout, fake do provedor                                                                                 | Regras e JSON                                        |
| SCRUM-63 | Descarte de id inexistente, indisponível, duplicado ou inelegível, e acionamento do fallback quando não sobra id                     | Passo do provedor                                    |
| SCRUM-64 | Cards com imagem, nome, preço do `Product` e motivo curto                                                                            | Resposta `products[]`                                |
| SCRUM-65 | Incluir a sugestão no carrinho já existente                                                                                          | Card da SCRUM-64. Não muda `CartSession` aqui        |
| SCRUM-67 | O mesmo fallback quando o provedor não responde. Cardápio, carrinho e pedido permanecem usáveis                                      | Função de seleção                                    |
| SCRUM-68 | Gravar e reabrir as preferências estruturadas neste aparelho, e só então a frase de “salvas neste celular”                           | Modelo de perguntas da SCRUM-61. Não é tabela na API |

SCRUM-62 e SCRUM-67 compartilham uma função. Não são dois filtros.

## Critérios de teste e de aceite

A SCRUM-60 está aceita, do lado de documentação, quando:

- as perguntas do quadro estão nomeadas com valores estáveis, inclusive doce/salgado, que o texto da story no Jira não listava e o quadro lista;
- o contrato descreve `POST /ai/recommendation` com `preferences` objeto e revoga o texto livre preliminar;
- restrição crítica não vira alegação;
- o fallback é determinístico e não é “os primeiros disponíveis”.

Testes de comportamento ficam para quem implementar. Cada um deve travar um fato, sem rede:

| Caso                                                                              | Esperado                                                                                                                  |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Body do exemplo do contrato, seed, provedor indisponível                          | `200`, `unavailable`, somente `p2`, com o `reason` do exemplo. `hunger: big` dá o mesmo id, porque o conjunto tem um item |
| `preferences` string, campo extra, `limit` 0, `limit` 4, restrição repetida       | `400 VALIDATION_ERROR`                                                                                                    |
| `fish` + `no_seafood`; `chicken` + `vegan`                                        | `400` e nenhuma leitura de provedor                                                                                       |
| Snapshot sem `available: true`                                                    | `empty_catalog`, provedor não chamado                                                                                     |
| Só bebidas disponíveis                                                            | `no_compatible_products`                                                                                                  |
| `no_gluten` com o seed inteiro                                                    | `no_compatible_products`, mesmo que o provedor fake devolva `p3`                                                          |
| Fake devolve `p8`, id inexistente e `p2` duplicado, conjunto elegível contém `p2` | só `p2`, uma vez                                                                                                          |
| Fake estoura o tempo ou devolve JSON sem ids                                      | fallback, mesma ordem do teste puro da função, `provider: unavailable`                                                    |
| Fake devolve um id elegível e `limit` 3                                           | um item, sem completar com outros                                                                                         |
| Dois produtos no mesmo preço                                                      | `id` menor primeiro                                                                                                       |
| `style: light` e `style: full`                                                    | mesma lista                                                                                                               |
| Preço 2000, 2001, 2100, 3500, 3501, 3600 e 6000                                   | cada um só na faixa da tabela de centavos                                                                                 |
| Ingredientes `[]` e `no_onion`                                                    | produto fora                                                                                                              |
| Ingrediente “Cebola”, “Cebolas” ou “Onions” e `no_onion`                          | produto fora                                                                                                              |
| `["Carne moída", "Pão"]` ou `["Carne de boi"]`                                    | não é `vegetarian` e não é `beef`                                                                                         |
| `["Carne bovina"]`                                                                | é `beef` e não é `vegetarian`                                                                                             |
| `["Frangos"]`                                                                     | é `chicken` e não é `vegetarian`                                                                                          |
| Lista sem cebola, não vazia, e `no_onion`                                         | pode entrar, e o motivo diz “na lista cadastrada”                                                                         |
| Resposta não traz `name` nem `priceCents`                                         | o cliente usa o `Product`                                                                                                 |

No Flutter, a SCRUM-61 cobre botão desabilitado, múltipla seleção, rolagem com texto ampliado e a ausência de campo livre. A SCRUM-64 cobre card com dado do cardápio. A SCRUM-65 cobre quantidade 1 no carrinho existente, sem novo fluxo de envio. A SCRUM-67 cobre a faixa “A Dinna não respondeu agora” e a continuidade do pedido.
