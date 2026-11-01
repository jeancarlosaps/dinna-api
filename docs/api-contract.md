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
| Recomendação IA (shape R2)      | Pagamentos, delivery, estoque  |

- Um restaurante, cardápio e fila pequenos (apresentação acadêmica).
- Sem auth no MVP: qualquer cliente HTTP pode chamar qualquer rota. A distinção **cliente × restaurante** fica no app Flutter (perfis de UI), não na API.
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
| 404  | `NOT_FOUND`                 | Rota inexistente **ou** recurso inexistente                     |
| 409  | `CONFLICT`                  | Transição de status inválida; regra de negócio em conflito      |
| 409  | `IDEMPOTENCY_KEY_CONFLICT`  | Mesma `Idempotency-Key` com payload diferente em `POST /orders` |
| 4xx  | definido no `AppError`      | Outras regras de domínio                                        |
| 500  | `INTERNAL_ERROR`            | Erro inesperado (detalhe só no log)                             |
| 500  | `IDEMPOTENCY_STATE_INVALID` | Chave de idempotência gravada sem o pedido correspondente       |

Códigos de recurso (usados com 404/`AppError`):

| `code`                      | Quando                                                                                       |
| --------------------------- | -------------------------------------------------------------------------------------------- |
| `PRODUCT_NOT_FOUND`         | `id` de produto inexistente                                                                  |
| `ORDER_NOT_FOUND`           | `id` de pedido inexistente                                                                   |
| `INVALID_STATUS_TRANSITION` | Status atual não permite o `status` pedido (HTTP 409)                                        |
| `IDEMPOTENCY_KEY_CONFLICT`  | HTTP 409. A `Idempotency-Key` ainda está na janela de retenção e o payload não é equivalente |
| `IDEMPOTENCY_STATE_INVALID` | HTTP 500. A chave existe, mas o pedido correspondente não                                    |

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
  "available": true
}
```

| Campo         | Tipo      | Obrigatório    | Notas                                  |
| ------------- | --------- | -------------- | -------------------------------------- |
| `id`          | `string`  | sim (resposta) | Gerado pela API na criação             |
| `name`        | `string`  | sim            | 1–120 caracteres                       |
| `description` | `string`  | sim            | Pode ser `""`; máx. 2000               |
| `category`    | `string`  | sim            | Slug livre (ex.: `burgers`, `bebidas`) |
| `priceCents`  | `number`  | sim            | Inteiro ≥ 0                            |
| `imageUrl`    | `string`  | não            | URI; omitido ou `null` se sem imagem   |
| `available`   | `boolean` | sim            | `false` = indisponível / soft-delete   |

### OrderItem

```json
{ "productId": "p1", "quantity": 2, "note": "sem cebola" }
```

| Campo       | Tipo     | Obrigatório | Notas                                                      |
| ----------- | -------- | ----------- | ---------------------------------------------------------- |
| `productId` | `string` | sim         | Deve existir e estar `available: true` na criação          |
| `quantity`  | `number` | sim         | Inteiro seguro ≥ 1; total precisa caber em centavos exatos |
| `note`      | `string` | não         | Máx. 200; observação do cliente                            |

### Order

```json
{
  "id": "o1",
  "table": "12",
  "status": "received",
  "items": [{ "productId": "p1", "quantity": 2, "note": "sem cebola" }],
  "totalCents": 6580,
  "createdAt": "2026-10-16T18:00:00Z"
}
```

| Campo        | Tipo          | Obrigatório    | Notas                                              |
| ------------ | ------------- | -------------- | -------------------------------------------------- |
| `id`         | `string`      | sim (resposta) | Gerado pela API                                    |
| `table`      | `string`      | sim            | Identificador da mesa (ex.: `"12"`)                |
| `status`     | `string`      | sim            | Ver ciclo abaixo                                   |
| `items`      | `OrderItem[]` | sim            | Mín. 1 item                                        |
| `totalCents` | `number`      | sim (resposta) | Soma `priceCents × quantity` no momento da criação |
| `createdAt`  | `string`      | sim (resposta) | ISO-8601 UTC                                       |

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

| Método   | Rota                 | Release | Status                | Quem usa (UI)                            |
| -------- | -------------------- | ------- | --------------------- | ---------------------------------------- |
| `GET`    | `/health`            | R0      | **Implementado**      | Ambos (checagem de conexão)              |
| `GET`    | `/products`          | R0/R1   | **Implementado**      | Cliente (cardápio); restaurante (gestão) |
| `GET`    | `/products/:id`      | R0/R1   | **Implementado**      | Ambos                                    |
| `POST`   | `/products`          | R0/R1   | **Implementado**      | Restaurante                              |
| `PUT`    | `/products/:id`      | R0/R1   | **Implementado**      | Restaurante                              |
| `DELETE` | `/products/:id`      | R0/R1   | **Implementado**      | Restaurante (soft-delete)                |
| `GET`    | `/orders`            | R1      | Contrato              | Restaurante (fila)                       |
| `POST`   | `/orders`            | R1      | **Implementado**      | Cliente (mesa)                           |
| `PATCH`  | `/orders/:id/status` | R1      | **Implementado**      | Restaurante                              |
| `POST`   | `/ai/recommendation` | R2      | Contrato (Fora do R1) | Cliente                                  |

---

### `GET /health`

Verificação de disponibilidade. Sem auth, sem query.

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

Cria produto. O `id` é gerado pela API. `available` default `true` se omitido.

**Body**

```json
{
  "name": "Burger Clássico",
  "description": "Pão, blend 180g, queijo e salada",
  "category": "burgers",
  "priceCents": 3290,
  "imageUrl": "https://example.com/burger.jpg",
  "available": true
}
```

**201 Created** — `Product` completo.  
**400** — `VALIDATION_ERROR`.

---

### `PUT /products/:id`

Substitui os campos editáveis do produto. Body igual ao de criação (sem `id`).

**200 OK** — `Product` atualizado.  
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
Cada item contém `id`, `table`, `status`, `items`, `totalCents` e `createdAt`. Cada elemento de `items` contém `productId`, `quantity` e, quando informado, `note`.

`status` aceita somente `received`, `preparing`, `ready` ou `finished`; `table` é comparada exatamente. Os filtros podem ser combinados. Consultas sem resultados retornam `[]`; parâmetros inválidos retornam **400 `VALIDATION_ERROR`**.

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
- A mesma chave e um payload semanticamente equivalente devolvem **201** com o corpo original da criação (mesmo `id`, `status`, itens, `totalCents` e `createdAt`), sem criar outro pedido. Um `PATCH` posterior muda o pedido persistido e a resposta de `GET /orders`, mas não altera essa repetição do `POST`.
- A mesma chave e um payload diferente respondem **409** `IDEMPOTENCY_KEY_CONFLICT` e não criam pedido. A chave continua associada ao primeiro pedido.
- Header presente e inválido (vazio, não UUID, UUID nulo ou repetido) responde **400** `VALIDATION_ERROR` e não cria pedido.
- Produto inexistente ou indisponível responde **404** `PRODUCT_NOT_FOUND` e **não consome** a chave: uma tentativa seguinte, com a mesma chave e um body válido, pode criar o pedido.
- A chave fica retida por **24 horas** a partir de `createdAt`. Depois disso a mesma chave pode criar outro pedido. A limpeza apaga só a chave, nunca o pedido, e ocorre dentro da transação de um `POST` que envia chave.
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

**201 Created** — `Order` completo, tanto na criação quanto na repetição equivalente.  
**400** — `VALIDATION_ERROR` (body inválido; lista vazia; `quantity` &lt; 1 ou insegura; total fora da faixa de inteiros seguros; `Idempotency-Key` presente e inválida).

**404** — `PRODUCT_NOT_FOUND` se algum `productId` não existir **ou** estiver `available: false`. A chave, se enviada, não fica gravada.

**409** — `IDEMPOTENCY_KEY_CONFLICT` quando a chave ainda está na janela de 24 horas e o payload não é equivalente ao da primeira gravação.

A gravação do pedido, dos itens e da chave de idempotência é atômica: falhas durante a validação ou a inserção não deixam pedido, itens ou chave parcialmente persistidos.

Exemplo de resposta:

```json
{
  "id": "o_550e8400-e29b-41d4-a716-446655440000",
  "table": "12",
  "status": "received",
  "items": [
    { "productId": "p1", "quantity": 2, "note": "sem cebola" },
    { "productId": "p2", "quantity": 1 }
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

Sugere produtos com base no cardápio real. A API **só** devolve `productId` que existam e estejam disponíveis; IDs inválidos do modelo são descartados. Se a lista filtrada ficar vazia, aplica **fallback** (ex.: primeiros N disponíveis por categoria popular) — detalhe de implementação na SCRUM-13 / Epic E9.

**Body**

```json
{
  "table": "12",
  "preferences": "sem glúten, leve",
  "limit": 3
}
```

| Campo         | Tipo     | Obrigatório | Notas                     |
| ------------- | -------- | ----------- | ------------------------- |
| `table`       | `string` | não         | Contexto opcional         |
| `preferences` | `string` | não         | Texto livre do cliente    |
| `limit`       | `number` | não         | Default `3`; inteiro 1–10 |

**200 OK**

```json
{
  "productIds": ["p1", "p3", "p5"],
  "fallback": false
}
```

| Campo        | Tipo       | Notas                                    |
| ------------ | ---------- | ---------------------------------------- |
| `productIds` | `string[]` | IDs válidos e `available: true`          |
| `fallback`   | `boolean`  | `true` se a API usou a regra de fallback |

---

## Decisões fechadas nesta task

1. Contrato em Markdown versionado (sem OpenAPI nesta entrega).
2. Soft-delete em `DELETE /products/:id` (`available: false`).
3. Sem paginação em listagens no R1.
4. Sem autenticação no MVP; documentado explicitamente.
5. Transições de status só em um passo; salto inválido → `409 INVALID_STATUS_TRANSITION`.
6. `POST /orders` rejeita produtos inexistentes ou indisponíveis com `PRODUCT_NOT_FOUND`.
7. `totalCents` calculado no servidor na criação; não é enviado pelo cliente.

## Idempotência de `POST /orders` (SCRUM-89)

1. `Idempotency-Key` é opcional. Sem ela, o contrato anterior permanece: cada `POST` cria um pedido.
2. A chave é um UUID. A API guarda a forma em minúsculas.
3. A retenção é de 24 horas. A limpeza é oportunista, na transação do `POST` que envia chave, e remove somente a chave.
4. Repetição equivalente responde **201** com o corpo original da criação, não com o pedido já atualizado por `PATCH` e não com **200**.
5. Payload divergente dentro da janela responde **409** `IDEMPOTENCY_KEY_CONFLICT`.
6. Pedido, itens e chave são confirmados juntos. Não há linha "em processamento". Concorrência usa o lock de escrita do SQLite e a `PRIMARY KEY` da chave.
7. Erro antes do commit desfaz pedido e chave. Uma chave órfã responde **500** `IDEMPOTENCY_STATE_INVALID` e não é reutilizada para criar outro pedido.

## Persistência (SCRUM-25)

- Driver: `node:sqlite` (nativo).
- Schema aplicado na abertura com `CREATE TABLE IF NOT EXISTS` (sem runner de migrations). Um banco já existente recebe `idempotency_keys` na próxima subida.
- Seed: `src/db/seed.ts` (`p1`–`p12`) na primeira abertura com tabela vazia.
- Soft-delete e filtros de `GET /products` seguem este contrato.
- `idempotency_keys` guarda a chave, o fingerprint SHA-256 do body canônico, o `order_id`, `created_at` e o JSON da resposta original. A repetição do `POST` devolve essa resposta, não o pedido depois de uma mudança de status.

## Próximos passos

- **R1:** módulo `orders` completo com o ciclo de status (tabelas já existem no schema).
- **R2:** implementação de `POST /ai/recommendation`.
