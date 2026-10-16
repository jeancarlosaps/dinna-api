# Contribuindo com o dinna-api

Este guia vale para os quatro integrantes do Dinna. O repositório irmão, [dinna-flutter](https://github.com/jeancarlosaps/dinna-flutter), segue o mesmo fluxo.

## Fluxo

```text
issue no Jira → branch a partir da main → commits pequenos → validação local → PR → CI verde → revisão → merge
```

1. **Escolha uma issue** no [Jira (SCRUM)](https://jeancarlosaps.atlassian.net/jira/software/projects/SCRUM/boards/1) e mova-a para _Em andamento_.
2. **Atualize a main** e crie sua branch:

   ```bash
   git switch main
   git pull
   git switch -c feature/SCRUM-<n>-descricao-curta
   ```

3. **Implemente** só o escopo da issue. Achados fora do escopo viram outra issue, não entram no mesmo PR.
4. **Valide localmente** (seção abaixo).
5. **Abra o PR** para a `main` usando o template.
6. **Peça revisão** a outro integrante. O merge acontece com a CI verde e uma aprovação.

## Branches

| Tipo           | Padrão                        | Quando usar                               |
| -------------- | ----------------------------- | ----------------------------------------- |
| Funcionalidade | `feature/SCRUM-<n>-descricao` | Story ou task de produto                  |
| Correção       | `fix/SCRUM-<n>-descricao`     | Bug                                       |
| Manutenção     | `chore/SCRUM-<n>-descricao`   | Build, CI, dependências, ajustes técnicos |
| Documentação   | `docs/<descricao>`            | Só documentação, sem issue específica     |

`<n>` é o número real da issue no Jira (ex.: a issue SCRUM-25 gera `feature/SCRUM-25-modulo-products`). Use minúsculas e hífens na descrição.

## Commits

Em português, curtos, no formato `tipo: descrição`:

| Tipo       | Uso                                       |
| ---------- | ----------------------------------------- |
| `feat`     | Nova funcionalidade                       |
| `fix`      | Correção de bug                           |
| `chore`    | Manutenção, configuração, dependências    |
| `ci`       | Workflows do GitHub Actions               |
| `docs`     | Documentação                              |
| `test`     | Testes                                    |
| `refactor` | Mudança interna sem alterar comportamento |

Exemplos: `feat: adiciona listagem de produtos`, `fix: corrige validação do status do pedido`.

- Um commit por mudança coerente; mudanças independentes viram commits separados.
- Adicione arquivos explicitamente (`git add caminho/arquivo`). Evite `git add .`.
- Nunca versione `.env`, bancos locais (`*.sqlite`, `*.db`), chaves ou tokens.

## Validação obrigatória antes do PR

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
```

A CI roda as mesmas verificações. **PR com CI vermelha não é revisado.**

Mudou ou criou um endpoint? Atualize o [`docs/api-contract.md`](docs/api-contract.md) no mesmo PR, cubra o endpoint com teste (`buildApp().inject`) e cole no PR um exemplo de requisição e resposta.

## Pull Request

- Título no formato do commit principal (ex.: `feat: adiciona listagem de produtos`).
- Preencha o [template](.github/pull_request_template.md): contexto, issue, alterações, evidências e testes.
- Evidência objetiva em vez de “testado e funcionando”: saída dos testes, `curl` com a resposta, logs.
- PR pequeno: se passar de ~400 linhas alteradas, considere dividir.

## Revisão

Quem revisa verifica:

- se o escopo bate com a issue;
- se o módulo segue o padrão do README: plugin por recurso, `schema` em cada rota e `AppError` para regra de negócio;
- se há testes para o comportamento novo ou alterado;
- se não há segredos, logs temporários ou código morto;
- se o README e o contrato REST foram atualizados quando o comportamento mudou.

## Critérios de merge

- [ ] CI verde
- [ ] Uma aprovação de outro integrante
- [ ] Conversas resolvidas
- [ ] Branch atualizada com a `main`

Depois do merge, mova a issue no Jira só se os critérios de aceite dela foram atendidos.

> A proteção automática da `main` (exigir PR, CI e revisão) não está disponível no plano atual do GitHub para repositórios privados. Por isso esses critérios dependem da disciplina da equipe: **não faça push direto na `main`.**
