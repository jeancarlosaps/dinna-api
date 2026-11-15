# Contrato REST — Dinna API

> **Status:** aceito (SCRUM-24 · T1.5).  
> Este documento é a fonte de verdade do contrato entre **dinna-api** e **dinna-flutter**.  
> Mudança de rota, payload ou código de erro exige atualização deste arquivo no mesmo PR.
>
> Legenda: **Implementado** = existe no código e tem teste · **Contrato** = aceito, ainda sem código · **Fora do R1** = previsto para release posterior.

## Escopo deste contrato

| Incluído                        | Fora de escopo (por enquanto)  |
| ------------------------------- | ------------------------------ |
| `GET /health`                   | Autenticação / autorização     |
| Produtos (CRUD)                 | Multi-restaurante / tenants    |
| Pedidos (criar, listar, status) | Paginação e ordenação avançada |
| Recomendação (contrato R2)      | Pagamentos, delivery, estoque  |

- Um restaurante, cardápio e fila pequenos (apresentação acadêmica).
- Sem auth de usuário no MVP. A distinção **cliente × restaurante** fica no app Flutter (perfis de UI), não na API.
- No ambiente hospedado, a API pode exigir um token de acesso compartilhado. Ver [Acesso ao ambiente hospedado](#acesso-ao-ambiente-hospedado). Localmente fica desligado e nada muda para os clientes.
- JSON em UTF-8; campos em `camelCase`; identificadores como `string`.
- Valores monetários em **centavos** (`priceCents`, `totalCents`: `number` inteiro ≥ 0).
- Datas em ISO-8601 UTC (`createdAt`: `"2026-10-16T18:00:00Z"`).
- Base URL local padrão: `http://localhost:3333` (ver README).

## Formato de erro

Todas as respostas de erro usam:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "...", "details": [] } }
```

`details` é opcional (presente em validação; ausente nos demais).

| HTTP | `code`                      | Quando                                                          |
| ---- | --------------------------- | --------------------------------------------------------------- |
| 400  | `VALIDATION_ERROR`          | Body, params, query ou `Idempotency-Key` fora do contrato       |
| 401  | `UNAUTHORIZED`              | Proteção ligada e `X-Dinna-Api-Token` ausente ou inválido       |
| 404  | `NOT_FOUND`                 | Rota inexistente **ou** recurso inexistente                     |
| 409  | `CONFLICT`                  | Transição de status inválida; regra de negócio em conflito      |
| 409  | `IDEMPOTENCY_KEY_CONFLICT`  | Mesma `Idempotency-Key` com payload diferente em `POST /orders` |
| 4xx  | definido no `AppError`      | Outras regras de domínio                                        |
| 500  | `INTERNAL_ERROR`            | Erro inesperado (detalhe só no log)                             |
| 500  | `IDEMPOTENCY_STATE_INVALID` | Chave de idempotência gravada sem o pedido correspondente       |

Códigos de recurso (usados com 404/`AppError`):

| `code`                      | Quando                                                           |
| --------------------------- | ---------------------------------------------------------------- |
| `PRODUCT_NOT_FOUND`         | `id` de produto inexistente                                      |
| `ORDER_NOT_FOUND`           | `id` de pedido inexistente                                       |
| `INVALID_STATUS_TRANSITION` | Status atual não permite o `status` pedido (HTTP 409)            |
| `IDEMPOTENCY_KEY_CONFLICT`  | HTTP 409. A `Idempotency-Key` já identifica um payload diferente |
| `IDEMPOTENCY_STATE_INVALID` | HTTP 500. A chave existe, mas o pedido correspondente não        |

## Recursos

### Product

```json
{
  "id": "p1",
  "name": "Burger Clássico",
  "description": "Pão, blend 180g, queijo e salada",
  "category": "burgers",
  "priceCents": 3290,
  "imageUrl": "https://example.com/burger.jpg",
  "available": true,
  "ingredients": []
}
```

| Campo         | Tipo       | Obrigatório na resposta | Notas                                                                                                     |
| ------------- | ---------- | ----------------------- | --------------------------------------------------------------------------------------------------------- |
| `id`          | `string`   | sim                     | Gerado pela API na criação                                                                                |
| `name`        | `string`   | sim                     | 1–120 caracteres                                                                                          |
| `description` | `string`   | sim                     | Pode ser `""`; máx. 2000. Não é lista de ingredientes                                                     |
| `category`    | `string`   | sim                     | Slug livre (ex.: `burgers`, `bebidas`)                                                                    |
| `priceCents`  | `number`   | sim                     | Inteiro ≥ 0                                                                                               |
| `imageUrl`    | `string`   | sim                     | URI; `null` se sem imagem                                                                                 |
| `available`   | `boolean`  | sim                     | `false` = indisponível / soft-delete                                                                      |
| `ingredients` | `string[]` | sim                     | Nomes na ordem e na grafia cadastradas. Máx. 30 itens de 1–80 pontos de código Unicode. Ver regras abaixo |

`ingredients` é uma lista ordenada. A API não deduplica, não reordena e não altera maiúsculas, acentos ou espaços internos. Cada item é uma string com ao menos um caractere visível, sem espaço no início ou no fim. Caractere de controle ou formato invisível, como espaço de largura zero, é recusado. O juntador U+200D de um emoji composto permanece. A grafia visível não é reescrita. String vazia, string só com espaços, `null`, número ou objeto são `400 VALIDATION_ERROR`. Uma string no lugar da lista não vira lista de um item, e um número não vira texto.

Lista vazia é valor válido: a composição ainda não foi cadastrada. A API não preenche esse vazio a partir de `name` ou `description`, e `GET /products?q=` continua buscando só em `name` e `description`.

No cardápio de demonstração (`p1`–`p12`), a `description` continua sendo texto de apresentação e não vira `ingredients`. O seed grava listas ilustrativas só quando a tabela nasce vazia. `p5` (Refrigerante Lata) e `p6` (Suco Natural) permanecem com `[]` porque o sabor varia. Um banco que já tem produtos não recebe essas listas na abertura.

Os nomes informados servem para exibição. A API não detecta alergênicos e não emite alegação de ausência, como sem glúten ou sem lactose. A lista também não garante que o preparo esteja livre de contaminação cruzada.

Exemplo só de formato, distinto do cardápio de demonstração:

```json
"ingredients": ["Pão", "Queijo cheddar"]
```

### OrderItem (body de `POST /orders`)

```json
{ "productId": "p1", "quantity": 2, "note": "sem cebola" }
```

| Campo       | Tipo     | Obrigatório | Notas                                                      |
| ----------- | -------- | ----------- | ---------------------------------------------------------- |
| `productId` | `string` | sim         | Deve existir e estar `available: true` na criação          |
| `quantity`  | `number` | sim         | Inteiro seguro ≥ 1; total precisa caber em centavos exatos |
| `note`      | `string` | não         | Máx. 200; observação do cliente                            |

### OrderItem (resposta)

Snapshot do cardápio no momento da criação. Não muda se o produto for editado depois.

```json
{
  "productId": "p1",
  "name": "Burger Clássico",
  "quantity": 2,
  "unitPriceCents": 3290,
  "lineTotalCents": 6580,
  "note": "sem cebola"
}
```

| Campo            | Tipo     | Obrigatório | Notas                                |
| ---------------- | -------- | ----------- | ------------------------------------ |
| `productId`      | `string` | sim         | Referência ao produto                |
| `name`           | `string` | sim         | Nome no momento da criação           |
| `quantity`       | `number` | sim         | Inteiro ≥ 1                          |
| `unitPriceCents` | `number` | sim         | Preço unitário (centavos) na criação |
| `lineTotalCents` | `number` | sim         | `unitPriceCents × quantity`          |
| `note`           | `string` | não         | Observação do cliente                |

`GET /orders`, `GET /orders/:id` e `PATCH /orders/:id/status` exigem este item completo: `name`, `unitPriceCents` e `lineTotalCents` são obrigatórios.

`POST /orders` de um pedido novo também devolve o snapshot. A repetição de uma `Idempotency-Key` já gravada devolve o `response_json` original. Se esse registro é anterior ao snapshot, esses três campos não vêm no corpo. A repetição não os completa com o cardápio atual, não usa o pedido migrado e não regrava o JSON.

### Order

```json
{
  "id": "o1",
  "orderNumber": 42,
  "table": "12",
  "status": "received",
  "items": [
    {
      "productId": "p1",
      "name": "Burger Clássico",
      "quantity": 2,
      "unitPriceCents": 3290,
      "lineTotalCents": 6580,
      "note": "sem cebola"
    }
  ],
  "totalCents": 6580,
  "createdAt": "2026-10-16T18:00:00Z"
}
```

| Campo         | Tipo          | Obrigatório    | Notas                                           |
| ------------- | ------------- | -------------- | ----------------------------------------------- |
| `id`          | `string`      | sim (resposta) | Gerado pela API                                 |
| `orderNumber` | `number`      | sim (resposta) | Número público sequencial (ver abaixo)          |
| `table`       | `string`      | sim            | Identificador da mesa (ex.: `"12"`)             |
| `status`      | `string`      | sim            | Ver ciclo abaixo                                |
| `items`       | `OrderItem[]` | sim            | Mín. 1 item (resposta enriquecida)              |
| `totalCents`  | `number`      | sim (resposta) | Soma dos `lineTotalCents` no momento da criação |
| `createdAt`   | `string`      | sim (resposta) | ISO-8601 UTC                                    |

#### Ciclo de status

```text
received → preparing → ready → finished
```

| Valor       | Significado                                             |
| ----------- | ------------------------------------------------------- |
| `received`  | Pedido chegou à fila (estado inicial de `POST /orders`) |
| `preparing` | Cozinha preparando                                      |
| `ready`     | Pronto para servir / retirar na mesa                    |
| `finished`  | Atendimento concluído (estado final)                    |

Transições permitidas (somente **avançar um passo**):

| De          | Para        |
| ----------- | ----------- |
| `received`  | `preparing` |
| `preparing` | `ready`     |
| `ready`     | `finished`  |

Qualquer outro salto ou regressão → `409 INVALID_STATUS_TRANSITION`.

## Endpoints

| Método   | Rota                 | Release | Status           | Quem usa (UI)                            |
| -------- | -------------------- | ------- | ---------------- | ---------------------------------------- |
| `GET`    | `/health`            | R0      | **Implementado** | Ambos (checagem de conexão)              |
| `GET`    | `/products`          | R0/R1   | **Implementado** | Cliente (cardápio); restaurante (gestão) |
| `GET`    | `/products/:id`      | R0/R1   | **Implementado** | Ambos                                    |
| `POST`   | `/products`          | R0/R1   | **Implementado** | Restaurante                              |
| `PUT`    | `/products/:id`      | R0/R1   | **Implementado** | Restaurante                              |
| `DELETE` | `/products/:id`      | R0/R1   | **Implementado** | Restaurante (soft-delete)                |
| `GET`    | `/orders`            | R1      | **Implementado** | Restaurante (fila)                       |
| `GET`    | `/orders/:id`        | R1      | **Implementado** | Ambos (detalhe)                          |
| `POST`   | `/orders`            | R1      | **Implementado** | Cliente (mesa)                           |
| `PATCH`  | `/orders/:id/status` | R1      | **Implementado** | Restaurante                              |
| `POST`   | `/ai/recommendation` | R2      | **Implementado** | Cliente                                  |

---

### `GET /health`

Verificação de disponibilidade. Sem query. Sempre público, mesmo com a proteção por token ligada.

```http
GET /health
```

**200 OK**

```json
{ "status": "ok" }
```

---

### `GET /products`

Lista produtos. Sem paginação no MVP (cardápio pequeno).

**Query**

| Param       | Tipo      | Obrigatório | Default | Descrição                                            |
| ----------- | --------- | ----------- | ------- | ---------------------------------------------------- |
| `category`  | `string`  | não         | —       | Filtra por `category` exata                          |
| `q`         | `string`  | não         | —       | Busca case-insensitive em `name` e `description`     |
| `available` | `boolean` | não         | —       | Se omitido, retorna todos; se `true`/`false`, filtra |

```http
GET /products?category=burgers&available=true
```

**200 OK** — array de `Product` (pode ser vazio `[]`).

---

### `GET /products/:id`

**200 OK** — um `Product`.  
**404** — `{ "error": { "code": "PRODUCT_NOT_FOUND", "message": "..." } }`

---

### `POST /products`

Cria produto. O `id` é gerado pela API. `available` default `true` se omitido. `ingredients` omitido grava `[]`. `ingredients: []` também grava lista vazia. A lista enviada é persistida na mesma ordem.

**Body**

```json
{
  "name": "Burger Clássico",
  "description": "Pão, blend 180g, queijo e salada",
  "category": "burgers",
  "priceCents": 3290,
  "imageUrl": "https://example.com/burger.jpg",
  "available": true,
  "ingredients": ["Pão", "Queijo cheddar"]
}
```

O array acima ilustra o formato do campo. Não é a composição cadastrada de `p1`.

**201 Created** — `Product` completo, sempre com `ingredients`.  
**400** — `VALIDATION_ERROR`.

---

### `PUT /products/:id`

Substitui os campos editáveis enviados. O body tem o mesmo formato da criação, sem `id`.

`ingredients` é a exceção à substituição integral, para um cliente que ainda não envia o campo não apagar a lista já gravada:

| Body            | Efeito em `ingredients`                      |
| --------------- | -------------------------------------------- |
| Campo ausente   | Mantém a lista persistida                    |
| `[]`            | Substitui por lista vazia                    |
| Lista com nomes | Substitui pela lista enviada, na mesma ordem |

Campo ausente não regrava uma lista lida antes do `UPDATE`. O `UPDATE` mantém o valor que estiver na coluna na hora da escrita e a resposta devolve esse valor.

Os outros campos não mudam de semântica. `imageUrl` omitido grava `null`. `available` omitido grava `true`. `name`, `description`, `category` e `priceCents` continuam obrigatórios e substituem o valor anterior.

**200 OK** — `Product` atualizado, sempre com `ingredients`.  
**404** — `PRODUCT_NOT_FOUND`.  
**400** — `VALIDATION_ERROR`.

---

### `DELETE /products/:id`

**Soft-delete:** marca `available: false`. Não remove o registro (pedidos históricos podem referenciar o `productId`).

**204 No Content** — sem body.  
**404** — `PRODUCT_NOT_FOUND`.

Idempotente: deletar de novo um produto já `available: false` continua **204**.

---

### `GET /orders`

Lista pedidos da fila. Sem paginação no MVP.

**Query**

| Param    | Tipo     | Obrigatório | Default | Descrição                     |
| -------- | -------- | ----------- | ------- | ----------------------------- |
| `status` | `string` | não         | —       | Filtra por um status do ciclo |
| `table`  | `string` | não         | —       | Filtra pela mesa              |

**200 OK** — array de `Order`, ordenado por `createdAt` ascendente (mais antigo primeiro — fila).
Cada item contém `id`, `orderNumber`, `table`, `status`, `items`, `totalCents` e `createdAt`. Cada elemento de `items` contém `productId`, `name`, `quantity`, `unitPriceCents`, `lineTotalCents` e, quando informado, `note`.

`status` aceita somente `received`, `preparing`, `ready` ou `finished`; `table` é comparada exatamente. Os filtros podem ser combinados. Consultas sem resultados retornam `[]`; parâmetros inválidos retornam **400 `VALIDATION_ERROR`**.

---

### `GET /orders/:id`

Retorna um pedido completo (mesma forma de `Order` da lista), com itens e snapshot de nome/preços.

**200 OK** — um `Order`.  
**404** — `{ "error": { "code": "ORDER_NOT_FOUND", "message": "..." } }`

---

### `POST /orders`

Cria pedido a partir da mesa. Status inicial sempre `received`.  
`totalCents` é calculado pela API com os preços **atuais** dos produtos.

**Header**

| Header            | Obrigatório | Formato                                 | Descrição                                                                     |
| ----------------- | ----------- | --------------------------------------- | ----------------------------------------------------------------------------- |
| `Idempotency-Key` | não         | UUID (RFC 4122 / RFC 9562), versões 1–8 | Identifica uma intenção de pedido. A comparação ignora maiúsculas/minúsculas. |

Sem o header, cada `POST` cria um pedido novo. Esse é o comportamento dos clientes atuais, inclusive o Flutter desta entrega: a proteção contra duplicata só existe quando a chave é enviada.

Com o header:

- Chave válida e ainda não usada grava o pedido e a chave na **mesma transação** e responde **201** com o `Order`.
- A mesma chave e um payload semanticamente equivalente devolvem **201** com o corpo original da criação (mesmo `id`, `status`, itens, `totalCents` e `createdAt`), sem criar outro pedido. Um `PATCH` posterior muda o pedido persistido e a resposta de `GET /orders`, mas não altera essa repetição do `POST`. Produto que fica indisponível ou muda de nome ou `priceCents` depois da criação também não altera essa repetição: a consulta da chave ocorre antes das validações do catálogo atual, e o replay não reconstrói a resposta a partir do estado atual.
- Pedido criado por esta versão grava e repete o snapshot completo (`name`, `unitPriceCents`, `lineTotalCents`). Chave gravada antes do snapshot repete o corpo legado, sem esses campos. A repetição não consulta o cardápio, não recalcula preços e não substitui o JSON pelo pedido que `GET /orders/:id` devolve depois da migração. A linha em `idempotency_keys` não é reescrita.
- Pedido criado por esta versão grava e repete `orderNumber`. Chave gravada antes do número público repete o corpo original sem `orderNumber`; o número desse pedido aparece em `GET /orders/:id`.
- `GET /orders`, `GET /orders/:id` e `PATCH /orders/:id/status` continuam na representação enriquecida. Pedido antigo recebe o snapshot na migração de `order_items`, a partir do cardápio da abertura. Essa representação não alimenta o replay do `POST`.
- A mesma chave e um payload diferente respondem **409** `IDEMPOTENCY_KEY_CONFLICT` e não criam pedido. A chave continua associada ao primeiro pedido.
- Header presente e inválido (vazio, não UUID, UUID nulo ou repetido) responde **400** `VALIDATION_ERROR` e não cria pedido.
- Produto inexistente ou indisponível responde **404** `PRODUCT_NOT_FOUND` e **não consome** a chave: uma tentativa seguinte, com a mesma chave e um body válido, pode criar o pedido.
- A chave permanece enquanto a linha existir em `idempotency_keys`. Não há prazo nem rotina que a apague. A idade de `created_at` não libera a chave para outro pedido.
- O handler de `POST /orders` envia o header de resposta `Idempotency-Retention: permanent`. Ele anuncia a política do servidor. Não comprova que uma requisição sem `Idempotency-Key` foi persistida: sem a chave, cada `POST` cria um pedido e não grava linha de idempotência. A garantia, quando a chave é enviada, é a linha em `idempotency_keys`. Um body recusado pelo schema não passa pelo handler e portanto não traz esse header. Clientes que ignoram headers desconhecidos continuam compatíveis: o corpo, os status e os códigos de erro não mudam.
- Duas requisições simultâneas com a mesma chave serializam no SQLite (`BEGIN IMMEDIATE` e `busy_timeout`). Não existe registro "em andamento". Se o processo cair antes do commit, a transação é desfeita e nem o pedido nem a chave permanecem. A `PRIMARY KEY` da chave impede uma segunda inserção.
- Se a chave existir sem o pedido correspondente, a API responde **500** `IDEMPOTENCY_STATE_INVALID` e não cria outro pedido com essa chave.

Equivalência semântica do body: mesmos `table` e `items` (`productId`, `quantity` e `note` quando presente). A ordem das propriedades JSON não importa. A ordem dos itens importa. `note` omitida é diferente de `note` vazia. O total não entra na comparação porque o cliente não o envia.

**Compatibilidade:** nenhuma mudança obrigatória para clientes que já chamam `POST /orders` sem o header. Enviar `Idempotency-Key` é opt-in. O app Flutter ainda não gera nem envia essa chave; a integração fica para uma issue própria.

**Body**

```json
{
  "table": "12",
  "items": [
    { "productId": "p1", "quantity": 2, "note": "sem cebola" },
    { "productId": "p2", "quantity": 1 }
  ]
}
```

Exemplo com chave:

```http
POST /orders HTTP/1.1
Content-Type: application/json
Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000

{
  "table": "12",
  "items": [
    { "productId": "p1", "quantity": 2, "note": "sem cebola" },
    { "productId": "p2", "quantity": 1 }
  ]
}
```

**201 Created** — na criação, `Order` com snapshot completo. Na repetição, o corpo originalmente gravado: snapshot completo se o pedido nasceu nesta versão, ou o corpo legado se a chave é anterior ao snapshot.

**400** — `VALIDATION_ERROR` (body inválido; lista vazia; `quantity` &lt; 1 ou insegura; total fora da faixa de inteiros seguros; `Idempotency-Key` presente e inválida).

**404** — `PRODUCT_NOT_FOUND` se algum `productId` não existir **ou** estiver `available: false`. A chave, se enviada, não fica gravada.

**409** — `IDEMPOTENCY_KEY_CONFLICT` quando a chave já existe e o payload não é equivalente ao da primeira gravação. A idade da chave não muda esse resultado.

A gravação do pedido, dos itens e da chave de idempotência é atômica: falhas durante a validação ou a inserção não deixam pedido, itens ou chave parcialmente persistidos.

Exemplo de resposta:

```json
{
  "id": "o_550e8400-e29b-41d4-a716-446655440000",
  "orderNumber": 42,
  "table": "12",
  "status": "received",
  "items": [
    {
      "productId": "p1",
      "name": "Burger Clássico",
      "quantity": 2,
      "unitPriceCents": 3290,
      "lineTotalCents": 6580,
      "note": "sem cebola"
    },
    {
      "productId": "p2",
      "name": "Burger Smoke",
      "quantity": 1,
      "unitPriceCents": 3890,
      "lineTotalCents": 3890
    }
  ],
  "totalCents": 10470,
  "createdAt": "2026-10-25T18:00:00.000Z"
}
```

---

### `PATCH /orders/:id/status`

Avança o status em **um passo** conforme a tabela de transições.

**Body**

```json
{ "status": "preparing" }
```

**200 OK** — `Order` atualizado.  
**404** — `ORDER_NOT_FOUND`.  
**409** — `INVALID_STATUS_TRANSITION`.  
**400** — `VALIDATION_ERROR` (status fora do enum).

A transição pode avançar somente um passo: `received` → `preparing` → `ready` → `finished`. Regressões e saltos de etapa retornam `409` e não alteram o pedido.

---

### `POST /ai/recommendation` (R2)

Implementado na SCRUM-62. Este formato **substitui** o contrato preliminar, que aceitava `preferences` como texto e respondia `productIds` mais `fallback`. Aquele formato não foi implementado. Um body com `preferences` string, ou com os campos antigos na resposta, não é aceito.

A seleção, o fallback, a política alimentar e os estados de tela estão em [`ai-recommendation-design.md`](ai-recommendation-design.md). Este arquivo guarda o que entra e o que sai no HTTP.

O cardápio continua sendo a fonte de verdade. A resposta traz `productId` de produto real. Não traz nome, preço, imagem nem ingredientes: o cliente resolve isso em `GET /products`. Texto ou preço vindo do provedor não é gravado nem devolvido.

A rota não cria pedido, não altera carrinho e não lê `Idempotency-Key`.

**Body**

```json
{
  "table": "12",
  "preferences": {
    "budget": "from_36_to_60",
    "hunger": "normal",
    "protein": "beef",
    "style": "balanced",
    "taste": "savory",
    "restrictions": ["no_onion"]
  },
  "limit": 3
}
```

| Campo         | Tipo     | Obrigatório | Notas                                                                                                          |
| ------------- | -------- | ----------- | -------------------------------------------------------------------------------------------------------------- |
| `table`       | `string` | não         | 1–40 caracteres, com algum caractere que não seja espaço, sem espaço nas pontas. Não filtra e não é persistido |
| `preferences` | `object` | sim         | Objeto abaixo. String é `400`                                                                                  |
| `limit`       | `number` | não         | Inteiro de 1 a 3. Ausente vale `3`. `null` é `400`                                                             |

`additionalProperties: false` no body e em `preferences`. Campo desconhecido, inclusive um campo de texto livre, é `400 VALIDATION_ERROR`.

#### `preferences`

| Campo          | Tipo       | Obrigatório | Seleção  | Valores                                                                                                                   |
| -------------- | ---------- | ----------- | -------- | ------------------------------------------------------------------------------------------------------------------------- |
| `budget`       | `string`   | sim         | única    | `up_to_20`, `from_21_to_35`, `from_36_to_60`, `unlimited`                                                                 |
| `hunger`       | `string`   | sim         | única    | `little`, `normal`, `big`                                                                                                 |
| `protein`      | `string`   | sim         | única    | `chicken`, `fish`, `beef`, `vegetarian`                                                                                   |
| `style`        | `string`   | sim         | única    | `light`, `balanced`, `full`                                                                                               |
| `taste`        | `string`   | sim         | única    | `savory`, `sweet`                                                                                                         |
| `restrictions` | `string[]` | não         | múltipla | `no_onion`, `no_gluten`, `no_lactose`, `vegan`, `no_seafood`. Ausente ou `[]` significa nenhuma. Máximo de 5, sem repetir |

Pergunta omitida no objeto não recebe default. O cliente só envia a rota depois de responder as cinco escolhas únicas. Restrição é opcional.

Faixas de `budget`, em centavos inteiros e fechadas. Preço fora delas só entra em `unlimited`:

| Valor           | `priceCents`         |
| --------------- | -------------------- |
| `up_to_20`      | 0–2000               |
| `from_21_to_35` | 2100–3500            |
| `from_36_to_60` | 3600–6000            |
| `unlimited`     | qualquer inteiro ≥ 0 |

`2001–2099` e `3501–3599` não pertencem a nenhuma faixa limitada.

Combinação contraditória é `400 VALIDATION_ERROR`, antes de consultar o cardápio:

| Combinação                                     | Motivo                                  |
| ---------------------------------------------- | --------------------------------------- |
| `protein: fish` e `no_seafood`                 | A proteína escolhida é fruto do mar     |
| `protein: chicken`, `fish` ou `beef` e `vegan` | A proteína escolhida não cabe em vegano |

`vegetarian` com `vegan` não é contraditório: vegano é mais restrito e segue a política alimentar do desenho.

`no_gluten`, `no_lactose`, `vegan` e `no_seafood` são restrições críticas. Com o `Product` atual, que não tem atributo alimentar confiável, a rota responde `not_called` e `no_compatible_products`. Não há sugestão “sem glúten”, “sem lactose”, “vegano” ou “sem frutos do mar”. `no_onion` é filtro culinário e pode produzir sugestão, sem alegar que o preparo esteja livre de cebola.

**200 OK**

Há quatro combinações válidas. Qualquer outra é erro de implementação.

```json
{
  "provider": "answered",
  "outcome": "suggestions",
  "products": [
    {
      "productId": "p2",
      "reason": "Carne, R$ 36–60, Salgado, sem cebola na lista cadastrada"
    }
  ]
}
```

O JSON acima mostra o formato de `answered`. No seed atual, o mesmo body pelo fallback devolve esse único `p2` com `provider: unavailable`: `p9` também está na faixa e é carne, mas a lista dele cita cebola.

| `provider`    | `outcome`                | `products`                                     |
| ------------- | ------------------------ | ---------------------------------------------- |
| `answered`    | `suggestions`            | 1 a `limit` itens, na ordem aceita do provedor |
| `unavailable` | `suggestions`            | 1 a `limit` itens, na ordem determinística     |
| `not_called`  | `no_compatible_products` | `[]`                                           |
| `not_called`  | `empty_catalog`          | `[]`                                           |

| Campo       | Tipo     | Notas                                                                                                                                                                                                  |
| ----------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `provider`  | `string` | `answered`: ao menos um id do provedor passou no filtro. `unavailable`: chave ausente, timeout, falha ou nenhum id aproveitável, e o fallback achou prato. `not_called`: o provedor não foi consultado |
| `outcome`   | `string` | `suggestions`, `no_compatible_products` ou `empty_catalog`                                                                                                                                             |
| `products`  | `array`  | Vazio quando `outcome` não é `suggestions`. Sem id repetido                                                                                                                                            |
| `productId` | `string` | Existe no snapshot da requisição e está `available: true`                                                                                                                                              |
| `reason`    | `string` | Motivo curto montado pela API. 1–80 caracteres. Não vem do provedor                                                                                                                                    |

`empty_catalog`: nenhum produto com `available: true`. `no_compatible_products`: há produto disponível, mas nenhum passou nas regras. Os dois respondem **200** com lista vazia. Não se completa a lista com outros pratos.

**400** — `VALIDATION_ERROR`. Enum inválido, tipo errado, `limit` fora de 1–3, restrição repetida, contradição ou campo desconhecido. `details` segue o formato comum quando a falha é do schema.

**500** — `INTERNAL_ERROR` só se a leitura do cardápio ou o fallback falhar. Falha do provedor, com fallback concluído, continua **200** e `provider: unavailable`.

Não há `404` de produto nesta rota: id desconhecido do provedor é descartado, não vira erro HTTP.

---

## Decisões fechadas nesta task

1. Contrato em Markdown versionado (sem OpenAPI nesta entrega).
2. Soft-delete em `DELETE /products/:id` (`available: false`).
3. Sem paginação em listagens no R1.
4. Sem autenticação de usuário no MVP. O ambiente hospedado pode exigir um token compartilhado ([Acesso ao ambiente hospedado](#acesso-ao-ambiente-hospedado)).
5. Transições de status só em um passo; salto inválido → `409 INVALID_STATUS_TRANSITION`.
6. `POST /orders` rejeita produtos inexistentes ou indisponíveis com `PRODUCT_NOT_FOUND`.
7. `totalCents` calculado no servidor na criação; não é enviado pelo cliente.
8. `ingredients` é `string[]` ordenado. Omissão na criação grava `[]`. Omissão no `PUT` preserva a lista. `[]` explícito limpa. `description` não é fonte dessa lista.

## Acesso ao ambiente hospedado

Controlado por `DINNA_REQUIRE_API_TOKEN` e `DINNA_API_TOKEN` (ver `docs/deploy.md`). Desligado por padrão.

Com a proteção ligada:

- toda rota, exceto `GET /health` (e o `HEAD` automático), exige o header `X-Dinna-Api-Token` com o token configurado no servidor;
- vale também para rotas inexistentes: sem token a resposta é 401, não 404;
- header ausente, vazio ou diferente responde **401**, sempre com o mesmo corpo, antes de ler o body. Nada é gravado:

```json
{ "error": { "code": "UNAUTHORIZED", "message": "Token de acesso ausente ou inválido" } }
```

- com o token correto, payloads, status e códigos de erro das rotas não mudam.

O token é uma barreira de acesso compartilhada pela equipe para a apresentação acadêmica. Não identifica usuário nem substitui autenticação.

## Idempotência de `POST /orders` (SCRUM-89)

1. `Idempotency-Key` é opcional. Sem ela, o contrato anterior permanece: cada `POST` cria um pedido.
2. A chave é um UUID. A API guarda a forma em minúsculas.
3. Repetição equivalente responde **201** com o corpo original da criação, não com o pedido já atualizado por `PATCH` e não com **200**.
4. Payload divergente responde **409** `IDEMPOTENCY_KEY_CONFLICT`.
5. Pedido, itens e chave são confirmados juntos. Não há linha "em processamento". Concorrência usa o lock de escrita do SQLite e a `PRIMARY KEY` da chave.
6. Erro antes do commit desfaz pedido e chave. Uma chave órfã responde **500** `IDEMPOTENCY_STATE_INVALID` e não é reutilizada para criar outro pedido.

## Retenção permanente (SCRUM-90)

1. `idempotency_keys` não expira. O fingerprint e o `response_json` original permanecem. Não há segunda tabela, consulta por intenção, token, job nem limpeza.
2. Limite da garantia: ela depende da preservação contínua da linha em `idempotency_keys`. Enquanto essa linha existir, a mesma chave não cria outro pedido. Uma chave apagada por uma versão anterior não é reconstruída. Se chegar um novo `POST` com essa chave ausente, ele segue o caminho de uma intenção nova: um payload aceito cria outro pedido, mesmo que o pedido original permaneça em `orders`. O mesmo ocorre com uma chave que nunca chegou ao commit. Não há backfill e não se usa `INSERT OR IGNORE`.
3. Crescimento: cada linha guarda a chave, o fingerprint, o `order_id`, `created_at` e o JSON original. No pedido de exemplo, a ordem de grandeza fica em torno de 1 a 2 KB por chave, com o registro e o índice. Cerca de 200 criações por dia somam em torno de 100 MB por ano; cerca de 2 000 por dia, em torno de 1 GB por ano. O backup cresce junto. Não há expurgo. `created_at` não é prazo de validade; o índice `idx_idempotency_keys_created_at` deixa de servir a uma limpeza e permanece no schema já aplicado.
4. Rollback floor: depois que um binário sem `DELETE` em `idempotency_keys` atender o ambiente, não se publica de novo um binário que apague essas linhas. Restaurar o arquivo do banco é outra operação. Um backup anterior ao corte pode já não ter as linhas de chave, e esta versão não as reconstrói; um `POST` aceito com uma dessas chaves ausentes cria outro pedido. Um backup posterior ao corte só é seguro com um binário que não purga. Subir o binário antigo sobre o banco novo volta a apagar chaves com mais de 24 horas.
5. O contrato dos consumidores que não enviam `Idempotency-Key` permanece: cada `POST` cria um pedido. O único campo acrescentado depois é `orderNumber` (SCRUM-94), aditivo.
6. O fingerprint gravado usa a canonicalização atual. Alterá-la exige versionamento compatível com os hashes já persistidos. O schema de `POST /orders` permanece compatível com os payloads já aceitos. Replay de intenção commitada, com o mesmo payload, não pode ser rejeitado por mudança posterior do catálogo nem por exigência nova de schema incompatível com esse payload. Esta entrega não versiona o fingerprint nem muda o schema.

## Número público do pedido (SCRUM-94)

`orderNumber` identifica o pedido para pessoas: cliente, cozinha e balcão. `id` continua sendo a chave técnica de rota, relacionamento e idempotência.

1. Inteiro sequencial a partir de `1`, único no banco inteiro. Não há sequência por mesa nem por dia.
2. Atribuído na criação, dentro da mesma transação do pedido. Não muda depois, inclusive em `PATCH`.
3. Não é reutilizado. O contador `order_number_sequence` só avança; um pedido que deixe de existir não devolve o número.
4. Pedido recusado (404, 400) ou transação desfeita não consome número.
5. A formatação é do cliente. Sugestão: `#` mais quatro dígitos com zeros à esquerda (`42` → `#0042`). O número não volta a zero depois de `9999` (`10000` → `#10000`).
6. Aparece em `POST /orders` (201), `GET /orders`, `GET /orders/:id` e `PATCH /orders/:id/status`.
7. O replay de uma chave gravada antes desta versão devolve o corpo original sem `orderNumber`. O cliente deve tratar o campo como opcional na resposta do `POST` e, se faltar, buscar `GET /orders/:id` ou mostrar o pedido sem número.

Pedidos já gravados recebem número na primeira abertura desta versão, na ordem da fila (`createdAt` e, no empate, `id`). `id`, itens, status, total e chaves de idempotência não mudam.

## Persistência (SCRUM-25)

- Driver: `node:sqlite` (nativo).
- Schema aplicado na abertura com `CREATE TABLE IF NOT EXISTS` (sem runner de migrations). Um banco já existente recebe `idempotency_keys` na próxima subida.
- Seed: `src/db/seed.ts` (`p1`–`p12`) na primeira abertura com a tabela `products` vazia. Vários nascem com ingredientes ilustrativos. `p5` e `p6` nascem com `[]`. A abertura não regrava um banco que já tem produtos.
- Soft-delete e filtros de `GET /products` seguem este contrato.
- `idempotency_keys` guarda a chave, o fingerprint SHA-256 do body canônico, o `order_id`, `created_at` e o JSON da resposta original. A repetição do `POST` devolve essa resposta, não o pedido depois de uma mudança de status. A linha não é apagada por idade.
- `order_items` guarda snapshot de `product_name`, `unit_price_cents` e `line_total_cents` na criação. Banco antigo recebe essas colunas na abertura (`ALTER` + backfill a partir do cardápio atual). Esse backfill não reescreve `idempotency_keys.response_json`. O replay do `POST` continua devolvendo o JSON gravado, não o item migrado. Se o preço atual vezes a quantidade não couber em inteiro seguro, a migração não grava `unit_price_cents` nem `line_total_cents` dessa linha e não coloca outro número no lugar. O nome pode ser preenchido. Uma abertura seguinte tenta o snapshot de preço de novo.

- `orders.order_number` guarda o número público, com índice `UNIQUE` (`idx_orders_order_number`). `order_number_sequence` guarda o último número entregue, numa linha só. Banco antigo recebe a coluna na abertura: `ALTER`, numeração das linhas sem número, índice e contador, tudo numa transação `BEGIN IMMEDIATE`. Uma falha desfaz o conjunto; abrir de novo não muda número já atribuído. A coluna aceita `NULL` para que uma versão anterior da API continue gravando pedidos depois de um rollback; esses pedidos recebem número na abertura seguinte desta versão.

### Coluna `products.ingredients`

A lista não cabe numa coluna escalar já existente e não é CSV. A coluna `ingredients` é `TEXT NOT NULL DEFAULT '[]'` e guarda um JSON array de strings, na ordem do cadastro. A única conversão entre `string[]` e esse texto está em `src/modules/products/products.repository.ts`. Leitura de JSON inválido ou de lista fora das regras do contrato falha; a API não devolve `[]` no lugar.

Banco criado antes da coluna recebe, na abertura seguinte, `ALTER TABLE products ADD COLUMN ingredients TEXT NOT NULL DEFAULT '[]'` se `PRAGMA table_info(products)` ainda não mostrar `ingredients`. A consulta e o `ALTER` acontecem na mesma transação `BEGIN IMMEDIATE`, para duas aberturas simultâneas não tentarem criar a coluna juntas. As linhas antigas ficam com `[]`. O arquivo não é recriado. Tabelas de pedido não mudam. O limite de 80 conta pontos de código Unicode, não unidades UTF-16.

Preencher ingredientes ilustrativos num banco que já tem `p1`–`p12` não faz parte dessa abertura. `npm run demo:ingredients` só mostra a prévia e não altera o schema. `npm run demo:ingredients -- --apply` grava apenas `ingredients`, e só nos produtos de demonstração cujo nome ainda é o do seed e cuja lista ainda está vazia. Se a coluna ainda não existe, o comando recusa: a migração continua sendo a abertura da API.

## Próximos passos

- **R1:** módulo `orders` completo com o ciclo de status (tabelas já existem no schema).
- **R2:** `POST /ai/recommendation` implementado na SCRUM-62, conforme [`ai-recommendation-design.md`](ai-recommendation-design.md). O contrato preliminar de `preferences` string não foi implementado.
