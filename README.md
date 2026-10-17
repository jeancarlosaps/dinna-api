<a id="topo"></a>

<p align="center">
  <picture>
    <source media="(prefers-reduced-motion: reduce)" srcset="docs/assets/readme/hero-still.svg" />
    <img src="docs/assets/readme/hero.svg" alt="dinna. api — Da mesa à operação. Ilustração conceitual: os perfis cliente e restaurante do app Flutter conversam por REST com um único serviço Fastify; o módulo health está implementado e products, orders e recommendations aparecem como planejados." width="1600" />
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

Fundação (R0) **em andamento**. A API sobe, responde ao health check e já tem a infraestrutura para os módulos de produto. Nenhum recurso de negócio foi implementado ainda.

| Item                                                          | Situação                                                        |
| ------------------------------------------------------------- | --------------------------------------------------------------- |
| Servidor Fastify + TypeScript strict                          | ✅ Implementado                                                 |
| `GET /health`                                                 | ✅ Implementado e testado                                       |
| Formato único de erro (400 / 404 / `AppError` / 500)          | ✅ Implementado e testado                                       |
| Validação de entrada com JSON Schema nativo do Fastify        | ✅ Pronta para uso (testada com uma rota de teste)              |
| Variáveis de ambiente validadas (`HOST`, `PORT`, `LOG_LEVEL`) | ✅ Implementado e testado                                       |
| Lint, format, typecheck, testes, build, CI                    | ✅ 8 testes · GitHub Actions                                    |
| `/products`, `/orders`, `/orders/:id/status`                  | ⬜ Planejado (R1), [contrato em rascunho](docs/api-contract.md) |
| `/ai/recommendation`                                          | ⬜ Planejado (R2)                                               |
| Persistência (SQLite)                                         | ⬜ Decidida, **não implementada**                               |
| Autenticação                                                  | ⬜ Fora do escopo atual                                         |

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

A única dependência de runtime é `fastify`. Não há ORM, banco, `dotenv` nem framework adicional.

## 03 · Arquitetura

Monólito modular: **um processo, um deploy, um módulo por recurso.** Nada de microserviços, CQRS ou camadas sem uso.

```mermaid
flowchart LR
  REQ["Requisição HTTP"] --> F["Fastify<br/>buildApp()"]
  F --> VAL{"JSON Schema<br/>da rota"}
  VAL -- "inválido" --> EH["error handler<br/>400 VALIDATION_ERROR"]
  VAL -- "válido" --> MOD["módulo<br/>modules/health"]
  MOD -- "AppError / erro" --> EH
  MOD --> RES["Resposta JSON"]
  EH --> RES
  F -- "rota inexistente" --> NF["404 NOT_FOUND"]
  classDef core fill:#FBF6F0,stroke:#B4532A,color:#2A211C
  classDef err fill:#F4E3D7,stroke:#B4532A,color:#2A211C
  class REQ,F,VAL,MOD,RES core
  class EH,NF err
```

| Arquivo                                                                      | Responsabilidade                                                                    |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| [`src/app.ts`](src/app.ts)                                                   | `buildApp()`: monta o Fastify sem abrir porta. É usado pelo servidor e pelos testes |
| [`src/server.ts`](src/server.ts)                                             | Lê o ambiente, abre a porta e encerra com `SIGINT`/`SIGTERM`                        |
| [`src/config/env.ts`](src/config/env.ts)                                     | Lê e valida as variáveis de ambiente                                                |
| [`src/shared/errors/app-error.ts`](src/shared/errors/app-error.ts)           | `AppError`: erro de domínio com status HTTP                                         |
| [`src/shared/http/error-handler.ts`](src/shared/http/error-handler.ts)       | Formato único de erro e handler de 404                                              |
| [`src/modules/health/health.routes.ts`](src/modules/health/health.routes.ts) | `GET /health`                                                                       |

### Estrutura real

```text
src/
├── app.ts
├── server.ts
├── config/
│   └── env.ts
├── modules/
│   └── health/
│       └── health.routes.ts
└── shared/
    ├── errors/app-error.ts
    └── http/error-handler.ts
tests/
├── env.test.ts
├── error-handler.test.ts
└── health.test.ts
docs/
├── api-contract.md          # contrato REST (implementado × planejado)
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

| Variável    | Padrão    | Descrição                                                                            |
| ----------- | --------- | ------------------------------------------------------------------------------------ |
| `HOST`      | `0.0.0.0` | Interface de escuta. `0.0.0.0` permite o acesso de emuladores e dispositivos na rede |
| `PORT`      | `3333`    | Porta HTTP (1–65535)                                                                 |
| `LOG_LEVEL` | `info`    | `fatal`, `error`, `warn`, `info`, `debug`, `trace` ou `silent`                       |

Valores inválidos fazem a API falhar ao iniciar, com mensagem explícita. O `.env` **nunca** é versionado; só o `.env.example`.

### Execução local

```bash
npm run dev      # desenvolvimento, com reload (tsx watch)
```

```bash
npm run build    # compila para dist/
npm start        # roda o build compilado
```

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

---

## 05 · Contratos REST

<p align="center">
  <img src="docs/assets/readme/flow.svg" alt="Ciclo planejado do pedido: POST /orders cria o pedido como recebido; PATCH /orders/:id/status avança para preparando, pronto e finalizado; GET /orders lista a fila do restaurante. Ainda não implementado." width="1600" loading="lazy" />
</p>

| Método   | Rota                 | Release | Situação         |
| -------- | -------------------- | ------- | ---------------- |
| `GET`    | `/health`            | R0      | **Implementado** |
| `GET`    | `/products`          | R1      | Planejado        |
| `GET`    | `/products/:id`      | R1      | Planejado        |
| `POST`   | `/products`          | R1      | Planejado        |
| `PUT`    | `/products/:id`      | R1      | Planejado        |
| `DELETE` | `/products/:id`      | R1      | Planejado        |
| `GET`    | `/orders`            | R1      | Planejado        |
| `POST`   | `/orders`            | R1      | Planejado        |
| `PATCH`  | `/orders/:id/status` | R1      | Planejado        |
| `POST`   | `/ai/recommendation` | R2      | Planejado        |

Payloads, status e convenções estão em [`docs/api-contract.md`](docs/api-contract.md). O documento é um **rascunho de referência**; o contrato vira definitivo com o aceite da **SCRUM-24**.

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

## 06 · Banco de dados planejado

**Decisão:** SQLite para desenvolvimento local e para a apresentação acadêmica. **Nada foi implementado ainda:** não há driver, schema nem arquivo de banco.

- É um arquivo único, sem infraestrutura, e roda igual na máquina de toda a equipe.
- Aguenta o volume do projeto (um restaurante, poucos pedidos simultâneos).
- `*.sqlite`, `*.sqlite3`, `*.db` e `data/` já estão no `.gitignore`.

**Próximo passo (SCRUM-25):** escolher o driver (`node:sqlite` nativo ou `better-sqlite3`), criar o schema de `products` e `orders` e um seed de cardápio.

> Não confunda com a **persistência local do app Flutter** (carrinho, preferências, último pedido), que é a SCRUM-27. São responsabilidades diferentes.

---

## 07 · Testes e qualidade

| Comando                | O que faz                          |
| ---------------------- | ---------------------------------- |
| `npm test`             | Vitest (`vitest run`)              |
| `npm run test:watch`   | Vitest em modo watch               |
| `npm run lint`         | ESLint                             |
| `npm run typecheck`    | `tsc --noEmit`                     |
| `npm run format`       | Prettier, reescrevendo os arquivos |
| `npm run format:check` | Prettier, só verificando           |
| `npm run build`        | Compila para `dist/`               |

O que os 8 testes cobrem:

| Arquivo                       | Cobre                                                                   |
| ----------------------------- | ----------------------------------------------------------------------- |
| `tests/health.test.ts`        | `GET /health` responde 200 com `{ "status": "ok" }`                     |
| `tests/error-handler.test.ts` | 404 padronizado, 400 de validação, `AppError` e 500 sem vazar o detalhe |
| `tests/env.test.ts`           | Valores padrão e rejeição de `PORT` e `LOG_LEVEL` inválidos             |

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

Hoje o app chama apenas `GET /health`, na tela inicial (**“Verificar conexão com a API”**), e lê o formato de erro desta API no `ApiClient`.

<a id="roadmap"></a>

## 10 · Roadmap

<p align="center">
  <img src="docs/assets/readme/roadmap.svg" alt="Roadmap. R0 Fundação, em andamento: app Flutter com MVVM base, API Fastify com /health e CI existem; models, rotas e contrato ainda não. R1 MVP Operacional, planejado. R2 Dinna, Me ajuda a escolher, planejado. R3 Evoluções, icebox." width="1600" loading="lazy" />
</p>

Tasks R0 que tocam este repositório. **Jira** é o status no board em 16/10/2026; **Código** é o que existe nesta branch.

| Issue    | Task                                   | Jira    | Código                                                                                     |
| -------- | -------------------------------------- | ------- | ------------------------------------------------------------------------------------------ |
| SCRUM-24 | Definir o contrato inicial da API REST | A fazer | Rascunho em `docs/api-contract.md`; falta o aceite de quem implementa e de quem consome    |
| SCRUM-25 | Preparar backend/mock da API           | A fazer | Parcial: servidor, `/health`, erros e testes prontos; produtos e pedidos não implementados |

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

1. **SCRUM-24:** revisar e aceitar o contrato (payloads de `Product` e `Order`, status e erros).
2. **SCRUM-25:** implementar o módulo `products` (listagem e detalhe) com dados de seed.
3. **SCRUM-25:** escolher o driver SQLite e criar o schema mínimo.
4. **R1:** implementar o módulo `orders` com o ciclo `received → preparing → ready → finished`.

## 14 · Links

- Jira (SCRUM): <https://jeancarlosaps.atlassian.net/jira/software/projects/SCRUM/boards/1>
- Figma: <https://www.figma.com/design/xYeeN6UBmj3lF458GF9qwA/Dinna-%C2%B7-App-Cliente?node-id=0-1>
- Aplicativo Flutter do Dinna: <https://github.com/jeancarlosaps/dinna-flutter>
- Contrato REST: [docs/api-contract.md](docs/api-contract.md)
- Sistema visual dos READMEs: [docs/assets/readme/DESIGN.md](docs/assets/readme/DESIGN.md)

<p align="center"><sub>Projeto acadêmico · Pós Mobile UTFPR · disciplina de Flutter · <a href="#topo">voltar ao topo ↑</a></sub></p>
