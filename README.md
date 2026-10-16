# dinna-api

API REST do **Dinna** — _"Pedido à mesa, do seu jeito."_

O Dinna é um aplicativo de pedidos feitos **dentro do restaurante** (não é delivery): o cliente escolhe na mesa e o restaurante recebe o pedido sem perder o atendimento humano. Esta API atende o app [`dinna-flutter`](https://github.com/jeancarlosaps/dinna-flutter): produtos, pedidos, status e, futuramente, recomendações.

Projeto acadêmico — disciplina de Flutter, Pós Mobile UTFPR.
Equipe: Jean Carlos, Felipe Souza, Gabriel Abreu, João Victor.

## Estado atual (R0 — Fundação)

| Item                                | Situação                                         |
| ----------------------------------- | ------------------------------------------------ |
| Servidor Fastify + TypeScript       | Pronto                                           |
| `GET /health`                       | Implementado                                     |
| Tratamento de erros padronizado     | Pronto (400 / 404 / AppError / 500)              |
| Validação de entrada (JSON Schema)  | Pronto via schema nativo do Fastify              |
| Lint, format, typecheck, testes, CI | Prontos                                          |
| Produtos, pedidos, recomendação     | Previstos — ver [contrato](docs/api-contract.md) |
| Persistência                        | Decidida (SQLite), não implementada              |

## Stack

- **Node.js** 24 LTS (mínimo 22.13) — versão em `.nvmrc`
- **TypeScript** 6.0 (`strict`)
- **Fastify** 5
- **Vitest** (testes com `app.inject`, sem abrir porta)
- **ESLint** (typescript-eslint) + **Prettier**

## Requisitos

- Node.js 24 (`nvm use` lê o `.nvmrc`)
- npm (vem com o Node)

## Instalação e execução

```bash
npm install
cp .env.example .env   # ajuste se necessário
npm run dev            # http://localhost:3333 com reload
```

Produção local (build compilado):

```bash
npm run build
npm start
```

Verificação:

```bash
curl http://localhost:3333/health
# {"status":"ok"}
```

### Variáveis de ambiente

| Variável    | Padrão    | Descrição                                                    |
| ----------- | --------- | ------------------------------------------------------------ |
| `HOST`      | `0.0.0.0` | Interface de escuta. `0.0.0.0` permite emulador/dispositivo  |
| `PORT`      | `3333`    | Porta HTTP                                                   |
| `LOG_LEVEL` | `info`    | `fatal`, `error`, `warn`, `info`, `debug`, `trace`, `silent` |

O `.env` é carregado com `--env-file-if-exists` (nativo do Node, sem `dotenv`). **Nunca versione o `.env`.**

## Qualidade

| Comando                | O que faz              |
| ---------------------- | ---------------------- |
| `npm run lint`         | ESLint                 |
| `npm run format`       | Prettier (escreve)     |
| `npm run format:check` | Prettier (só verifica) |
| `npm run typecheck`    | `tsc --noEmit`         |
| `npm test`             | Vitest                 |
| `npm run build`        | Compila para `dist/`   |

A CI (`.github/workflows/ci.yml`) roda format check, lint, typecheck, testes e build em todo push na `main` e em todo pull request.

## Arquitetura

Monólito modular simples. Cada módulo agrupa rotas, schemas e regra de negócio do seu recurso; nada de microserviços, CQRS ou camadas sem uso.

```
src/
├── app.ts                  # buildApp(): monta o Fastify (usado por server e testes)
├── server.ts               # lê env, abre porta, encerra com SIGINT/SIGTERM
├── config/
│   └── env.ts              # leitura e validação de variáveis de ambiente
├── modules/
│   └── health/             # GET /health
└── shared/
    ├── errors/app-error.ts # erro de domínio com status HTTP
    └── http/error-handler.ts # formato único de erro + 404
tests/                      # testes Vitest
docs/api-contract.md        # contrato REST previsto
```

### Como adicionar um módulo

1. Criar `src/modules/<recurso>/<recurso>.routes.ts` exportando um plugin `async (app) => { ... }`.
2. Declarar `schema` (body, params, querystring, response) em cada rota — a validação é automática e erros viram `400 VALIDATION_ERROR`.
3. Lançar `AppError` para erros de negócio.
4. Registrar em `src/app.ts` com `app.register(...)`.
5. Testar com `buildApp().inject(...)` em `tests/`.

Módulos previstos: `products` (R1), `orders` (R1), `recommendations` (R2).

## Persistência

**Decisão:** SQLite para desenvolvimento local e apresentação acadêmica.

- Arquivo único, zero infraestrutura, roda igual em todas as máquinas da equipe.
- Suficiente para o volume do projeto (um restaurante, poucos pedidos simultâneos).
- Arquivos `*.sqlite`/`*.db` já estão no `.gitignore`.

**Próximo passo** (Task SCRUM-25 — T1.6): escolher o driver (`node:sqlite` nativo ou `better-sqlite3`), criar o schema de `products` e `orders` e um seed de cardápio.

> Não confundir com a **persistência local do app Flutter** (carrinho, preferências, último pedido — Task SCRUM-27, T1.8). Responsabilidades diferentes.

## Integração com o app Flutter

O app aponta para esta API via `API_BASE_URL` (ver README do `dinna-flutter`). Com `HOST=0.0.0.0`:

| Onde o app roda    | URL da API                              |
| ------------------ | --------------------------------------- |
| iOS Simulator      | `http://localhost:3333`                 |
| Android Emulator   | `http://10.0.2.2:3333`                  |
| Dispositivo físico | `http://<IP-do-computador-na-LAN>:3333` |

## Contribuição

- Branch a partir da `main`: `feature/SCRUM-<n>-descricao` ou `fix/SCRUM-<n>-descricao`.
- Commits pequenos, em português, no padrão `tipo: descrição` (`feat`, `fix`, `chore`, `ci`, `docs`, `test`, `refactor`).
- Pull Request para a `main` com CI verde e revisão de outro integrante.
- Antes de abrir PR: `npm run format:check && npm run lint && npm run typecheck && npm test`.

## Links

- Jira (SCRUM): https://jeancarlosaps.atlassian.net/jira/software/projects/SCRUM/boards/1
- Figma: https://www.figma.com/design/xYeeN6UBmj3lF458GF9qwA/Dinna-%C2%B7-App-Cliente?node-id=0-1
- App Flutter: https://github.com/jeancarlosaps/dinna-flutter
