# Contrato REST — Dinna API

> **Status:** rascunho de referência para R0.
> A versão aceita do contrato é entregue pela Task **SCRUM-24 (T1.5 — Definir o contrato inicial da API REST)**.
> Apenas `GET /health` está implementado nesta fundação.
>
> Legenda: **Implementado** = existe no código e tem teste · **Planejado** = previsto no backlog, contrato em rascunho · **Não implementado** = sem código.

## Convenções

- JSON em UTF-8; campos em `camelCase`.
- Identificadores como `string`.
- Valores monetários em centavos (`priceCents: number`) para evitar erro de ponto flutuante.
- Erros sempre no formato:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "...", "details": [] } }
```

| HTTP | `code`                 | Quando                                                           |
| ---- | ---------------------- | ---------------------------------------------------------------- |
| 400  | `VALIDATION_ERROR`     | Body/params/query fora do schema                                 |
| 404  | `NOT_FOUND`            | Rota inexistente (implementado); recurso inexistente (planejado) |
| 4xx  | definido no `AppError` | Regra de negócio (ex.: 409 em conflito)                          |
| 500  | `INTERNAL_ERROR`       | Erro inesperado (detalhes só no log)                             |

## Endpoints

| Método | Rota                 | Release | Status       | Descrição                                   |
| ------ | -------------------- | ------- | ------------ | ------------------------------------------- |
| GET    | `/health`            | R0      | Implementado | Verificação de disponibilidade              |
| GET    | `/products`          | R1      | Planejado    | Lista produtos (filtro por categoria/busca) |
| GET    | `/products/:id`      | R1      | Planejado    | Detalhe do produto                          |
| POST   | `/products`          | R1      | Planejado    | Cria produto (restaurante)                  |
| PUT    | `/products/:id`      | R1      | Planejado    | Atualiza produto (restaurante)              |
| DELETE | `/products/:id`      | R1      | Planejado    | Remove/desativa produto (restaurante)       |
| GET    | `/orders`            | R1      | Planejado    | Lista pedidos (fila do restaurante)         |
| POST   | `/orders`            | R1      | Planejado    | Cria pedido a partir da mesa                |
| PATCH  | `/orders/:id/status` | R1      | Planejado    | Atualiza status do pedido                   |
| POST   | `/ai/recommendation` | R2      | Planejado    | Recomendação com base no cardápio real      |

### `GET /health`

```http
GET /health
```

Resposta `200 OK`:

```json
{ "status": "ok" }
```

## Esboço dos recursos (planejado; a validar em SCRUM-24)

```jsonc
// Product
{ "id": "p1", "name": "...", "description": "...", "category": "...",
  "priceCents": 3290, "imageUrl": "...", "available": true }

// Order
{ "id": "o1", "table": "12", "status": "received",
  "items": [{ "productId": "p1", "quantity": 2, "note": "sem cebola" }],
  "totalCents": 6580, "createdAt": "2026-10-16T18:00:00Z" }
```

Ciclo de status do pedido (planejado; Epics E6 e E7):

```
received (Recebido) → preparing (Preparando) → ready (Pronto) → finished (Finalizado)
```

`POST /ai/recommendation` deve retornar apenas `productId` existentes no cardápio; IDs inválidos são descartados e a API aplica fallback (Epic E9, SCRUM-13).
