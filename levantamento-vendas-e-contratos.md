# AutoConnect — Levantamento: Vendas, Contratos, Financiamento e Documentação

> **Escopo:** pesquisa de domínio. Nenhuma linha de código do projeto foi alterada por este documento.
> **Data:** setembro/2026 · **Foco:** seminovos e usados (loja multimarcas), extensível para concessionária de marca.
> **Aviso:** não substitui parecer jurídico ou contábil.

Documento companheiro: [`plano-implementacao-vendas.md`](./plano-implementacao-vendas.md) — o *como* construir.

---

## 1. O que o AutoConnect é hoje

Lendo `packages/db/prisma/schema.prisma`, `docs/features.md` e `CLAUDE.md`: o AutoConnect é um **SaaS multi-tenant de aquisição e relacionamento**. Ele resolve o ciclo *cliente vê veículo → fala com vendedor → agenda test drive → lead vira "ganho"*. E aí ele para.

O modelo `Lead` termina em `won` com um `wonAt`. Não existe entidade que represente **o negócio em si**: qual foi o valor fechado, como o cliente pagou, qual contrato foi assinado, quanto o veículo custou para a loja, qual foi a margem, quem assinou, quando o carro foi entregue. Um lead "ganho" é uma flag, não uma venda.

Três coisas já existentes são embriões da parte de baixo e devem ser aproveitadas em vez de reescritas:

- **Proposta comercial pelo chat** (valor, condições, validade, aceite/recusa do cliente) — embrião de proposta.
- **Trade-in com consulta FIPE e avaliação do vendedor** — embrião de avaliação de entrada.
- **Histórico de preço com autoria** (`VehicleHistory`, evento `price_change`) — embrião de trilha de auditoria comercial e do conceito de snapshot.

### A esteira completa de uma loja de veículos

| # | Etapa | Estado no AutoConnect |
|---|---|---|
| 01 | Captação do lead | já existe |
| 02 | Atendimento e test drive | já existe |
| 03 | Proposta e negociação | parcial (só no chat) |
| 04 | Contrato e assinatura | não existe |
| 05 | Crédito e F&I | não existe |
| 06 | Faturamento (NF-e) | não existe |
| 07 | Documentação e transferência | não existe |
| 08 | Entrega e pós-venda | não existe |

E há uma esteira anterior a essa, invisível no produto atual: **como o carro entrou no estoque**. Hoje o vendedor cria um `Vehicle` preenchendo um formulário. Na vida real, antes de o carro aparecer na vitrine, ele foi comprado de alguém, passou por laudo cautelar, teve dez consultas feitas, custou dinheiro em preparação e — desde 2026 — precisa ter entrada registrada eletronicamente no RENAVE.

---

## 2. Entrada do veículo no estoque

É aqui que a loja assume risco. Um carro com chassi remarcado, sinistro de perda total ou gravame ativo comprado sem checagem vira prejuízo direto e processo do consumidor depois.

### 2.1 Origens possíveis

Cada origem tem documentação e fluxo financeiro diferentes, e o CRM precisa saber qual foi:

- **Compra direta** de pessoa física ou jurídica — a loja paga e o carro entra como propriedade dela.
- **Troca (trade-in)** — o carro do cliente abate no valor do carro desejado. *(já existe parcialmente)*
- **Consignação** — o carro fica na loja mas continua do dono; a loja só recebe comissão. Exige contrato de consignação próprio, e desde a Resolução 1.026/2026 esses contratos passam a ser exigidos em formato eletrônico com assinatura digital.
- **Repasse** entre lojas.
- **Leilão** — carro com histórico de leilão precisa ser declarado ao comprador final.
- **Montadora / 0 km** — fluxo distinto, com RENAVE 0 km.

### 2.2 Laudo cautelar e vistoria — são coisas diferentes

| | Vistoria cautelar (ECV) | Vistoria de transferência |
|---|---|---|
| **Quando** | Antes de comprar | Depois de vender |
| **Obrigatória?** | Não, mas é o padrão de diligência do mercado | Sim, para mudar a titularidade |
| **O que faz** | Confere numeração de chassi, motor, câmbio e etiquetas; integridade estrutural (longarinas, colunas, teto, painéis); originalidade das peças; cruza com registros de roubo/furto, leilão, sinistro e restrições | Vistoria que o Detran exige no processo de transferência; não avalia procedência comercial |

### 2.3 Consultas que precedem a compra

Todas consultáveis por placa/chassi via APIs comerciais (Consultar Placa, Infosimples, Olho no Carro, Checktudo, API Full e afins). Um CRM sério guarda o **resultado datado** de cada uma, porque é a prova da diligência da loja se der problema depois.

| Consulta | O que impede | Peso |
|---|---|---|
| Débitos (IPVA, multas, licenciamento) | Transferência travada; passivo assumido pela loja | Bloqueante |
| Gravame / alienação fiduciária | Carro ainda pertence ao banco; não se transfere sem baixa | Bloqueante |
| Restrição judicial, administrativa ou tributária | Penhora, bloqueio, ação em curso | Bloqueante |
| Roubo e furto (base nacional) | Receptação; apreensão | Bloqueante |
| Sinistro / perda total (indenização paga) | Valor real muito abaixo da FIPE; vício oculto | Alto |
| Histórico de leilão | Depreciação e dever de informar o comprador | Alto |
| Recall pendente | Responsabilidade sobre segurança | Médio |
| Histórico de proprietários e quilometragem | Adulteração de hodômetro | Médio |
| Referência FIPE | Precificação e margem | *já existe* |

### 2.4 RENAVE — mudança regulatória em curso

**Resolução CONTRAN nº 1.026/2026.** Publicada em 30/06/2026, com prazo de adequação até **28/09/2026**. O RENAVE deixa de ser fragmentado por estado e vira base nacional coordenada pela Senatran, alcançando também usados e seminovos.

Na prática, a loja passa a registrar eletronicamente:

- **ENE** — entrada de veículo no estoque
- **SNE** — saída de veículo do estoque

Substituindo o livro físico de registro. Estoque físico, sistema de gestão, NF-e e RENAVE precisam **contar a mesma história** — mesmos valores, datas e natureza da operação.

Requisitos para a loja: CNAE compatível, e-CNPJ com certificado ICP-Brasil, credenciamento via integradora (plataforma Credencia / Serpro).

Sem registro no RENAVE, a venda financiada não avança, porque o gravame depende dele. Penalidades incluem infração gravíssima e suspensão do credenciamento.

> ⚠️ **Confirmar prazos direto na Senatran antes de virar requisito.** A data é recente e as fontes deste levantamento são secundárias.

### 2.5 Custo de entrada e formação de margem

O preço que o cliente vê não é o número que importa para a loja. O que importa é:

```
custo total = preço de compra + preparação + documentação + custo de estoque parado
```

A preparação (higienização, funilaria, mecânica, pneus, polimento) é lançada por item, com fornecedor e nota. Sem isso não existe DRE por veículo, e sem DRE por veículo o dono da loja não consegue responder a pergunta que ele mais faz: **"esse carro deu lucro?"**

**Tempo de giro** (dias em estoque desde o ENE) é métrica de primeira classe — é o KPI que o gestor de loja de usados acompanha diariamente, mais do que volume de leads.

---

## 3. Proposta, contrato e garantia

### 3.1 A cadeia documental de uma venda

Entre "cliente aceitou" e "carro saiu da loja" existem, tipicamente, seis documentos:

1. **Proposta comercial** — valor, forma de pagamento, validade. Não vincula.
2. **Recibo de sinal / reserva** — define o que acontece se o cliente desistir.
3. **Contrato de compra e venda** — o documento central.
4. **Termo de avaliação do usado**, quando há troca.
5. **Nota fiscal de venda (NF-e)**.
6. **Termo de entrega / checklist** — assinado no ato: estado do veículo, itens entregues (chave reserva, manual, macaco, triângulo), quilometragem, nível de combustível.

### 3.2 Cláusulas essenciais do contrato

| Bloco | Conteúdo |
|---|---|
| Partes | Nome/razão social, CPF/CNPJ, RG, endereço, contato — vendedor e comprador |
| Objeto | Marca, modelo, versão, ano fab./modelo, cor, placa, chassi, Renavam, quilometragem, nº do motor |
| Preço e pagamento | Valor por extenso e em algarismos, forma (à vista, financiado, troca, misto), datas, entrada, parcelas |
| Estado de conservação | Descrição do estado e, idealmente, laudo cautelar anexado como parte integrante |
| Débitos e pendências | Quem responde por IPVA, multas e licenciamento antes e depois da tradição |
| Transferência | Prazo, responsabilidade pelos custos, documentos que cada parte entrega |
| Garantia | Prazo, cobertura, exclusões, onde o reparo é feito |
| Rescisão e penalidade | Multa por descumprimento (usualmente 10–20%), desistência, devolução de sinal |
| Foro e assinaturas | Comarca eleita, data, partes e testemunhas |

### 3.3 ⚠️ Armadilha jurídica clássica — garantia

A cláusula *"garantia de 3 meses apenas para motor e câmbio"* — praticamente padrão no varejo de usados — **não se sustenta**.

- **CDC art. 26, II**: 90 dias de garantia legal para bens duráveis, novos ou usados, contados da entrega, cobrindo o veículo inteiro: elétrica, suspensão, freios, direção, ar-condicionado.
- **CDC art. 51, I**: cláusula que reduz esse direito é nula.
- A garantia contratual da loja **soma** à legal, não a substitui.
- Vício no prazo: o fornecedor tem 30 dias para sanar; passando disso o consumidor pode exigir troca, abatimento ou restituição.

**Consequência para o produto:** o gerador de contratos **não deve** oferecer template com essa cláusula. Deve modelar "garantia legal (90 dias, automática)" separada de "garantia contratual (opcional, aditiva)". Isso é diferencial de confiança, não limitação.

### 3.4 Assinatura eletrônica

Contrato de compra e venda de veículo não exige cartório nem firma reconhecida para valer entre as partes. Amparo: **MP 2.200-2/2001** e **Lei 14.063/2020**.

- **Qualificada** (certificado ICP-Brasil) — a mais forte.
- **Avançada**, com trilha de auditoria (data, hora, IP, geolocalização, hash do documento, evidência de identificação) — o que as plataformas de mercado entregam e é aceita para esse tipo de contrato.

Mínimo viável para o AutoConnect: **gerar o PDF a partir de template, calcular o hash, coletar o aceite com trilha de evidências e arquivar imutável**. Integrar com provedor externo (Clicksign, D4Sign, ZapSign, Autentique, Docusign) vem depois e é troca de implementação, não de arquitetura.

---

## 4. Financiamento e F&I

Em loja madura, o F&I (*Finance & Insurance*) chega a gerar tanto lucro quanto a venda do carro. É a parte de maior valor comercial de um CRM automotivo, e a que mais depende de integração externa.

### 4.1 Modalidades de pagamento

| Modalidade | Como funciona | Impacto no sistema |
|---|---|---|
| **À vista** | PIX, TED, dinheiro | Atenção ao COAF se houver espécie |
| **CDC com alienação fiduciária** | Banco financia; veículo alienado até a quitação. Padrão do mercado. | Gravame, registro de contrato, liberação do recurso |
| **Arrendamento (leasing)** | Bem permanece do arrendador; cliente paga contraprestações | Registro de natureza distinta |
| **Consórcio** | Carta contemplada usada como pagamento | Prazo de liberação da administradora; carro alienado a ela |
| **Troca + diferença** | Usado abate; o resto à vista ou financiado | Dois veículos no mesmo negócio, um saindo e um entrando |
| **Misto** | Entrada + troca + financiamento do saldo | **O caso mais comum na prática.** O modelo de dados precisa suportar *n* formas de pagamento por negócio. |

### 4.2 O fluxo do crédito, ponta a ponta

```
ficha cadastral → análise de crédito → simulação multibanco → proposta enviada
  → aprovada → formalização → gravame (SNG) → registro no Detran → recurso liberado
```

A **simulação multibanco** é o coração comercial: o vendedor digita os dados do cliente e do veículo uma vez, o sistema dispara para várias financeiras em paralelo via API e devolve as aprovações lado a lado, com taxa, prazo e parcela. Plataformas especializadas (FANDI, Autoconf e similares) já fazem isso com 30+ instituições. Integrar com uma delas é ordens de magnitude mais viável do que homologar banco a banco.

### 4.3 Gravame e registro de contrato

Depois da aprovação, a financeira registra o gravame no **SNG — Sistema Nacional de Gravames**, operado pela B3: envia chassi, placa, Renavam, CPF/CNPJ do devedor e dados do contrato. O veículo fica com restrição financeira enquanto o contrato estiver ativo. Quitado, a instituição tem prazo curto — na ordem de 10 dias úteis — para dar baixa. Integração por webservice certificado com ICP-Brasil, ou via hub integrador.

> **Escopo:** quem registra gravame é a financeira, não a loja. O CRM **não** precisa integrar com o SNG. O que ele precisa é *saber o estado*: gravame incluído? contrato registrado? recurso liberado? Essa visibilidade é o que o vendedor pede o dia inteiro por telefone hoje.

### 4.4 Custos e receitas que o sistema precisa calcular

**Sai do cliente — custos do financiamento:** tarifa de cadastro, tarifa de avaliação do bem, registro do contrato, IOF, seguro prestamista. Tudo entra no CET e infla a parcela. O simulador atual do AutoConnect (Price com taxa fixa de referência) é estimativa de vitrine, não proposta.

**Entra na loja — receita de F&I:** taxa de retorno paga pelo banco, comissão de seguro auto, garantia estendida, seguro de proteção financeira, rastreador, vitrificação, serviço de despachante. Cada produto tem comissão própria e entra no cálculo de margem do negócio e na comissão do vendedor.

> ⚠️ **Venda casada é proibida.** O sistema pode *oferecer* produtos F&I, mas nunca condicioná-los à aprovação do crédito, nem no texto nem no fluxo da tela. Registrar o aceite de cada produto separadamente, com evidência.

---

## 5. Faturamento, documentação e entrega

### 5.1 Nota fiscal e regime tributário

A venda é faturada em NF-e. Particularidade do setor: pelo **art. 5º da Lei 9.716/98**, a revenda de veículos usados adquiridos para revenda é equiparada a operação de consignação para fins de apuração — a base tributável é, em regra, a **diferença entre o preço de venda e o de compra**, não o preço cheio. Isso muda drasticamente o IRPJ/CSLL no lucro presumido.

Não é papel do CRM calcular tributo, mas **é** papel dele guardar preço de compra e preço de venda vinculados ao mesmo veículo, porque é isso que o contador precisa. Qualquer decisão fiscal, validar com contador.

### 5.2 Transferência de titularidade

Com o RENAVE, a saída de estoque (SNE) torna o processo digital: o ATPV-e é emitido eletronicamente e o comprador conclui a transferência pelo aplicativo do Detran, sem cartório.

| Obrigação | Prazo | Quem | Se não fizer |
|---|---|---|---|
| Comunicação de venda | 30 dias | Vendedor | Multa (infração grave, art. 233 CTB) e responsabilidade solidária por multas posteriores |
| Expedição do novo CRV | 30 dias | Comprador | Multa e pendência no veículo |
| Registro RENAVE de entrada (ENE) | imediato à compra | Loja | Infração e risco de descredenciamento |
| Registro RENAVE de saída (SNE) | na venda | Loja | Trava a transferência e o gravame |

Documentos que circulam: **CRV/CRV-e** (propriedade), **CRLV-e** (licenciamento do ano), **ATPV-e** (autorização de transferência), laudo de vistoria, certidão negativa de débitos, NF-e.

### 5.3 Entrega

Evento operacional com data marcada, responsável e checklist — exatamente o formato de um `Appointment`. E o enum `AppointmentType` do projeto **já tem** `delivery`. É a menor distância entre o que existe e o que falta.

---

## 6. Compliance

### 6.1 COAF — prevenção à lavagem de dinheiro

Comerciantes de bens de alto valor, incluindo veículos, são pessoas obrigadas pela Lei 9.613/98. A **Resolução COAF 25/2013** fixa os deveres operacionais:

- Cadastro no COAF
- Identificação e cadastro do cliente
- **Registro de toda operação a partir de R$ 10.000** com descrição do bem, valor, data, forma e meio de pagamento
- **Comunicação de operações em espécie que somem R$ 30.000 em seis meses**
- Comunicação de operações suspeitas
- Guarda dos registros por **no mínimo 5 anos**

> Confirmar se houve atualização normativa recente antes de implementar os limites.

**Como isso vira produto:** um alerta automático quando o meio de pagamento é espécie e o acumulado do CPF no período cruza o limite, mais um relatório exportável no formato que o COAF pede. É uma feature que **nenhuma loja pequena tem** e que o contador delas vai adorar. Baixo custo de implementação, alto valor percebido.

### 6.2 LGPD

O AutoConnect já trata dado pessoal em volume (CPF, endereço, telefone, localização do cliente, GalaxyMap). Com contrato e crédito entram documentos de identidade, comprovante de renda e consulta de score.

- **Base legal:** consulta de crédito e cadastro em financeira apoiam-se em execução de contrato/procedimentos preliminares e legítimo interesse — não em consentimento genérico. Registrar *qual* base legal foi usada em *qual* operação.
- **Minimização:** não guardar imagem de documento além do necessário; considerar hash/últimos dígitos em vez do número completo onde der.
- **Retenção:** conflito real entre "excluir a pedido do titular" e "guardar 5 anos por exigência do COAF" e prazos fiscais. Documentar a política.
- **Trilha:** o `AuditLog` já existe no schema e é o lugar certo para registrar quem acessou dado de cliente.
- **Multi-tenant:** cada concessionária é controladora dos seus dados; o AutoConnect é operador. Isso muda o contrato de SaaS a assinar com elas.

### 6.3 CDC

Além da garantia já tratada: dever de informar vícios conhecidos (leilão, sinistro, quilometragem), vinculação da publicidade ao anúncio veiculado, e direito de arrependimento em 7 dias quando a compra ocorre fora do estabelecimento — relevante justamente porque o AutoConnect vende *online*. Um anúncio com preço errado publicado na página pública vincula a loja.

---

## 7. Como o CRM deve implementar

Recomendação central: introduzir uma entidade de **Negócio** (`Deal`) como agregado da venda. O `Lead` continua sendo o funil de atendimento; o `Deal` passa a ser o objeto de negócio, e é a ele que contrato, pagamentos, financiamento, F&I, documentos e margem se penduram.

### 7.1 Máquina de estados do negócio

```
rascunho → proposta → negociação → aguardando crédito → contrato emitido
  → assinado → faturado → documentação → entregue
                                          · cancelado · distratado
```

Cada transição grava autor, timestamp e motivo — o padrão que o projeto já usa em `LeadInteraction` e `VehicleHistory`. Não inventar mecanismo novo.

### 7.2 Modelagem de dados sugerida

Nomes em português onde o domínio é brasileiro e não tem tradução boa (`gravame`, `renave`), inglês no resto, seguindo o padrão do schema atual. Todas com `tenantId` e `@@index([tenantId])`.

| Tabela | Papel | Campos-chave |
|---|---|---|
| `deals` | Agregado da venda | leadId, vehicleId, customerUserId, salespersonId, status, valorVenda, descontos, custoTotal, margem, closedAt |
| `deal_payments` | Composição do pagamento (*n* por deal) | tipo (à vista, entrada, troca, financiamento, consórcio), valor, status, dataPrevista |
| `trade_ins` | Usado recebido na troca | dealId, dados do veículo, fipeRef, valorAvaliado, valorAceito, vehicleIdGerado |
| `finance_proposals` | Proposta enviada a cada financeira | dealId, instituição, valorFinanciado, entrada, prazo, taxaAM, cet, parcela, status, protocoloExterno |
| `finance_contracts` | Contrato aprovado e formalizado | proposalId, numeroContrato, gravameStatus, registroDetranStatus, dataLiberacao, valorLiberado |
| `fni_products` / `deal_fni_items` | Catálogo e venda de seguros, garantia estendida, rastreador | nome, fornecedor, valorVenda, custo, comissãoPct, aceiteEm |
| `contract_templates` | Modelo versionado por tenant | tipo, versão, corpo com placeholders, ativo |
| `contracts` | Documento gerado e imutável | dealId, templateVersion, snapshotDados (Json), pdfUrl, hashSha256, status |
| `contract_signatures` | Evidência de assinatura | contractId, signatário, papel, método, ip, userAgent, geo, assinadoEm, providerId |
| `vehicle_acquisitions` | Como o carro entrou | vehicleId, origem, fornecedor (CPF/CNPJ), valorCompra, dataEntrada, nfeEntrada |
| `vehicle_costs` | Preparação e despesas | vehicleId, categoria, descrição, valor, fornecedor, data |
| `vehicle_inspections` | Laudo cautelar / vistoria | vehicleId, tipo, empresa, dataLaudo, aprovado, apontamentos, arquivoUrl |
| `vehicle_queries` | Consultas por placa/chassi, com resultado datado | vehicleId, tipo, provedor, consultadoEm, resultado (Json), possuiRestricao |
| `renave_events` | ENE / SNE e protocolos | vehicleId, evento, protocolo, status, payload, respondidoEm |
| `documents` | Arquivos do negócio e do veículo | ownerType, ownerId, tipo (CRV, CRLV, ATPV-e, CNH, comprovante), url, validade |
| `commissions` | Comissão por venda e por produto F&I | dealId, userId, base, percentual, valor, status de pagamento |
| `compliance_flags` | Alertas COAF e afins | dealId, tipo, limiar, valorAcumulado, status, comunicadoEm |

### 7.3 Geração de contrato — três regras

Valem mais do que a escolha da biblioteca de PDF:

1. **Template versionado por tenant.** Cada concessionária tem o contrato do advogado dela. Placeholders resolvidos no momento da geração.
2. **Snapshot, não join.** O contrato guarda uma cópia congelada dos dados no instante da emissão. Se o preço do veículo mudar depois, o contrato assinado não muda junto.
3. **Hash do PDF.** SHA-256 gravado na emissão. Prova que o documento não foi alterado, e é a base de qualquer integração futura de assinatura.

### 7.4 Onde encaixa no que já existe

| Reaproveitar | Como |
|---|---|
| Proposta do chat | Vira a origem do `Deal`. O aceite do cliente no card já é um evento de transição de estado. |
| Trade-in | O fluxo com FIPE e avaliação já existe em `Lead.metadata`. Promover a tabela própria e ligar ao deal. |
| `AppointmentType.delivery` | Entrega já é tipo de agendamento válido. Falta só o checklist e o termo assinado. |
| `AuditLog` e `SalesGoal` | Auditoria e metas já existem. Meta hoje conta "leads ganhos"; com o deal passa a contar valor vendido e margem. |

> ⚠️ **Restrição do projeto:** o `CLAUDE.md` é explícito — **nunca `prisma db push`**, sempre `prisma migrate dev`. E como o RLS está ativado sem policies, qualquer tabela nova precisa nascer com a mesma configuração das existentes. Ver `plano-implementacao-vendas.md` §1, que trata disso a fundo.

### 7.5 Integrações, por ordem de custo-benefício

| Integração | Ganho | Dificuldade |
|---|---|---|
| Consulta veicular por placa/chassi (API comercial) | Diligência na compra; selo de procedência no anúncio | Baixa — REST + chave |
| Assinatura eletrônica (Clicksign, ZapSign, D4Sign…) | Fecha venda sem cliente ir à loja | Baixa |
| FIPE | Precificação | *já feito* |
| WhatsApp oficial (Cloud API / BSP) | É o canal real do vendedor brasileiro | Média |
| Simulação multibanco (FANDI, Autoconf ou equivalente) | O maior diferencial comercial da lista | Média — contrato comercial + homologação |
| Portais de anúncio (Webmotors, OLX, iCarros, SóCarrão) | Distribuição do estoque; é o que a loja mais pede | Média |
| NF-e | Fecha o ciclo fiscal | Alta — regras estaduais |
| RENAVE via integradora credenciada | Obrigação legal a partir de 2026 | Alta — credenciamento, ICP-Brasil, homologação |

---

## 8. Ordem sugerida

Cada fase é vendável sozinha, e nenhuma depende de contrato comercial com terceiro antes de precisar.

**Fase 1 — Fechar o ciclo sem integração nenhuma**
`deals`, `deal_payments`, `trade_ins`, `vehicle_acquisitions`, `vehicle_costs`; tela de fechamento com pagamento composto, desconto e margem; DRE por veículo e por negócio; giro de estoque em dias; metas e comissão por valor e margem.

**Fase 2 — Contrato gerado no sistema**
`contract_templates` por tenant; geração de PDF com snapshot + hash; garantia legal e contratual modeladas separadamente; upload manual de laudo, CRV, CNH e comprovantes; termo de entrega com checklist.

**Fase 3 — Assinatura eletrônica e consulta veicular**
Provedor de assinatura + `contract_signatures` com trilha completa; API de consulta por placa; selo de procedência na página pública.

**Fase 4 — Crédito e F&I**
Ficha cadastral digital por link; integração multibanco com propostas comparadas; acompanhamento de gravame/registro/liberação (só leitura); catálogo de produtos F&I com comissão e aceite individual.

**Fase 5 — Obrigações fiscais e regulatórias**
Alertas e relatório COAF; NF-e de entrada e saída; RENAVE ENE/SNE via integradora credenciada.

---

## 9. Decisões em aberto

1. **Concessionária de marca ou loja de multimarcas?** São produtos diferentes. Concessionária de marca tem oficina, peças, garantia de fábrica, metas de montadora e quase sempre já usa um DMS pesado. Loja de seminovos independente é um mercado maior, mais desatendido e onde o AutoConnect entra melhor. O nome sugere a primeira, o schema e as features sugerem a segunda.
   *(Decidido: multimarcas primeiro, modelagem preparada para receber oficina/peças depois.)*

2. **Até onde ir no financeiro?** DRE por veículo é caminho curto e alto valor. Contas a pagar/receber, conciliação bancária e fiscal completo é virar ERP e disputar com TOTVS e CIGAM. Recomendação: parar no DRE por veículo e comissão.

3. **O contrato é gerado ou é integrado?** Gerar dentro do sistema dá controle e diferencial, mas cria responsabilidade sobre o texto jurídico. Saída: template padrão revisado por advogado + liberdade do tenant editar o dele, com o AutoConnect isento no termo de uso.

4. **RENAVE agora ou depois?** Vira obrigação legal com prazo em setembro de 2026. Se o cliente-piloto for loja formal, deixa de ser feature e vira requisito de compra.

5. **Confirmar nas fontes primárias** antes de virar requisito: a Resolução 1.026/2026 e seus prazos na Senatran, e os limites da norma COAF vigente.

---

## 10. Fontes

- [Resolução CONTRAN 1.026/2026 e o prazo de 28/09/2026 — Renavix](https://www.renavix.com.br/resolucao-1026)
- [O que é RENAVE — Revenda Mais](https://revendamais.com.br/blog/o-que-e-renave-registro-nacional-de-veiculos-em-estoque/)
- [Contratar solução para registro de entrada e saída de veículos em estoque (RENAVE) — gov.br](https://www.gov.br/pt-br/servicos/contratar-solucao-para-registro-eletronico-de-entrada-e-saida-de-veiculos-em-estoque-renave)
- [RENAVE — Detran-SP](https://detran.sp.gov.br/renave/)
- [Entenda o laudo veicular — Super Visão](https://supervisao.com/entenda-o-laudo-veicular/)
- [O que é o SNG — Sistema Nacional de Gravames](https://biblue.com.br/blog/registro-contrato/o-que-e-sng-sistema-nacional-gravames)
- [SNG — B3](https://www.b3.com.br/pt_br/produtos-e-servicos/gestao-de-garantias/sng/sng/)
- [Contrato de compra e venda de veículo — Docusign](https://www.docusign.com/pt-br/blog/contrato-de-compra-e-venda-de-veiculo)
- [Veículo usado tem garantia? — Jus](https://jus.com.br/artigos/97203/veiculo-usado-tem-garantia)
- [Resolução COAF 25/2013](https://www.normaslegais.com.br/legislacao/resolucao-coaf-25-2013.htm)
- [Departamento de F&I na loja de carros — Autoconf](https://autoconf.com.br/blog/como-montar-um-departamento-de-fi-na-sua-loja-e-aumentar-o-lucro-por-venda/)
- [Simulador de financiamento multibancos — Autoconf](https://autoconf.com.br/blog/simulador-de-financiamento-multibancos/)
- [FANDI — plataforma de financiamento veicular](https://fandi.com.br/)
- [API de histórico veicular — Consultar Placa](https://docs.consultarplaca.com.br/)
- [Comunicação de venda: prazo e multa — AutoDossiê](https://autodossie.com.br/blog/comunicacao-de-venda-prazo-multa-como-fazer)
- [Revenda de usados equiparada a consignação (Lei 9.716/98) — APET](https://apet.org.br/artigos/revenda-de-veiculos-automores-usados-compra-e-venda-mercantil-equiparada-a-consignacao-para-fins-de-apuracao-da-receita-tributavel-e-do-lucro-presumido-coeficiente-de-presuncao-aplicavel-evoluca/)
- [O que é DMS — CIGAM](https://www.cigam.com.br/blog/961/o-que-e-dms-gestao-concessionarias)
- [LGPD para concessionárias — AutoForce](https://blog.autoforce.com/lgpd-concessionarias/)
