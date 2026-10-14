---
tipo: decisao
data: 2026-10-14
estado: aceita
---

# Cofre de credenciais por loja: a chave da integradora RENAVE

> **Aprovada pelo Israel em 14/10/2026.** É a primeira tarefa da R3, antes do
> adaptador.

## Contexto

O Israel decidiu em 14/10/2026 que **o AutoConnect não paga integradora**: a loja
contrata e paga a dela, e o AutoConnect só conecta ([plano fiscal](../planos/plano-fiscal-renave-nfe.md),
decisões em aberto, item 2). A consequência é que **cada loja tem a sua chave de
API** na integradora — na IntegraRenave, a `X-API-Key` (`ir_live_…`) identifica um
CNPJ e cobra R$ 19,99 por requisição na conta dele.

Para enviar ao RENAVE em nome da loja, o AutoConnect precisa guardar essa chave.
Hoje **nenhum segredo por loja** existe no banco: as credenciais de Asaas,
Clicksign e Meta são da plataforma e moram no `.env`. A
[decisão de 14/10/2026](2026-10-14%20renave%20dados%20do%20crv%20e%20credencial.md)
deixou isso para quando houvesse integradora escolhida — e com a loja pagando,
não há como evitar.

O que está em jogo: quem tem a chave **gasta o dinheiro da loja** (cada envio é
uma cobrança) e **registra operação no RENAVE em nome dela**. Vazar a chave de
uma loja é deixar alguém registrar a venda de um carro que não foi vendido.

## Decisão proposta

**Criptografia na própria API, com uma chave-mestra da plataforma no `.env`.**

1. **Guardada cifrada, nunca em texto.** AES-256-GCM (o `crypto` do Node, sem
   dependência nova). Cada credencial tem o seu vetor aleatório, e o `tenant_id`
   e o fornecedor entram como dado autenticado: a cifra copiada para a linha de
   outra loja **não abre**.
2. **A chave-mestra fica no Railway** (`COFRE_CHAVES_MESTRAS`, 32 bytes em
   base64 por versão, no formato `1:<base64>`; na troca, `1:<antiga>,2:<nova>`) e numa
   cópia de segurança fora dele, no gerenciador de senhas do Israel. Perdê-la
   não é catástrofe — cada loja cola a sua chave de novo —, mas é trabalho para
   todas as lojas de uma vez.
3. **Escrever é do dono da loja; usar é da gerência.** Só o `tenant_admin`
   cadastra, troca ou apaga a chave — é ela que gasta o dinheiro da loja. O
   `manager` envia ao RENAVE com ela, sem nunca vê-la.
4. **Entra, é conferida, e não sai mais.** Ao colar, a API testa a chave na
   integradora (uma chamada de leitura, sem custo) antes de gravar. Depois, a
   tela mostra só `••••a1b2`, quando e por quem foi cadastrada. Nenhuma rota
   devolve a chave, nem para o dono.
5. **Aberta só na hora do uso**, dentro da chamada à integradora, e descartada
   em seguida. Nunca em log, nunca em mensagem de erro, nunca no `payload` do
   registro RENAVE.
6. **Trocar e revogar sem apagar a trilha.** Trocar grava a nova e marca a antiga
   como substituída; revogar marca a data. A linha fica, sem a cifra — dá para
   saber quem tinha chave quando, sem guardar chave nenhuma.
7. **Troca da chave-mestra prevista desde o início**: cada linha diz com qual
   versão foi cifrada (`versao_da_chave`), e um comando recifra tudo com a nova.

**Onde fica:** uma tabela `credenciais_de_integracao` (loja, fornecedor, cifra,
vetor, etiqueta, versão da chave, últimos 4 caracteres, quem cadastrou, datas),
com RLS por loja como toda tabela com `tenant_id`, e uma tela
`/configuracoes/integracoes`. O código fica em `common/cofre/`, genérico: a
próxima credencial por loja (portal, outra integradora) usa o mesmo cofre em vez
de inventar o seu.

**Testes que fixam:** a chave nunca aparece em texto em coluna nenhuma; a cifra
de uma loja não abre com o `tenant_id` de outra; o `manager` usa e não cadastra;
nenhuma resposta da API contém a chave; chave-mestra errada falha alto, não em
silêncio. O `setup-e2e.ts` fixa uma chave-mestra de teste.

**Custo:** zero. Nenhum serviço novo.

## Por quê

É o mínimo que protege contra o vazamento mais provável — uma cópia do banco
(backup, dump, acesso indevido ao Supabase) — sem conta nova nem custo mensal,
e sem prender o AutoConnect a um fornecedor. Com a cifra no banco e a
chave-mestra no Railway, quem leva só um dos dois não leva nada.

## Descartado

- **Guardar em texto e confiar no RLS.** O RLS separa uma loja da outra dentro
  da aplicação; não protege contra quem tem o banco inteiro na mão.
- **Supabase Vault.** Cifra dentro do Postgres, mas quem tem acesso de
  administrador ao banco lê em texto, e o banco local dos testes não tem a
  extensão — o caminho da produção ficaria sem teste.
- **Serviço de chaves na nuvem (AWS KMS, Google KMS).** Mais forte, mas é conta
  nova e custo mensal — contra a decisão de não ter custo fixo antes de haver
  clientes. Revisitar quando houver dezenas de lojas usando.
- **Não guardar: a loja cola a chave a cada envio.** Seguro, mas inviável — é
  pedir ao gerente uma senha comprida a cada carro que entra ou sai.

## O que ainda depende da integradora

- Se a integradora tiver **conta de parceiro** (uma chave da plataforma, várias
  lojas pelo CNPJ), este cofre fica para depois e a chave volta para o `.env`.
  As perguntas enviadas em 14/10/2026 cobrem isso.
- Se o **webhook** também tiver segredo por loja (na IntegraRenave, cada cadastro
  de webhook tem o seu), ele entra no mesmo cofre, e a rota do webhook passa a
  identificar a loja pelo endereço.

## Onde está no código

- `apps/api/src/common/cofre/` — `cifra.ts` (AES-256-GCM e leitura das chaves),
  `cofre.service.ts` (guardar, situação, abrir, revogar) e o comando
  `scripts/recifrar-cofre.ts`.
- Migration `20261014202000_cofre_de_credenciais` — `credenciais_de_integracao`,
  com RLS por loja e CHECK de que linha inativa não guarda cifra.
- `apps/api/src/modules/renave/` — a chave da loja entra em cada chamada ao
  provedor; `POST /renave/credencial` (só `tenant_admin`) e
  `POST /renave/credencial/revogar`.
- `apps/web/src/components/renave/CredencialDaIntegradora.tsx`, em
  `/configuracoes`.
