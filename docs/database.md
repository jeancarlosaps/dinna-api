# Banco de dados: operação e cuidados

Complementa a seção [Banco de dados do README](../README.md#banco-de-dados) com o que importa para quem opera um ambiente com dados que precisam ser preservados.

## Idempotência de `POST /orders`

A tabela `idempotency_keys` guarda, para cada `Idempotency-Key`, o pedido criado, o fingerprint do payload e o JSON original da resposta. A chave não expira e nenhum caminho da API apaga essa linha, que sobrevive a reinícios do processo.

**Limite da garantia.** A proteção depende da preservação contínua da linha da chave no SQLite:

- enquanto a linha existir, a mesma chave e o mesmo payload devolvem o pedido original, sem criar outro;
- uma chave apagada não é reconstruída a partir do pedido;
- um novo `POST` com uma chave ausente segue o caminho de uma intenção nova: um payload aceito cria outro pedido, mesmo que o pedido original continue no banco.

## Crescimento

Cada chave ocupa da ordem de 1 a 2 KB com o pedido de exemplo. Não há expurgo:

| Pedidos criados por dia | Crescimento aproximado por ano |
| ----------------------- | ------------------------------ |
| ~200                    | ~100 MB                        |
| ~2 000                  | ~1 GB                          |

O backup acompanha esse crescimento.

## Rollback

- Não publique uma versão que execute `DELETE` em `idempotency_keys`: isso quebra a garantia acima para pedidos já criados.
- Restaurar um arquivo SQLite é uma operação diferente de voltar a versão da API. Um backup anterior à retenção permanente pode não ter as chaves; um backup posterior só é seguro com uma versão que não apaga chaves.

## Migrações

As migrações rodam na abertura do banco, em [`src/db/client.ts`](../src/db/client.ts), e são aditivas: acrescentam colunas (`products.ingredients`, snapshot dos itens do pedido, `orders.order_number`) e preenchem os valores de linhas antigas sem apagar dados. Os testes em `tests/products-migration.test.ts`, `tests/orders-legacy-replay.test.ts` e `tests/orders-number.test.ts` cobrem bancos criados por versões anteriores.
