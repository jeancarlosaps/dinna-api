# Deploy da API

Guia do ambiente hospedado do Dinna: uma instância Fastify com SQLite em volume persistente, atrás de HTTPS.

A API não precisa de código específico de provedor. Tudo o que o ambiente hospedado exige já é lido de variáveis de ambiente (`PORT`, `HOST`, `DATABASE_PATH`, `LOG_LEVEL`, `GEMINI_*`, `DINNA_*`).

## Arquitetura

```text
Flutter iOS / Android
        |
        | HTTPS / REST
        v
  Proxy TLS do provedor
        |
        v
    Fastify API (1 instância)
        |
        v
  SQLite em volume (/data)
```

- **Uma única instância.** O SQLite fica em um arquivo local do volume. Duas instâncias no mesmo volume não são suportadas pelo provedor nem seguras para este banco.
- O schema e as migrações rodam na abertura do banco (`openDatabase`), dentro de `BEGIN IMMEDIATE`. Não existe passo separado de migração.
- O seed só entra quando `products` está vazia. Reiniciar ou fazer redeploy não reescreve o cardápio nem apaga pedidos.
- `SIGTERM` fecha o Fastify e o banco antes de sair.
- O banco usa o journal padrão (`DELETE`), sem arquivos `-wal`/`-shm`.

## Provedor: Railway (plano Hobby)

Escolhido por ter volume persistente no plano de entrada, deploy direto do GitHub, HTTPS automático e backups do volume. Plano Hobby: US$ 5/mês com US$ 5 de uso incluso. Uma instância pequena desta API cabe no uso incluso.

O Render não serve sem custo maior: a instância gratuita não aceita disco persistente e hiberna após 15 minutos.

### Criar o serviço

1. **New Project → Deploy from GitHub repo** → `jeancarlosaps/dinna-api`, branch `dev` (ou a branch combinada para a apresentação).
2. **Settings → Build:** builder Railpack (padrão). Ele roda `npm ci`, `npm run build` e inicia com `npm start`.
3. **Settings → Deploy:**
   - Healthcheck path: `/health`
   - Restart policy: `On Failure`
   - Replicas: `1` (volume não aceita réplicas)
4. **Volume:** botão direito no serviço → **Attach Volume** → mount path `/data`.
5. **Settings → Networking → Generate Domain.** O domínio `*.up.railway.app` já sai com TLS.
6. **Workspace → Usage → Usage limits:** definir um limite rígido (mínimo do provedor: US$ 10). Ao atingir, os serviços param.

A configuração fica no painel do Railway, não no repositório. O formato `railway.json` foi descontinuado pelo provedor e não é aceito em serviços novos.

### Variáveis de ambiente

| Variável                  | Valor no Railway     | Observação                                                                           |
| ------------------------- | -------------------- | ------------------------------------------------------------------------------------ |
| `DATABASE_PATH`           | `/data/dinna.sqlite` | **Obrigatória.** Sem ela o banco fica fora do volume e some a cada deploy.           |
| `RAILPACK_NODE_VERSION`   | `24`                 | Fixa o Node da CI. Sem ela o `engines` (`>=22.13`) pode resolver outra versão.       |
| `LOG_LEVEL`               | `info`               | Opcional.                                                                            |
| `PORT`                    | não definir          | O Railway injeta.                                                                    |
| `HOST`                    | não definir          | O padrão `0.0.0.0` já é o necessário.                                                |
| `GEMINI_API_KEY`          | vazio (recomendado)  | Sem chave a recomendação usa o fallback determinístico. Ver [Segurança](#segurança). |
| `GEMINI_TIMEOUT_MS`       | não definir          | Padrão 8000.                                                                         |
| `DINNA_REQUIRE_API_TOKEN` | `true`               | Liga a proteção por token. Ver [Proteção por token](#proteção-por-token).            |
| `DINNA_API_TOKEN`         | segredo gerado       | **Obrigatória** com a proteção ligada. Nunca versionar nem colar em chat ou issue.   |

Nunca coloque `GEMINI_API_KEY` ou `DINNA_API_TOKEN` no repositório ou em arquivo versionado. Use a aba **Variables** do serviço.

Se o deploy falhar com erro de permissão em `/data`, adicione `RAILWAY_RUN_UID=0`.

### Proteção por token

Sem proteção, qualquer pessoa com a URL lê pedidos, altera o cardápio e muda status. No ambiente hospedado a API exige um token compartilhado pela equipe no header `X-Dinna-Api-Token`.

- `GET /health` continua público, para o healthcheck do Railway.
- Todas as outras rotas, inclusive as que forem criadas depois, exigem o token. Sem ele a resposta é `401 UNAUTHORIZED`, sem ler o body e sem gravar nada.
- A comparação usa tempo constante. O token não vai para o log, para o banco nem para as mensagens de erro.
- Configuração inconsistente impede a subida: `DINNA_REQUIRE_API_TOKEN=true` sem token válido, `DINNA_API_TOKEN` definido sem ligar a proteção, ou valor desconhecido na obrigatoriedade. O deploy falha no healthcheck em vez de publicar a API aberta.

**Gerar o token** (na sua máquina, fora do repositório):

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

Mínimo de 32 caracteres ASCII visíveis, sem espaços. Cole o valor direto em **Variables** do Railway como `DINNA_API_TOKEN` e defina `DINNA_REQUIRE_API_TOKEN=true`. Compartilhe com a equipe por canal privado, nunca em issue, PR, commit ou print.

**Conferir no log de inicialização:** `Proteção por token: ligada`.

**Rotação e revogação:** gere um valor novo e troque `DINNA_API_TOKEN` em **Variables**. Aplique a mudança com o deploy que o Railway propõe. O token anterior para de valer quando a nova instância sobe. Não há período em que os dois valem: atualize os clientes logo em seguida. Faça a rotação depois da apresentação e sempre que o valor vazar.

Limitações:

- é uma barreira de acesso para um ambiente acadêmico, não autenticação. Todos usam o mesmo valor e a API não sabe quem fez cada chamada;
- quem tiver o token tem acesso total (leitura e escrita);
- não há rate limit nem bloqueio por tentativas;
- um token embutido em app distribuído pode ser extraído do binário. Ver [Flutter](#flutter).

### Publicar uma versão nova

O ambiente `production` não tem deploy automático: não existe gatilho de branch configurado, então merge ou push na `dev` não publica nada. O **Redeploy** do painel repete o commit do deployment atual e também não leva código novo.

Para publicar um commit:

1. Exporte o banco com os passos 1 a 3 de [Cópia avulsa do banco](#cópia-avulsa-do-banco) e confira a cópia. Se a versão tiver migração de schema, ensaie a migração numa cópia descartável desse arquivo antes de seguir.
2. Dispare o deploy do commit pela CLI autenticada. Os ids do serviço e do ambiente estão em `railway status --json`:

   ```bash
   railway api 'mutation { serviceInstanceDeployV2(serviceId: "<service-id>", environmentId: "<environment-id>", commitSha: "<sha-da-dev>") }'
   ```

3. Acompanhe o deployment. As migrações rodam quando a API abre o banco, antes de aceitar requisições, e o healthcheck em `/health` precisa passar dentro do timeout configurado.
4. Faça a [validação](#validação-depois-do-deploy). Se a versão nova se comportar mal, faça o **Redeploy** do deployment anterior em **Deployments**.

### Validação depois do deploy

Só leituras, a não ser que o ambiente esteja autorizado para testes. Leia o token sem gravá-lo no histórico do shell:

```bash
API=https://<dominio>.up.railway.app
read -rs DINNA_API_TOKEN && export DINNA_API_TOKEN
curl -s "$API/health"
curl -s -o /dev/null -w '%{http_code}\n' "$API/products"   # esperado: 401
curl -s -H "X-Dinna-Api-Token: $DINNA_API_TOKEN" "$API/products"
curl -s -H "X-Dinna-Api-Token: $DINNA_API_TOKEN" "$API/orders"
curl -s -X POST "$API/ai/recommendation" -H "X-Dinna-Api-Token: $DINNA_API_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"preferences":{"budget":"from_21_to_35","hunger":"normal","protein":"beef","style":"balanced","taste":"savory"}}'
```

Persistência só está comprovada depois de:

1. criar um pedido de teste;
2. **Restart** do serviço e conferir o pedido em `GET /orders`;
3. **Redeploy** e conferir de novo.

O redeploy com volume tem alguns segundos de indisponibilidade: o provedor para a instância antiga antes de montar o volume na nova. Evite deploy durante a apresentação.

## Backup e restauração

- **Backups do volume:** em **Settings → Backups** do serviço (conferir disponibilidade no plano), ligar o agendamento diário (retenção de 6 dias). Antes da apresentação, criar um backup manual.
- **Restaurar:** escolher o backup e clicar em **Restore**. O provedor monta um volume novo com aquela data e mantém o anterior desmontado. Revise e confirme o deploy.

Restaurar um backup antigo traz de volta pedidos já atendidos e chaves de idempotência daquela data. Use só com dados de demonstração.

### Cópia avulsa do banco

Não copie `dinna.sqlite` com `cp` enquanto a API está rodando. Use `VACUUM INTO`, que gera uma cópia consistente com o serviço no ar.

Pré-requisitos: [Railway CLI](https://docs.railway.com/cli) instalada, `railway login`, `railway link` no serviço da API e uma chave SSH registrada (a CLI pede no primeiro `railway ssh`).

**1. Gerar a cópia no volume.** Cada execução cria um arquivo novo em `/data/backups`, com data e hora no nome, e imprime o caminho. `VACUUM INTO` recusa destino já existente, por isso o nome não pode ser fixo.

```bash
railway ssh -- node -e "const{DatabaseSync}=require('node:sqlite');const fs=require('node:fs');fs.mkdirSync('/data/backups',{recursive:true});const out='/data/backups/dinna-'+new Date().toISOString().replace(/[:.]/g,'-')+'.sqlite';const d=new DatabaseSync('/data/dinna.sqlite');d.exec(\"VACUUM INTO '\"+out+\"'\");d.close();console.log(out)"
```

**2. Exportar para fora do Railway.** Uma cópia que fica em `/data` não protege nada: ela some junto com o volume. Baixe o arquivo para a sua máquina usando o caminho impresso no passo 1:

```bash
railway volume files download /data/backups/dinna-<data-hora>.sqlite ./dinna-<data-hora>.sqlite
```

O download usa SFTP pela própria CLI e só funciona com o serviço em execução (deployment ativo). O caminho pode ser absoluto (`/data/...`) ou relativo ao volume (`/backups/...`). Se o arquivo local já existir, o comando falha, a não ser que receba `--overwrite`.

**3. Conferir a cópia local:**

```bash
node -e "const{DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(process.argv[1],{readOnly:true});console.log(d.prepare('PRAGMA integrity_check').get(),d.prepare('SELECT COUNT(*) AS orders FROM orders').get())" ./dinna-<data-hora>.sqlite
```

O resultado esperado é `integrity_check: 'ok'` e a contagem de pedidos. Guarde o arquivo fora do repositório: `*.sqlite` está no `.gitignore` e não pode ser versionado.

As cópias em `/data/backups` ocupam o volume. Depois de exportar, apague as antigas com `railway volume files delete /data/backups/<arquivo> --yes`.

## Segurança

A API **não tem autenticação de usuário**. Sem a [proteção por token](#proteção-por-token), uma URL pública expõe:

- escrita no cardápio (`POST`, `PUT`, `DELETE /products`) e em pedidos (`POST /orders`, `PATCH /orders/:id/status`);
- leitura de todos os pedidos (`GET /orders`);
- `POST /ai/recommendation`, que gasta quota do Gemini quando há chave configurada.

Com a proteção ligada, tudo isso passa a exigir o token. Quem tem o token continua com acesso total.

O que já existe:

- token compartilhado opcional em `X-Dinna-Api-Token`, com subida bloqueada se a configuração estiver inconsistente;
- validação de schema em todas as rotas e limite de body de 1 MiB (padrão do Fastify, responde 413);
- logs sem body, sem headers, sem o token e sem a chave do Gemini;
- sem CORS: navegadores de outra origem são bloqueados. Isso **não** é controle de acesso: não protege contra clientes HTTP como `curl` ou o próprio app.

Regras para o ambiente hospedado:

- usar só dados fictícios; nenhum nome, telefone ou dado pessoal em pedidos;
- não divulgar a URL fora da equipe;
- sem `GEMINI_API_KEY`, ou com uma chave de projeto separado e limite de quota definido no Google AI Studio;
- limite rígido de gasto ligado no Railway;
- `DINNA_REQUIRE_API_TOKEN=true` antes de gerar o domínio público.

## Flutter

O app lê a URL por `--dart-define`:

```bash
flutter run --dart-define=API_BASE_URL=https://<dominio>.up.railway.app
```

Sem barra no final. Com HTTPS não é preciso liberar tráfego em texto claro no Android nem exceção de ATS no iOS.

**O app ainda não envia `X-Dinna-Api-Token`.** Com a proteção ligada, só o teste de conexão (`GET /health`) funciona; cardápio, pedidos e recomendação recebem 401. Não aponte o app para o ambiente protegido nem o anuncie como pronto para integração antes da mudança abaixo.

Mudança prevista no Flutter, em issue própria:

- todo acesso HTTP passa pelo `ApiClient` (`getJson` e `postJson`). Basta ele receber um header padrão e somar em cada requisição, sem mexer nos repositórios;
- o valor viria de `--dart-define=API_TOKEN=...`, ausente em desenvolvimento local;
- 401 deve aparecer como erro de configuração, não como falha de rede. Hoje o envio de pedido já trata 401 como falha que preserva a `Idempotency-Key`.

Valores de `--dart-define` ficam dentro do binário e podem ser extraídos. Use o token só em builds da equipe para a demonstração, nunca em app publicado em loja, e faça a rotação depois da apresentação.

## Desligar

Antes de remover o deployment ou excluir o projeto, **exporte o banco** com os passos 1 a 3 de [Cópia avulsa do banco](#cópia-avulsa-do-banco) e confira a cópia local. A ordem importa: o download exige deployment ativo, e os backups do Railway são apagados junto com o volume.

- **Pausar cobrança de CPU/RAM:** remover o deployment ativo do serviço. O volume continua cobrado por GB.
- **Encerrar tudo:** só depois da exportação conferida, **Settings → Danger → Delete project**. Apaga serviço, volume e backups do Railway.

## Evolução

A topologia atual atende a apresentação e um piloto pequeno. Ela trava em três pontos: uma instância, um arquivo SQLite e nenhuma autenticação de usuário (só um token compartilhado).

| Fase        | Mudança                                                                                                 | Sinal que justifica                                                                             |
| ----------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Piloto      | Autenticação por restaurante, rate limit, logs e métricas centralizados, backup testado com restauração | Usuários fora da equipe, dados reais                                                            |
| Crescimento | PostgreSQL gerenciado, várias instâncias stateless, pool de conexões                                    | `SQLITE_BUSY` ou latência de escrita, necessidade de deploy sem downtime, mais de uma instância |

O que ajuda na migração:

- o acesso a dados já está isolado em `*.repository.ts` por módulo;
- schema e migrações ficam em um só lugar (`src/db`);
- a idempotência guarda chave, hash e resposta na mesma transação do pedido, o que se traduz direto para PostgreSQL.

O que vai exigir trabalho:

- os repositórios usam a API síncrona do `node:sqlite`; com PostgreSQL passam a ser assíncronos e as rotas mudam junto;
- as transações usam `BEGIN IMMEDIATE`, que serializa a escrita no arquivo inteiro. Em PostgreSQL a garantia vem de restrição única e nível de isolamento, e os testes de concorrência precisam ser revistos;
- não existe `restaurant_id` nas tabelas. Isolar restaurantes exige migração de schema e autenticação primeiro.

Não há ORM nem camada genérica de persistência de propósito. Ela só entra quando a migração for decidida.
