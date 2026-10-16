# Contrato REST — Dinna API

> **Status:** rascunho de referência para R0.
> A versão aceita do contrato é entregue pela Task **SCRUM-24 (T1.5 — Definir o contrato inicial da API REST)**.
> Apenas `GET /health` está implementado nesta fundação.

## Convenções

- JSON em UTF-8; campos em `camelCase`.
- Identificadores como `string`.
- Valores monetários em centavos (`priceCents: number`) para evitar erro de ponto flutuante.
- Erros sempre no formato:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "...", "details": [] } }
```

| HTTP | `code`             | Quando                               |
| ---- | ------------------ | ------------------------------------ |
| 400  | `VALIDATION_ERROR` | Body/params/query fora do schema     |
| 404  | `NOT_FOUND`        | Rota ou recurso inexistente          |
| 409  | definido por caso  | Conflito de regra de negócio         |
| 500  | `INTERNAL_ERROR`   | Erro inesperado (detalhes só no log) |

## Endpoints

| Método | Rota                 | Release | Status       | Descrição                                   |
| ------ | -------------------- | ------- | ------------ | ------------------------------------------- |
| GET    | `/health`            | R0      | Implementado | Verificação de disponibilidade              |
| GET    | `/products`          | R1      | Previsto     | Lista produtos (filtro por categoria/busca) |
| GET    | `/products/:id`      | R1      | Previsto     | Detalhe do produto                          |
| POST   | `/products`          | R1      | Previsto     | Cria produto (restaurante)                  |
| PUT    | `/products/:id`      | R1      | Previsto     | Atualiza produto (restaurante)              |
| DELETE | `/products/:id`      | R1      | Previsto     | Remove/desativa produto (restaurante)       |
| GET    | `/orders`            | R1      | Previsto     | Lista pedidos (fila do restaurante)         |
| POST   | `/orders`            | R1      | Previsto     | Cria pedido a partir da mesa                |
| PATCH  | `/orders/:id/status` | R1      | Previsto     | Atualiza status do pedido                   |
| POST   | `/ai/recommendation` | R2      | Previsto     | Recomendação com base no cardápio real      |

### `GET /health`

```http
GET /health
```

```json
200 OK
{ "status": "ok" }
```

## Esboço dos recursos (a validar em SCRUM-24)

```jsonc
// Product
{ "id": "p1", "name": "...", "description": "...", "category": "...",
  "priceCents": 3290, "imageUrl": "...", "available": true }

// Order
{ "id": "o1", "table": "12", "status": "received",
  "items": [{ "productId": "p1", "quantity": 2, "note": "sem cebola" }],
  "totalCents": 6580, "createdAt": "2026-10-16T18:00:00Z" }
```

Ciclo de status do pedido (Epic E6 / E7):

```
received (Recebido) → preparing (Preparando) → ready (Pronto) → finished (Finalizado)
```

`POST /ai/recommendation` deve retornar apenas `productId` existentes no cardápio; IDs inválidos são descartados e a API aplica fallback (Epic E9, SCRUM-13).
