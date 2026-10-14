---
tipo: plano
---

# Plano — fiscal: RENAVE e NF-e

Iniciado em 13/10/2026 ([decisão](../decisoes/2026-10-13%20fiscal%20renave%20e%20nfe.md)).
Reverte o adiamento da NF-e de 27/09/2026 e tira o RENAVE da lista de pendências
sem dono. As duas coisas andam juntas porque o lojista precisa que **estoque,
nota e RENAVE contem a mesma história**: mesmo veículo, mesmo valor, mesma data,
mesma natureza da operação. Feitas em sistemas separados, cada uma conta a sua.

## O que "fiscal" quer dizer aqui

O AutoConnect **prepara, envia e guarda**. Quem calcula tributo é o emissor e o
contador; quem fala com o RENAVE é a integradora credenciada. A mesma fronteira
do [financeiro](plano-financeiro.md), agora do outro lado: o gerencial responde
ao dono, o fiscal responde ao Estado — e para o Estado nós somos o lugar onde os
dados já estão, não o despachante.

| Entra | Fica fora (e por quê) |
|---|---|
| NF-e de **saída** (venda) a partir do negócio | Emissor próprio falando com a SEFAZ — regra estadual muda e é um produto inteiro |
| NF-e de **entrada** (compra de pessoa física, troca, consignação) a partir da aquisição | Cálculo de tributo e apuração — é do emissor e do contador |
| Perfil fiscal da loja (regime, CFOP e CST por operação), **confirmado pelo contador** | SPED, EFD, obrigações acessórias |
| XML e DANFE guardados no bucket privado, com hash | NFS-e, NFC-e e nota de serviço da oficina |
| Registro RENAVE de entrada, saída e consignação, **manual primeiro** | Virar integradora credenciada — credenciamento é por estado, com e-CNPJ e regulamento próprio |
| Envio ao RENAVE pela integradora da loja, por API | Transferência no Detran e gravame — quem registra é o Detran e a financeira |
| Conferência estoque × NF-e × RENAVE | |

## O calendário que manda (lido em 13/10/2026 — conferir o texto oficial)

A [Resolução Contran nº 1.026/2026](https://anautos.org.br/2026/07/02/contran-publica-resolucao-no-1-026-2026-e-torna-renave-obrigatorio-em-todo-o-brasil/)
tornou o RENAVE obrigatório para toda revenda, com adequação até **28/09/2026**,
já vencida. A [Circular nº 2/2026 da Senatran](https://www.fenauto.org.br/news/atencao-concessionarias-e-lojistas-de-veiculos)
escalonou a implantação:

| Quando | O quê |
|---|---|
| **09 a 20/10** | **A loja indica no RENAVE a integradora que vai usar.** Sem isso, fica impedida de operar nas etapas seguintes |
| 12 a 23/10 | Operação assistida — venda de veículo próprio |
| 15 a 30/10 | Operação assistida — consignados (módulo novo) |
| 30/10 a 10/11 | Operação assistida — intermediação financeira |
| 09 a 13/11 | Assinatura eletrônica, intenção e comunicação de venda integradas ao RENAVE |
| 16 a 20/11 | Transferência de propriedade integrada |
| a partir de 20/11 | Fiscalização |

**Consequência para o plano:** a obrigação é da loja, e ela vai cumpri-la com uma
integradora **que não somos nós**. Nosso trabalho nas próximas semanas não é
transmitir — é não deixar o lojista digitar duas vezes e mostrar o que está
faltando. Por isso o registro manual (R1) vem antes de qualquer integração, e
continua existindo depois dela para a loja cuja integradora não tem API.

Fontes de mercado (Fenauto, ANAUTOS, blogs de integradoras) concordam entre si,
mas são secundárias. **Conferir a Circular no DOU e o manual técnico do RENAVE
(SERPRO) é a primeira tarefa da sessão 2**, antes da migration.

## Seis regras que valem para o plano inteiro

1. **Camada neutra antes da conta.** `ProvedorDeNotaFiscal` e
   `ProvedorDeRenave`, cada um com um **simulado**, webhook autenticado sobre o
   corpo cru e idempotente por id de evento — como cobrança, assinatura e
   WhatsApp. O dia em que a conta chegar, só o adaptador é novidade.
2. **Documento autorizado é imutável.** Nota autorizada e registro RENAVE
   confirmado não mudam: corrige-se com o evento que a lei prevê (cancelamento,
   carta de correção, registro de estorno), e a linha original fica. Trigger no
   banco, como o contrato emitido.
3. **Snapshot, não join.** O que foi enviado é guardado como foi enviado —
   comprador, veículo, valores. Editar o cadastro depois não reescreve a nota.
4. **Um número, uma fonte.** Valor de venda vem do `Deal`, valor de compra da
   `VehicleAcquisition`, comprador do `DealBuyer`. A nota e o RENAVE apontam para
   essas linhas; não pedem o valor de novo numa tela própria.
5. **Tributo não é decidido no código.** CFOP, CST/CSOSN e texto de informações
   complementares vêm do perfil fiscal da loja, que nasce com **sugestões marcadas
   como não confirmadas** e só emite em produção depois que alguém da loja
   registra que o contador confirmou. O código monta; não opina.
6. **Fiscal é de gerência**, como o financeiro: `manager`, `tenant_admin` e super
   admin. O vendedor vê o estado ("nota autorizada", "falta registrar a saída"),
   não emite nem cancela.

---

## Fase 0 — decisão, verificação e o contrato comum ✅ 13/10/2026

- Decisão registrada: NF-e volta, RENAVE entra, nesta ordem de urgência.
- Calendário da Circular nº 2 levantado (acima), com a ressalva de conferir no DOU.
- **Contrato comum entre as trilhas:** `packages/shared/src/domain/chave-nfe.ts`
  — validação da chave de acesso de 44 dígitos (dígito verificador módulo 11) e
  leitura dos campos dela (UF, AAMM, CNPJ do emitente, modelo, série, número). É
  o único arquivo do shared que as duas trilhas usam; nasce antes da divisão para
  nenhuma das duas precisar escrever no da outra.

---

## Trilha R — RENAVE (sessão 2)

### R1 — registro manual e pendências *(urgente: entregar antes de 23/10)*

**Entrega:** o lojista registra no AutoConnect o protocolo que a integradora dele
devolveu, e o sistema mostra o que está faltando. É útil no dia seguinte ao
merge, com qualquer integradora, sem conta nenhuma.

- **Verificação primeiro:** manual técnico do RENAVE (SERPRO) e texto da Circular.
  O que confirmar: os tipos de operação, os campos obrigatórios de entrada e
  saída, se a saída exige a chave da NF-e, e se há prazo em dias para registrar a
  entrada. O que não for confirmado não vira regra dura — vira aviso.
- **`renave_registros`** (com `tenant_id` e policy): `vehicleId`, `dealId?`,
  `tipo` (entrada por compra, entrada por consignação, saída por venda, devolução
  de consignado, transferência entre estabelecimentos), `status`
  (`pendente | confirmado | recusado | estornado`), `protocolo?`,
  `registradoEm?`, `origem` (`manual | integradora`), `chaveNfe?` (validada por
  `chave-nfe.ts`), `valor` em `Decimal(14,2)`, `payload Json` cru da integradora,
  `createdBy`. Confirmado é imutável (trigger); o erro se corrige com estorno.
- **Regra pura no shared** (`domain/renave.ts`): `pendenciasRenave(veiculo,
  aquisicao, negocio, registros)` — veículo em estoque sem entrada confirmada,
  negócio faturado sem saída, consignado sem contrato. Mais
  `operacaoRenaveDaAquisicao(origem)`, que traduz o `AcquisitionOrigin` que já
  existe em tipo de entrada.
- **Telas:** um cartão "RENAVE" no veículo e no negócio (componente próprio,
  arquivo próprio) e uma lista "Pendências RENAVE" para a gerência. Veículo
  publicado sem entrada não é bloqueado — é avisado: travar a vitrine por um
  dado que talvez esteja certo na integradora seria punir a loja pela nossa
  ignorância.
- **Resposta honesta enquanto R2 não existe** — para o FAQ e o roteiro de venda:
  "o AutoConnect guarda os protocolos e avisa o que falta; o envio é pela sua
  integradora". A landing não é desta trilha: o texto vai como pedido no PR.

### R2 — camada neutra e simulado

- `ProvedorDeRenave` com `registrarEntrada`, `registrarSaida`, `estornar`,
  `consultar(protocolo)` e `interpretarWebhook(corpoCru, cabecalhos)`. A resposta
  pode vir por webhook **ou** por consulta — o desenho aceita os dois, porque não
  sabemos ainda qual a integradora escolhida oferece.
- Idempotência por `(vehicleId, tipo, sequência)`: o mesmo carro entra e sai
  mais de uma vez na vida (distrato, recompra), e o segundo clique não pode virar
  segundo registro.
- ATPV-e devolvido pela integradora vai para o bucket privado `documentos`, com
  URL assinada — é documento com CPF.
- `RENAVE_FORNECEDOR` (vazio = desligado, `simulado` recusado em produção) e o
  `setup-e2e.ts` forçando `simulado`, como as outras integrações.
- **Decisão desta fase:** credencial da loja na integradora é o **primeiro
  segredo por loja** guardado no banco — nenhum módulo faz isso hoje. Padrão que
  vou propor: preferir conta de parceiro da plataforma com subconta por CNPJ (o
  segredo fica no `.env`, um só); se a integradora só aceitar token por loja,
  cifrar com chave da plataforma e registrar a decisão antes do código.

### R3 — adaptador da integradora

- Escolher **uma** integradora com API REST pública e ambiente de homologação.
  Candidatas vistas em 13/10/2026: [IntegraRenave](https://integrarenave.com/),
  [Renave Fácil](https://renavefacil.net/), [WebRenave](https://www.webrenave.com.br/),
  [DataStock](https://datastock.com.br/). Critério: documentação aberta,
  homologação, cobertura de estados e modelo de cobrança (por requisição ou
  mensalidade — quem paga é a loja).
- Uma entrada e uma saída de ponta a ponta em homologação. A loja de outra
  integradora continua no R1, e isso é dito na tela, não escondido.

### R4 — consignação

- Entrada e devolução de consignado pelo RENAVE, e o **contrato de consignação
  assinado eletronicamente** que a regra passou a exigir — é o item 18 da Onda 4
  do [plano de paridade](plano-paridade-crm.md). Depende da Clicksign em produção
  e da revisão jurídica, e escreve em `contracts/`: **combinar com a sessão 1
  antes**, porque o template de contrato não é desta trilha.

---

## Trilha N — NF-e (sessão 1)

### N1 — perfil fiscal da loja e a montagem da nota ✅ 14/10/2026

**Entregue em 14/10/2026:** migration `perfil_fiscal` (três tabelas com RLS e
CHECKs de formato), `montarNota` e `faltasParaEmitir` no shared, módulo
`notas-fiscais` com perfil, operações, confirmação do contador, dados fiscais do
veículo e a **prévia da nota no negócio**, e a tela `/configuracoes/fiscal`. 48
testes no shared e 17 e2e — inclusive o que prova que mudar uma operação apaga
a confirmação do contador. Conferido no navegador: da prévia com faltas até a
nota completa, e o CFOP mudando de 5102 para 6102 quando o comprador de Minas
não retira na loja.

Decidido durante a fase, com o padrão adotado:

- **A prévia vai para o negócio já na N1**, sem botão de emitir: diz o que falta e,
  completa, mostra os dados para a loja usar no emissor que já tem. Rota sem
  tela seria a armadilha nº 1 do CLAUDE.md.
- **Venda presencial é interna** (CFOP 5) mesmo com comprador de outro estado; a
  prévia tem o interruptor "comprador retira na loja", ligado por padrão.
- **O dígito verificador do RENAVAM não é conferido** — o algoritmo circula em
  versões diferentes, e recusar um RENAVAM verdadeiro trava a nota de um carro
  que existe. Fica o tamanho (9 a 11 dígitos, completado com zeros).
- **CNPJ e IE continuam no `Tenant`, endereço na filial matriz** — copiar para o
  perfil fiscal criaria a segunda fonte de cada um.


**Entrega:** a loja diz como fatura, e o sistema sabe dizer, para um negócio
qualquer, se dá para emitir a nota — e o que falta, como a publicação de anúncio
já faz.

- **`fiscal_settings`** (uma por loja): regime tributário (Simples, Presumido,
  Real) e CRT, série, ambiente (`homologacao | producao`), e o carimbo
  `contadorConfirmouEm` / `contadorConfirmouPor`. CNPJ e IE já moram no `Tenant`;
  o endereço do emitente é o da filial matriz.
- **`fiscal_operation_profiles`** (por loja e tipo de operação): natureza da
  operação, CFOP dentro e fora do estado, CST ou CSOSN, e o texto de informações
  complementares. Nasce **semeado** com sugestões para revenda de usados — venda,
  compra de pessoa física, entrada de troca, entrada e devolução de consignado —
  marcadas "a confirmar pelo contador". Duas particularidades do setor entram
  como sugestão de texto, nunca como cálculo: a equiparação à consignação do
  art. 5º da Lei 9.716/98 e a base de cálculo reduzida do ICMS na saída de usado.
- **Regra pura no shared** (`domain/nota-fiscal.ts`): `montarNotaDeSaida` (do
  negócio, comprador e veículo) e `montarNotaDeEntrada` (da aquisição), devolvendo
  uma nota no **vocabulário do domínio**, não no do emissor; e `faltasParaEmitir`,
  que lista o que impede a emissão (CPF do comprador, NCM, endereço, perfil não
  confirmado em produção…). Tabela de casos em teste, inclusive centavos.
- **`vehicle_fiscal_details`** (uma por veículo): NCM e RENAVAM. A nota pede os
  dois e o `Vehicle` não tem nenhum; ficam numa tabela fiscal em vez de coluna
  nova em `vehicles`, para a trilha não mexer no módulo de estoque.
- **Tela** `/configuracoes/fiscal` (gerência): regime, série, perfis por operação,
  e o botão "o contador confirmou" com quem e quando. No veículo, um cartão
  "Dados fiscais" com NCM e RENAVAM.

### N2 — camada neutra, simulado e o ciclo de vida da nota ✅ 14/10/2026 (saída)

**Entregue em 14/10/2026, para a nota de saída do negócio:** migration
`emissao_de_nota` (notas e eventos com RLS, **índice único parcial de uma nota
viva por negócio**, CHECKs de coerência por estado e o trigger
`nota_autorizada_e_imutavel`), `aplicarRetorno` e `podeCancelar` puros no
shared, `ProvedorDeNotaFiscal` com o emissor **simulado** (gera chave de acesso
válida e entrega o webhook pelo caminho real), webhook autenticado por token em
tempo constante e idempotente por `(provider, eventKey)`, consulta,
cancelamento com justificativa, XML e DANFE no bucket privado com o hash do XML
conferido em todo download, e o cartão do negócio passando de prévia a
emissão. 9 testes de regra e 18 e2e. Conferido no navegador: emitir →
processando → autorizada (chave, número, protocolo) → cancelada → a prévia volta.

Decidido durante a fase, com o padrão adotado:

- **O banco grava antes de o emissor ouvir.** A nota nasce `processando` e só
  então o emissor é chamado, com o id dela como referência; se a chamada cair, a
  consulta resolve. O contrário seria nota autorizada que nenhuma tela mostra.
- **Perfil em produção com emissor de homologação é 409**: a nota sairia sem
  valor fiscal com o snapshot dizendo produção.
- **Cancelamento feito fora do AutoConnect** (painel do emissor) entra com a
  justificativa "Cancelada fora do AutoConnect", em vez de travar no CHECK.
- **Saiu da N2, com fase própria (N2b):** a nota de **entrada** e a **carta de
  correção** — ver abaixo.

### N2b — nota de entrada ✅ 14/10/2026

**Entregue em 14/10/2026:** migration `nota_de_entrada` — `acquisition_suppliers`
(quem entregou o veículo, com RLS) e a nota com **exatamente uma origem**
(negócio **ou** aquisição, `num_nonnulls = 1`) e uma nota de entrada viva por
aquisição; `entradaDaAquisicao` no shared; rotas de quem entregou, prévia e
emissão da entrada; e o cartão **Nota de entrada** no veículo, com o mesmo cartão
de nota da saída (`CartaoDaNotaFiscal`). 10 testes de regra e 10 e2e. Conferido
no navegador: o formulário abre com o nome que a aquisição tinha, salvar completa
a prévia (CFOP 1102, valor da compra), emitir → autorizada.

Decidido durante a fase, com o padrão adotado:

- **A tela da aquisição nunca pediu nome nem documento do fornecedor** (só
  origem, valor e data). Em vez de mexer nela, a trilha fiscal tem a sua
  qualificação de quem entregou — mesma razão do `DealBuyer` no contrato: o
  nome do papel pode diferir do cadastro rápido. Nasce com o que a aquisição
  tiver.
- **A loja só emite quando do outro lado não há quem emita:** pessoa física
  vendendo, trocando ou consignando. Fornecedor **pessoa jurídica** (inclusive
  CNPJ alfanumérico), **leilão**, **transferência** e **0 km** chegam com nota de
  outro emissor — o cartão diz de quem, em vez de oferecer o botão.
- **CNPJ alfanumérico na nota:** a montagem apagava as letras (`\D`) do CNPJ do
  emitente e do documento da contraparte. Corrigido aqui, com teste, depois do
  PR #24 (CNPJ alfanumérico no cadastro).
- **A carta de correção foi para a N3**: a numeração de sequência e o retorno
  são do emissor real, e simular sem ele seria inventar formato.


- **`fiscal_documents`**: `tipo` (entrada, saída), `status`
  (`processando | autorizada | rejeitada | denegada | cancelada`), número, série,
  chave, protocolo, motivo da rejeição, `snapshot Json` do que foi enviado,
  `dealId?` / `vehicleAcquisitionId?`, `xmlKey` e `danfeKey` no bucket privado,
  hash do XML, e `chaveDeIdempotencia` única — dois cliques em "emitir" não são
  duas notas. Autorizada é imutável por trigger.
- **`fiscal_document_events`**: cada retorno do emissor, cru, idempotente por
  `(provider, event_id)`, como a cobrança.
- `ProvedorDeNotaFiscal` com `emitir`, `consultar`, `cancelar`, `cartaDeCorrecao`
  e `interpretarWebhook`. O simulado autoriza, rejeita e denega conforme o caso de
  teste pede.
- **Emitir é ação, não efeito colateral.** A nota sai pelo botão no negócio a
  partir de `signed`; o módulo `deals` não muda de comportamento — nem a máquina
  de estados, nem a transição para `invoiced`. Ligar uma à outra é decisão para
  depois de a loja usar.
- Cancelamento dentro do prazo da SEFAZ (quem recusa fora do prazo é a SEFAZ; a
  tela avisa antes) e carta de correção. Motivo obrigatório nos dois.
- **Telas:** cartão "Nota fiscal" no negócio e na aquisição do veículo
  (componente próprio), com DANFE e XML por URL assinada, e uma lista de notas do
  mês em `/financeiro` ou `/relatorios`.

### N3 — certificado A1 e o adaptador do emissor

- Emissor terceiro, nunca SEFAZ direto. Padrão: [Focus NFe](https://focusnfe.com.br/guides/nfe/)
  (API REST, webhook, homologação, cadastro de empresa por API, e já cuida das
  mudanças de layout da reforma tributária). NFe.io e Tecnospeed são a
  alternativa se o preço por CNPJ não fechar.
- **Certificado A1 da loja:** sobe pela tela e é **repassado ao emissor na hora**,
  sem ser gravado por nós; fica só a validade, o CNPJ do titular e a impressão
  digital, para avisar antes de vencer. A senha do certificado não é logada nem
  persistida.
- `NFE_FORNECEDOR`, `FOCUS_NFE_TOKEN`, `FOCUS_NFE_API_URL` — mesmas regras das
  outras integrações: faltando uma, desligado com erro no log, boot não cai;
  `setup-e2e.ts` força `simulado`. Selo "homologação — sem valor fiscal" na tela
  enquanto o ambiente não for produção, pela mesma razão do selo de sandbox da
  cobrança.
- **Carta de correção (CC-e)**, com sequência e o texto de 15 a 1.000
  caracteres — veio da N2b, porque o formato é do emissor real.
- Uma nota de entrada e uma de saída autorizadas em homologação, e um
  cancelamento.

### N4 — a ponte com o contador ✅ 14/10/2026

**Entregue em 14/10/2026:** aba **Notas fiscais** em `/financeiro` — o mês, os
totais (saídas e entradas autorizadas, canceladas, o que pede ação) e a lista,
com link para o negócio ou o veículo de cada nota —, o **pacote do mês para o
contador** (`GET /fiscal/notas/pacote.zip`: o XML de cada nota autorizada ou
cancelada em `xml/saida/` e `xml/entrada/`, o índice `notas.csv` e um
`LEIA-ME.txt`), o índice avulso em CSV e a linha "Notas fiscais (índice)" em
*Levar seus dados*. 6 testes de regra, 8 de unidade (ZIP e período) e 5 e2e.
Conferido no navegador e com o `unzip` do sistema sobre o pacote que a API
gerou.

Decidido durante a fase, com o padrão adotado:

- **Nenhuma nota some do pacote em silêncio.** A que não tem XML (emissor fora,
  bucket vazio) ou cujo XML não confere com o hash da autorização vai para o
  LEIA-ME com o motivo e marcada no índice; o resto do pacote sai.
- **O período é o da autorização, em horário de Brasília**, com o fim
  exclusivo: nota autorizada às 22h de 31/10 é de outubro, e a autorizada em
  outubro e cancelada em novembro também — com o cancelamento no índice.
- **"Pede ação"**: nota processando, e rejeitada ou denegada **sem outra nota
  emitida depois na mesma origem** — a substituta pode ter saído no mês
  seguinte, então a regra olha todas as notas da origem, não só as do período.
- **ZIP sem dependência nova:** um gravador mínimo com o `zlib` do Node
  (`common/zip/zip.ts`), testado por leitura de volta. Nomes só em ASCII — há
  leitor de ZIP que ainda mostra acento como lixo.
- **Teto de 1.000 notas por período**, com 422 pedindo um período menor em vez
  de cortar: nota que falta no pacote é nota que o contador não escritura.

---

## Fase C — a mesma história (sessão 1, depois do merge das duas trilhas)

- **Conferência estoque × NF-e × RENAVE:** para cada veículo vendido no mês, nota
  de saída autorizada, saída RENAVE confirmada, e os dois com o mesmo valor e a
  mesma data do negócio. Divergência vira lista, não bloqueio.
- O registro RENAVE de saída passa a vir **pré-preenchido** com a chave da nota
  autorizada (leitura de `fiscal_documents`; a escrita continua na trilha R).

---

## Divisão entre sessões

A regra é a mesma de [divisão entre sessões](divisao-entre-sessoes.md): **dono
por módulo, não por fase**, e todas as regras gerais de lá valem aqui (branch e
PR, nunca push na `main`; portão verde antes do push; as duas variáveis do banco
de teste exportadas; nada de produção sem pedir). Vale dividir porque as duas
trilhas são integrações independentes com **um** ponto de contato — a chave da
NF-e — e esse ponto já foi resolvido na Fase 0.

| | Sessão 1 — NF-e | Sessão 2 — RENAVE |
|---|---|---|
| Fases | N1 → N4, depois Fase C | R1 → R4 |
| Módulo da API | `modules/notas-fiscais/` | `modules/renave/` |
| Shared | `domain/nota-fiscal.ts` | `domain/renave.ts` |
| Telas | `configuracoes/fiscal/`, `components/fiscal/NotaFiscal*.tsx` | `components/renave/*.tsx`, lista de pendências |
| Migrations | carimbo `AAAAMMDD10…` | carimbo `AAAAMMDD20…` |
| Branch | `claude/fiscal-s1-<assunto>` | `claude/fiscal-s2-<assunto>` |

**Pontos de contato, e como cada um se resolve:**

- `packages/shared/src/domain/chave-nfe.ts` — **ninguém edita**; precisou mudar,
  pede no PR.
- **Quem entregou o veículo** — mora em `acquisition_suppliers`, da sessão 1
  (N2b): nome, CPF/CNPJ e endereço de quem vendeu, trocou ou consignou. É o
  vendedor que o RENAVE pede na entrada do estoque — a sessão 2 **lê** daqui.
- **RENAVAM do veículo** — mora em `vehicle_fiscal_details`, da sessão 1 (N1). A
  sessão 2 **lê**; se precisar antes de N1 chegar à `main`, pede no PR em vez de
  criar coluna própria — dois RENAVAM para o mesmo carro é o começo da história
  que não bate.
- `negocios/[id]` e `veiculos/[id]` — cada sessão cria o **seu** componente e
  acrescenta **uma linha** na página para montá-lo. É o único arquivo de tela
  escrito pelas duas; o conflito, se houver, é de uma linha.
- `schema.prisma` — modelo novo no fim do arquivo, no próprio bloco; as relações
  no `model Tenant` (`vehicles`, `deals`) são linhas novas, nunca edição das que
  existem.
- `setup-e2e.ts` e `.env.example` — cada sessão acrescenta as suas variáveis em
  bloco próprio.
- `deals`, `contracts`, `financeiro`, `vehicles` — **nenhuma das duas altera
  comportamento** desses módulos. R4 (contrato de consignação) e N4 (exportação do
  financeiro) escrevem neles: R4 combina antes; N4 é da sessão 1.
- `CLAUDE.md` — cada sessão acrescenta **uma seção própria no fim**, no último
  commit da fase, e a contagem de testes é atualizada depois do merge.

### Prompt para abrir a sessão 2

> Você é a **sessão 2** do plano fiscal. Leia `docs/planos/plano-fiscal-renave-nfe.md`
> e `docs/planos/divisao-entre-sessoes.md` antes de qualquer coisa. O plano está
> na branch `claude/plano-fiscal-renave-nfe-3244ff` — se ainda não estiver na
> `main`, faça merge dela na sua branch primeiro (os worktrees compartilham o
> repositório, não precisa de push).
>
> Sua parte é a **trilha R — RENAVE**, começando por **R1** (registro manual e
> pendências), que é urgente: a operação assistida da venda de veículo próprio
> vai de 12 a 23/10/2026. Antes da migration, confira no manual técnico do RENAVE
> (SERPRO) e no texto da Circular nº 2/2026 os tipos de operação e os campos
> obrigatórios; o que não for confirmado vira aviso, não regra dura.
>
> Respeite a tabela "Divisão entre sessões" do plano: você escreve em
> `modules/renave/`, `domain/renave.ts` e `components/renave/`; migrations com
> carimbo `AAAAMMDD20…`; não edite `chave-nfe.ts` nem os módulos `deals`,
> `contracts`, `financeiro` e `notas-fiscais`. Branch `claude/fiscal-s2-<assunto>`,
> PR, e `pnpm exec turbo run typecheck lint test` verde antes de cada push.

---

## Decisões em aberto, com o padrão que vou adotar se você não disser outra coisa

1. **Quem paga o emissor de NF-e.** Padrão: o AutoConnect contrata um emissor
   (conta de parceiro, várias empresas por API) e a NF-e entra em todos os
   planos; o custo por CNPJ é revisto na primeira fatura do emissor. Mudar preço
   ou faixa é em `CATALOGO_DE_PLANOS`, numa decisão própria — não neste plano.
2. **Quem paga o RENAVE.** Padrão: a loja contrata a integradora (a obrigação e a
   indicação no RENAVE são dela); o AutoConnect conecta. Não revendemos
   requisição.
3. **Emitir nota no modo somente leitura.** Padrão: bloqueado, como toda escrita
   — o `SomenteLeituraGuard` não ganha exceção nova sem motivo forte. Revisar se
   aparecer o caso "vendi ontem, fui bloqueado hoje, preciso faturar".
4. **Nota de entrada de compra de pessoa física.** Padrão: entra logo depois da
   de saída, na N2b — é ela que documenta o carro que a loja comprou de um
   particular, e sem ela a conferência da Fase C fica pela metade. Saiu da N2
   porque a aquisição não guarda o endereço do fornecedor.

## O que teste não cobre

- **Revisão do contador** dos perfis por operação, antes da primeira nota em
  produção. É a mesma revisão pendente do financeiro, e entra junto.
- **Texto oficial** da Resolução 1.026, da Circular nº 2 e do manual do RENAVE,
  conferido por quem implementa R1, com a data da leitura no PR.
- **Uma loja real** emitindo uma nota e registrando uma saída, olhando.

## Onde o plano está

| Fase | Sessão | Estado |
|---|---|---|
| 0 — decisão, verificação, `chave-nfe.ts` | 1 | ✅ 13/10/2026 |
| R1 — registro manual e pendências | 2 | ⬜ |
| R2 — camada neutra RENAVE | 2 | ⬜ |
| R3 — adaptador da integradora | 2 | ⬜ (depende da escolha da integradora) |
| R4 — consignação | 2 | ⬜ (depende da Clicksign em produção e do advogado) |
| N1 — perfil fiscal e montagem | 1 | ✅ 14/10/2026 |
| N2 — camada neutra NF-e (saída) | 1 | ✅ 14/10/2026 |
| N2b — nota de entrada | 1 | ✅ 14/10/2026 |
| N3 — certificado, adaptador do emissor e carta de correção | 1 | ⬜ (depende da conta no emissor) |
| N4 — ponte com o contador | 1 | ✅ 14/10/2026 |
| C — a mesma história | 1 | ⬜ (depois de R2 e N2) |
