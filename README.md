<a id="topo"></a>

<p align="center">
  <picture>
    <source media="(prefers-reduced-motion: reduce)" srcset="docs/assets/readme/hero-still.svg" />
    <img src="docs/assets/readme/hero.svg" alt="dinna. api — Da mesa à operação. Um serviço Fastify atende os perfis cliente e restaurante. Health, produtos, pedidos e a recomendação de pratos estão implementados." width="1600" />
  </picture>
</p>

<h1 align="center">dinna-api</h1>

<p align="center">
  <strong>Da mesa à operação.</strong><br />
  A API REST do Dinna: produtos, pedidos, status e, no futuro, recomendações, em um monólito modular simples.
</p>

<p align="center">
  <a href="#comece-aqui"><strong>COMEÇAR →</strong></a>
  &nbsp;·&nbsp;
  <a href="#estado-atual">O QUE JÁ EXISTE</a>
  &nbsp;·&nbsp;
  <a href="docs/api-contract.md">CONTRATO REST</a>
  &nbsp;·&nbsp;
  <a href="#roadmap">ROADMAP</a>
  &nbsp;·&nbsp;
  <a href="CONTRIBUTING.md">CONTRIBUIR</a>
  &nbsp;·&nbsp;
  <a href="https://github.com/jeancarlosaps/dinna-flutter">APLICATIVO FLUTTER DO DINNA</a>
</p>

<p align="center">
  <a href="https://github.com/jeancarlosaps/dinna-api/actions/workflows/ci.yml"><img src="https://github.com/jeancarlosaps/dinna-api/actions/workflows/ci.yml/badge.svg?branch=main" alt="Status da CI na branch main" /></a>
  <img src="https://img.shields.io/badge/Node.js-24%20LTS-5E7355?logo=nodedotjs&amp;logoColor=white" alt="Node.js 24 LTS" />
  <img src="https://img.shields.io/badge/TypeScript-6.0.3-B4532A?logo=typescript&amp;logoColor=white" alt="TypeScript 6.0.3" />
  <img src="https://img.shields.io/badge/Fastify-5.12.7-2A211C?logo=fastify&amp;logoColor=white" alt="Fastify 5.12.7" />
  <img src="https://img.shields.io/badge/status-R0%20%C2%B7%20funda%C3%A7%C3%A3o%20em%20andamento-A86B12" alt="Status: R0, fundação em andamento" />
</p>

---

## Ecossistema Dinna

| Repositório                                                         | Papel                                                                              | Stack                          |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------ |
| [**dinna-flutter**](https://github.com/jeancarlosaps/dinna-flutter) | Aplicativo Flutter do Dinna: um app com dois perfis, **cliente** e **restaurante** | Flutter · Dart · Material 3    |
| **dinna-api** (este)                                                | Backend REST: fonte de verdade de produtos, pedidos e status                       | Node.js · TypeScript · Fastify |

```mermaid
flowchart LR
  subgraph APP["dinna-flutter · um app, dois perfis"]
    C["Perfil cliente"]
    R["Perfil restaurante"]
  end
  C -- "REST · JSON" --> API["dinna-api<br/>Fastify"]
  R -- "REST · JSON" --> API
  classDef app fill:#FBF6F0,stroke:#B4532A,color:#2A211C
  classDef api fill:#2A211C,stroke:#2A211C,color:#FBF6F0
  class C,R app
  class API api
```

O Dinna é um app de pedidos feitos **dentro do restaurante** (não é delivery). O cliente escolhe e envia o pedido da mesa; o restaurante recebe, prepara e finaliza, sem perder o atendimento humano. Esta API é o ponto em que as duas pontas se encontram.

<a id="estado-atual"></a>

## 01 · Estado atual

Fundação (R0) **em andamento**. Health, SQLite, seed de cardápio e CRUD de `/products` estão prontos. O módulo de pedidos permite criar, consultar e atualizar pedidos. `POST /ai/recommendation` sugere até três pratos do cardápio, com fallback determinístico se o Gemini não responder.

| Item                                                                                  | Situação                                       |
| ------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Servidor Fastify + TypeScript strict                                                  | ✅ Implementado                                |
| `GET /health`                                                                         | ✅ Implementado e testado                      |
| Formato único de erro (400 / 404 / `AppError` / 500)                                  | ✅ Implementado e testado                      |
| Validação de entrada com JSON Schema nativo do Fastify                                | ✅ Em uso nas rotas de produtos                |
| Variáveis de ambiente (`HOST`, `PORT`, `LOG_LEVEL`, `DATABASE_PATH`, Gemini opcional) | ✅ Implementado e testado                      |
| Lint, format, typecheck, testes, build, CI                                            | ✅ 63 testes · GitHub Actions                  |
| `/products` (CRUD + filtros)                                                          | ✅ Implementado e testado (SCRUM-25)           |
| Persistência SQLite (`node:sqlite`) + seed                                            | ✅ Implementado                                |
| `POST /orders`                                                                        | ✅ Implementado (SCRUM-45, SCRUM-89, SCRUM-90) |
| `GET /orders`                                                                         | ✅ Implementado e testado (SCRUM-47)           |
| `GET /orders/:id`                                                                     | ✅ Implementado e testado                      |
| `PATCH /orders/:id/status`                                                            | ✅ Implementado e testado (SCRUM-53)           |
| `/ai/recommendation`                                                                  | ✅ Implementado (SCRUM-62)                     |
| Autenticação                                                                          | ⬜ Fora do escopo atual                        |

---

## 02 · Stack

| Peça                       | Versão                                    | Por quê                                                                       |
| -------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------- |
| Node.js                    | 24 LTS na CI (`.nvmrc`); mínimo `>=22.13` | Linha LTS; carrega `.env` nativamente (`--env-file-if-exists`)                |
| TypeScript                 | 6.0.3, `strict`                           | O typescript-eslint 8 só suporta TypeScript `<6.1`, por isso não usamos o 7.x |
| Fastify                    | 5.12.7                                    | Rápido e simples, com validação por JSON Schema embutida e plugins por módulo |
| Vitest                     | 5.0.5                                     | Testes rápidos com `app.inject`, sem abrir porta                              |
| ESLint + typescript-eslint | 10.13.0 + 8.71.2                          | Lint com regras recomendadas                                                  |
| Prettier                   | 3.9.10                                    | Formatação única                                                              |
| tsx                        | 4.23.15                                   | `npm run dev` com reload                                                      |
| SQLite                     | `node:sqlite` (built-in, experimental)    | Sem dependência nativa extra; arquivo local em `data/dinna.sqlite`            |

A única dependência de runtime publicada no npm é `fastify`. Persistência usa o módulo nativo `node:sqlite` (sem ORM nem `dotenv`).

## 03 · Arquitetura

Monólito modular: **um processo, um deploy, um módulo por recurso.** Nada de microserviços, CQRS ou camadas sem uso.

```mermaid
flowchart LR
  REQ["Requisição HTTP"] --> F["Fastify<br/>buildApp()"]
  F --> VAL{"JSON Schema<br/>da rota"}
  VAL -- "inválido" --> EH["error handler<br/>400 VALIDATION_ERROR"]
  VAL -- "válido" --> MOD["módulo<br/>health / products / orders / recommendations"]
  MOD -- "AppError / erro" --> EH
  MOD --> DB["SQLite<br/>node:sqlite"]
  DB --> MOD
  MOD --> RES["Resposta JSON"]
  EH --> RES
  F -- "rota inexistente" --> NF["404 NOT_FOUND"]
  classDef core fill:#FBF6F0,stroke:#B4532A,color:#2A211C
  classDef err fill:#F4E3D7,stroke:#B4532A,color:#2A211C
  class REQ,F,VAL,MOD,DB,RES core
  class EH,NF err
```

| Arquivo                                                                              | Responsabilidade                                                                    |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| [`src/app.ts`](src/app.ts)                                                           | `buildApp()`: monta o Fastify sem abrir porta. É usado pelo servidor e pelos testes |
| [`src/server.ts`](src/server.ts)                                                     | Lê o ambiente, abre a porta e encerra com `SIGINT`/`SIGTERM`                        |
| [`src/config/env.ts`](src/config/env.ts)                                             | Lê e valida as variáveis de ambiente                                                |
| [`src/db/client.ts`](src/db/client.ts)                                               | Abre o SQLite, aplica schema e seed                                                 |
| [`src/shared/errors/app-error.ts`](src/shared/errors/app-error.ts)                   | `AppError`: erro de domínio com status HTTP                                         |
| [`src/shared/http/error-handler.ts`](src/shared/http/error-handler.ts)               | Formato único de erro e handler de 404                                              |
| [`src/modules/health/health.routes.ts`](src/modules/health/health.routes.ts)         | `GET /health`                                                                       |
| [`src/modules/products/products.routes.ts`](src/modules/products/products.routes.ts) | CRUD `/products`                                                                    |
| [`src/modules/orders/orders.routes.ts`](src/modules/orders/orders.routes.ts)         | Criação, consulta e atualização de pedidos                                          |
| [`src/modules/recommendations/`](src/modules/recommendations/)                       | `POST /ai/recommendation`: seleção, Gemini opcional e fallback                      |

### Estrutura real

```text
src/
├── app.ts
├── server.ts
├── config/
│   └── env.ts
├── db/
│   ├── client.ts            # openDatabase + seed
│   ├── schema.ts
│   ├── seed.ts
│   ├── demo-ingredients.ts  # prévia e gravação dos ingredientes de demonstração
│   ├── backfill-demo-ingredients.ts
│   └── types.ts
├── modules/
│   ├── health/
│   │   └── health.routes.ts
│   ├── orders/
│   │   ├── orders.routes.ts
│   │   ├── orders.repository.ts
│   │   └── order-idempotency.ts
│   ├── products/
│   │   ├── products.routes.ts
│   │   └── products.repository.ts
│   └── recommendations/
│       ├── preferences.ts
│       ├── selection.ts
│       ├── provider.ts
│       ├── recommend.ts
│       └── recommendations.routes.ts
└── shared/
    ├── errors/app-error.ts
    └── http/error-handler.ts
tests/
├── helpers/
│   └── create-order-worker.ts
├── env.test.ts
├── error-handler.test.ts
├── health.test.ts
├── orders.test.ts
├── orders-idempotency.test.ts
├── products.test.ts
├── recommendations.test.ts
├── recommendation-selection.test.ts
└── gemini-provider.test.ts
docs/
├── api-contract.md          # contrato REST aceito (SCRUM-24)
└── assets/readme/           # ilustrações deste README
```

### Como adicionar um módulo

1. Crie `src/modules/<recurso>/<recurso>.routes.ts` exportando um plugin `async (app) => { ... }`.
2. Declare um `schema` (`body`, `params`, `querystring`, `response`) em cada rota. A validação é automática e os erros viram `400 VALIDATION_ERROR`.
3. Lance `AppError(status, code, message)` para os erros de negócio.
4. Registre o módulo em `src/app.ts` com `app.register(...)`.
5. Teste com `buildApp().inject(...)` em `tests/`.

<a id="comece-aqui"></a>

## 04 · Comece aqui

### Requisitos

- Node.js 24. Com [nvm](https://github.com/nvm-sh/nvm), rode `nvm use` na raiz para ler o `.nvmrc`.
- npm (vem com o Node).

### Instalação

```bash
git clone git@github.com:jeancarlosaps/dinna-api.git
cd dinna-api
npm install
cp .env.example .env
```

### Configuração de ambiente

| Variável            | Padrão              | Descrição                                                                            |
| ------------------- | ------------------- | ------------------------------------------------------------------------------------ |
| `HOST`              | `0.0.0.0`           | Interface de escuta. `0.0.0.0` permite o acesso de emuladores e dispositivos na rede |
| `PORT`              | `3333`              | Porta HTTP (1–65535)                                                                 |
| `LOG_LEVEL`         | `info`              | `fatal`, `error`, `warn`, `info`, `debug`, `trace` ou `silent`                       |
| `DATABASE_PATH`     | `data/dinna.sqlite` | Arquivo SQLite. Testes usam `:memory:` via `buildApp()`                              |
| `GEMINI_API_KEY`    | ausente             | Opcional. Sem chave, a recomendação usa o fallback e não chama a rede                |
| `GEMINI_TIMEOUT_MS` | `8000`              | Opcional. Inteiro de 1000 a 15000. Tempo limite da chamada ao Gemini                 |

Valores inválidos de `HOST`, `PORT`, `LOG_LEVEL`, `DATABASE_PATH` e `GEMINI_TIMEOUT_MS` fazem a API falhar ao iniciar, com mensagem explícita. `GEMINI_API_KEY` ausente ou em branco não impede a subida: a recomendação usa o fallback. O `.env` **nunca** é versionado; só o `.env.example`.

### Execução local

```bash
npm run dev      # desenvolvimento, com reload (tsx watch)
```

```bash
npm run build    # compila para dist/
npm start        # roda o build compilado
```

### Ingredientes de demonstração

Os comandos abaixo rodam na raiz deste repositório. O banco padrão é o caminho relativo `data/dinna.sqlite` (`DATABASE_PATH`). Não apague esse arquivo para ver os ingredientes.

**A. Banco novo.** Se `data/dinna.sqlite` ainda não existe, subir a API cria o arquivo e grava o catálogo ilustrativo:

```bash
npm run dev
```

**B. Banco de desenvolvimento que já existe.** A abertura da API não altera produtos já gravados. A prévia não escreve e não muda o schema; `--apply` grava só `ingredients` dos produtos `p1`–`p12` cujo nome ainda é o do seed e cuja lista ainda está vazia:

```bash
npm run demo:ingredients
npm run demo:ingredients -- --apply
```

`NODE_ENV=production` recusa o `--apply`, sem exceção por argumento. O próximo `GET` lê o arquivo já atualizado. Se o erro for `database is locked`, pare a API e rode o `--apply` de novo. Se a mensagem disser que falta a coluna `products.ingredients`, suba a API uma vez para aplicar a migração já existente e rode o comando outra vez.

**C. Conferir um produto e o estado vazio:**

```bash
curl -s http://localhost:3333/products/p1
curl -s http://localhost:3333/products/p5
```

`p1` devolve a lista ilustrativa. `p5` (Refrigerante Lata) permanece com `"ingredients": []`.

### Health check

```bash
curl http://localhost:3333/health
```

```json
{ "status": "ok" }
```

Rota inexistente:

```bash
curl http://localhost:3333/nao-existe
```

```json
{ "error": { "code": "NOT_FOUND", "message": "Rota GET /nao-existe não encontrada" } }
```

### Recomendação de pratos

`POST /ai/recommendation` lê o cardápio uma vez e devolve até três pratos. Sem `GEMINI_API_KEY`, a API não chama a rede: o fallback determinístico responde na hora. A assinatura Gemini Student não é crédito desta API. A chave, se existir, fica só no processo do backend.

O modelo usado é `gemini-3.8-flash`, com saída estruturada, conforme a [documentação de structured output](https://ai.google.dev/gemini-api/docs/generate-content/structured-output). A chave é enviada no header `x-goog-api-key`, nunca na URL, no log ou no Flutter. Gere uma em [Google AI Studio](https://aistudio.google.com/apikey) e coloque em `.env`:

```bash
GEMINI_API_KEY=sua-chave
GEMINI_TIMEOUT_MS=8000
```

`GEMINI_TIMEOUT_MS` é opcional. O padrão é 8000 ms, entre 1000 e 15000. Estouro, rede, JSON inválido ou nenhum id aproveitável caem no mesmo fallback. Para ver esse caminho sem chave, deixe a variável de fora e chame o exemplo abaixo. Uma chave inválida também cai no fallback, mas a chamada sai para a rede. Os testes cobrem timeout e rede com fake, sem internet.

Exemplo com o seed, sem chave:

```bash
curl -s http://localhost:3333/ai/recommendation \
  -H 'content-type: application/json' \
  -d '{"table":"12","preferences":{"budget":"from_36_to_60","hunger":"normal","protein":"beef","style":"balanced","taste":"savory","restrictions":["no_onion"]},"limit":3}'
```

```json
{
  "provider": "unavailable",
  "outcome": "suggestions",
  "products": [
    {
      "productId": "p2",
      "reason": "Carne, R$ 36–60, Salgado, sem cebola na lista cadastrada"
    }
  ]
}
```

Os quatro resultados **200** possíveis:

| Como ver                                                                                                       | `provider`    | `outcome`                |
| -------------------------------------------------------------------------------------------------------------- | ------------- | ------------------------ |
| Sem chave, body do exemplo, seed intacto                                                                       | `unavailable` | `suggestions`            |
| Com chave e ao menos um id aceito do modelo. O teste `aceita ids do modelo` cobre o formato sem rede           | `answered`    | `suggestions`            |
| `protein: chicken` no seed, ou qualquer restrição crítica (`no_gluten`, `no_lactose`, `vegan`, `no_seafood`)   | `not_called`  | `no_compatible_products` |
| Nenhum produto `available: true`. `DELETE /products/:id` faz soft-delete; `PUT` com `available: true` restaura | `not_called`  | `empty_catalog`          |

A lista de ingredientes é informativa. A API não afirma ausência de alergênico nem preparo livre de contaminação cruzada. `no_onion` só tira o que cita cebola e o que não tem lista cadastrada; o motivo diz “sem cebola na lista cadastrada”, não que o preparo esteja livre de cebola. Sem atributo alimentar confiável, restrição crítica não gera sugestão. A pessoa confirma com a equipe: “Tem alergia? Confirme os ingredientes com a equipe antes de pedir.”

A validação dos ids do provedor e o fallback quando a chamada não serve já estão nesta rota, no mesmo conjunto elegível. Não há texto livre nem segunda rota. Uma versão futura pode interpretar uma frase e produzir este mesmo objeto; isso não faz parte desta entrega.

---

## 05 · Contratos REST

<p align="center">
  <img src="docs/assets/readme/flow.svg" alt="Ciclo do pedido: POST /orders cria o pedido como recebido; GET /orders lista a fila do restaurante; PATCH /orders/:id/status avança para preparando, pronto e finalizado." width="1600" loading="lazy" />
</p>

| Método   | Rota                 | Release | Situação         |
| -------- | -------------------- | ------- | ---------------- |
| `GET`    | `/health`            | R0      | **Implementado** |
| `GET`    | `/products`          | R0/R1   | **Implementado** |
| `GET`    | `/products/:id`      | R0/R1   | **Implementado** |
| `POST`   | `/products`          | R0/R1   | **Implementado** |
| `PUT`    | `/products/:id`      | R0/R1   | **Implementado** |
| `DELETE` | `/products/:id`      | R0/R1   | **Implementado** |
| `GET`    | `/orders`            | R1      | **Implementado** |
| `GET`    | `/orders/:id`        | R1      | **Implementado** |
| `POST`   | `/orders`            | R1      | **Implementado** |
| `PATCH`  | `/orders/:id/status` | R1      | **Implementado** |
| `POST`   | `/ai/recommendation` | R2      | **Implementado** |

Payloads, status e convenções estão em [`docs/api-contract.md`](docs/api-contract.md). O contrato foi **aceito** na **SCRUM-24** e é a fonte de verdade entre esta API e o app Flutter. `POST /orders` aceita o header opcional `Idempotency-Key` (SCRUM-89). Sem ele, cada chamada continua criando um pedido novo. Com a chave, a retenção é permanente (SCRUM-90): a mesma chave e o mesmo payload devolvem o snapshot original, qualquer que seja a idade da chave.

### Convenções de erro

Todas as respostas de erro usam o mesmo formato:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "...", "details": [] } }
```

| HTTP | `code`                 | Quando                                                         |
| ---- | ---------------------- | -------------------------------------------------------------- |
| 400  | `VALIDATION_ERROR`     | Body, params ou query fora do schema (`details` traz os erros) |
| 404  | `NOT_FOUND`            | Rota inexistente                                               |
| 4xx  | definido no `AppError` | Regra de negócio (ex.: 409 em conflito)                        |
| 500  | `INTERNAL_ERROR`       | Erro inesperado; o detalhe vai só para o log                   |

## 06 · Banco de dados

**Decisão (SCRUM-25):** `node:sqlite` (módulo nativo do Node.js 24). Sem `better-sqlite3`, sem ORM.

- Arquivo padrão: `data/dinna.sqlite` (criado na primeira subida; pasta no `.gitignore`).
- Testes: `:memory:` via `buildApp()` — isolados e sem arquivo em disco.
- Schema: tabelas `products`, `orders`, `order_items` e `idempotency_keys`. A chave de idempotência referencia o pedido, guarda o fingerprint e o JSON original, e não expira. Nenhum caminho da API apaga essa linha. Ela sobrevive a reinícios do processo.
- Limite da garantia: ela depende da preservação contínua da linha da chave no SQLite. Enquanto a linha existir, a mesma chave não cria outro pedido. Uma chave apagada por uma versão anterior não é reconstruída. Um novo `POST` com essa chave ausente segue o caminho de uma intenção nova: um payload aceito cria outro pedido, mesmo que o pedido original permaneça no banco. `INSERT OR IGNORE` não entra na recuperação.
- Crescimento: na ordem de 1 a 2 KB por chave no pedido de exemplo. Cerca de 200 criações por dia ficam em torno de 100 MB por ano; cerca de 2 000 por dia, em torno de 1 GB por ano, e o backup acompanha. Não há expurgo.
- Rollback floor: depois desta versão, não voltar a publicar um binário que execute `DELETE` em `idempotency_keys`. Restaurar o arquivo SQLite é outra operação e não autoriza esse binário. Um backup anterior ao corte pode já não ter chaves; um backup posterior só é seguro com o binário que não purga.
- Seed: 12 produtos (`p1`–`p12`) em [`src/db/seed.ts`](src/db/seed.ts) quando a tabela está vazia. Ingredientes ilustrativos de um arquivo já existente entram com `npm run demo:ingredients -- --apply`, sem apagar o SQLite.
- Status experimental do Node: a API sobe com um `ExperimentalWarning` do runtime; aceitável no MVP acadêmico.

> Não confunda com a **persistência local do app Flutter** (carrinho, preferências, último pedido), que é a SCRUM-27. São responsabilidades diferentes.

---

## 07 · Testes e qualidade

| Comando                    | O que faz                                                |
| -------------------------- | -------------------------------------------------------- |
| `npm test`                 | Vitest (`vitest run`)                                    |
| `npm run test:watch`       | Vitest em modo watch                                     |
| `npm run demo:ingredients` | Prévia dos ingredientes de demonstração; `--apply` grava |
| `npm run lint`             | ESLint                                                   |
| `npm run typecheck`        | `tsc --noEmit`                                           |
| `npm run format`           | Prettier, reescrevendo os arquivos                       |
| `npm run format:check`     | Prettier, só verificando                                 |
| `npm run build`            | Compila para `dist/`                                     |

O que os testes cobrem:

| Arquivo                                  | Cobre                                                                                                             |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `tests/health.test.ts`                   | `GET /health` responde 200 com `{ "status": "ok" }`                                                               |
| `tests/error-handler.test.ts`            | 404 padronizado, 400 de validação, `AppError` e 500 sem vazar o detalhe                                           |
| `tests/env.test.ts`                      | Valores padrão e rejeição de `PORT`, `LOG_LEVEL`, `DATABASE_PATH` e `GEMINI_TIMEOUT_MS`                           |
| `tests/products.test.ts`                 | Listagem/filtros, detalhe, create, update, soft-delete e erros                                                    |
| `tests/orders.test.ts`                   | Criação, consulta e atualização, transições, filtros e rollback                                                   |
| `tests/orders-idempotency.test.ts`       | Chave permanente, replay do snapshot, 409, concorrência, rollback, reinício, repetição tardia e catálogo alterado |
| `tests/recommendation-selection.test.ts` | Faixas, ordenação, tokens, restrição crítica e motivo                                                             |
| `tests/recommendations.test.ts`          | Contrato HTTP, seed, fallback, ids do provedor e ausência de escrita no banco                                     |
| `tests/gemini-provider.test.ts`          | `fetch` fake: timeout, rede, JSON inválido e corpo sem mesa nem chave                                             |

## 08 · CI

O workflow [`.github/workflows/ci.yml`](.github/workflows/ci.yml) roda em todo push na `main` e em todo pull request:

```text
checkout → Node (versão do .nvmrc) → npm ci → format:check → lint → typecheck → test → build
```

Não há deploy nem ambiente de produção.

## 09 · Integração com o app Flutter

O app aponta para esta API pela variável `API_BASE_URL` (veja o [README do app](https://github.com/jeancarlosaps/dinna-flutter#comece-aqui)). Com `HOST=0.0.0.0`:

| Onde o app roda    | URL da API                               |
| ------------------ | ---------------------------------------- |
| iOS Simulator      | `http://localhost:3333`                  |
| Android Emulator   | `http://10.0.2.2:3333`                   |
| Dispositivo físico | `http://<IP-do-computador-na-rede>:3333` |

Hoje o app chama `GET /health` na tela inicial (**“Verificar conexão com a API”**) e lê o formato de erro no `ApiClient`. O cardápio via `GET /products` já está disponível nesta API para a próxima integração no Flutter.

<a id="roadmap"></a>

## 10 · Roadmap

<p align="center">
  <img src="docs/assets/readme/roadmap.svg" alt="Roadmap. R0 Fundação, em andamento: app Flutter com MVVM base, API Fastify com /health, CI, contrato, SQLite e /products. Pedidos no R1. R1 MVP Operacional, planejado. R2 Dinna, Me ajuda a escolher, planejado. R3 Evoluções, icebox." width="1600" loading="lazy" />
</p>

Issues de API acompanhadas neste repositório. **Jira** foi consultado em 26/10/2026; **Código** reflete esta branch.

| Issue    | Task                                          | Jira         | Código                                                       |
| -------- | --------------------------------------------- | ------------ | ------------------------------------------------------------ |
| SCRUM-24 | Definir o contrato inicial da API REST        | Concluído    | Contrato aceito em `docs/api-contract.md`                    |
| SCRUM-25 | Preparar backend/mock da API                  | Concluído    | SQLite + seed + CRUD `/products`; schema de pedidos          |
| SCRUM-45 | Criar pedido (`POST /orders`)                 | Concluído    | Rota com validação, total calculado e persistência atômica   |
| SCRUM-47 | Consultar pedidos (`GET /orders`)             | Concluído    | Filtros por status e mesa, fila crescente e itens associados |
| SCRUM-53 | Atualizar status (`PATCH /orders/:id/status`) | Em andamento | Avanço de um passo e resposta com pedido atualizado          |

## 11 · Como contribuir

O fluxo completo está em [CONTRIBUTING.md](CONTRIBUTING.md). Em resumo:

1. Pegue uma issue no [Jira (SCRUM)](https://jeancarlosaps.atlassian.net/jira/software/projects/SCRUM/boards/1).
2. Crie a branch a partir da `main`: `feature/SCRUM-<n>-descricao`, `fix/SCRUM-<n>-descricao` ou `chore/SCRUM-<n>-descricao`.
3. Valide antes do PR: `npm run format:check && npm run lint && npm run typecheck && npm test`.
4. Abra o PR usando o [template](.github/pull_request_template.md), com a CI verde e a revisão de outro integrante.

## 12 · Equipe

| Integrante    | Foco planejado no backlog                                    |
| ------------- | ------------------------------------------------------------ |
| Jean Carlos   | Arquitetura e fundação, QA de arquitetura                    |
| Felipe Souza  | Contrato REST, backend/mock da API e operação do restaurante |
| Gabriel Abreu | Experiência do cliente e estrutura visual                    |
| João Victor   | Persistência e evoluções                                     |

Os focos vêm da distribuição de issues no backlog (Atividade 2) e não são cargos formais.

## 13 · Próximos passos

1. A rota `POST /ai/recommendation` está na API. O formulário no Flutter segue na entrega do app.
2. Sincronizar o `roadmap.svg` no [dinna-flutter](https://github.com/jeancarlosaps/dinna-flutter) se o status R0 mudar lá também.

## 14 · Links

- Jira (SCRUM): <https://jeancarlosaps.atlassian.net/jira/software/projects/SCRUM/boards/1>
- Figma: <https://www.figma.com/design/xYeeN6UBmj3lF458GF9qwA/Dinna-%C2%B7-App-Cliente?node-id=0-1>
- Aplicativo Flutter do Dinna: <https://github.com/jeancarlosaps/dinna-flutter>
- Contrato REST: [docs/api-contract.md](docs/api-contract.md)
- Sistema visual dos READMEs: [docs/assets/readme/DESIGN.md](docs/assets/readme/DESIGN.md)

<p align="center"><sub>Projeto acadêmico · Pós Mobile UTFPR · disciplina de Flutter · <a href="#topo">voltar ao topo ↑</a></sub></p>
