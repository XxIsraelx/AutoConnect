---
tipo: plano
data: 2026-09-23
---

# Plano — paridade de CRM e diferenciação

Base: [levantamento dos CRMs](levantamento-crms-e-paridade.md) e o inventário do
código de 22/09/2026. Governa junto com o
[plano de vendas e contrato](plano-implementacao-vendas.md), que cuida das fases
3 a 5 (consulta veicular, crédito, fiscal).

**Alvo:** revenda de seminovos, 1 a 3 lojas, 2 a 8 vendedores.
**Critério de prioridade:** o que impede uma loja de trocar planilha ou
concorrente pelo AutoConnect **agora**. O que não impede, espera.

**Estimativas são de esforço, não prazo**, e valem para uma pessoa trabalhando
com apoio do Claude. Cada onda só fecha com o portão verde
(`pnpm exec turbo run typecheck lint test`) e a funcionalidade alcançável pela
tela — a regra de "endpoint pronto não é funcionalidade" vale aqui inteira.

---

## Onda 0 — o funil não pode vazar ✅ (23/09/2026)

Sem isto, o piloto falha na primeira semana de uso real, e nenhuma comparação
com concorrente importa.

1. ✅ **Lead anônimo.** `POST /leads/public` (`@Public()`) cria lead sem conta,
   com consentimento LGPD gravado no próprio lead (`consented_at` e
   `consent_text`, que guarda a **cópia** do texto exibido no aceite). A loja
   vem do veículo, lido do banco, e nunca do corpo. Telas: o modal "Tenho
   interesse" de `/catalogo/[id]` e um botão novo em `/c/[slug]` — quem está
   logado continua indo por `POST /leads`, que vincula a conta.
2. ✅ **Lead manual pelo vendedor.** Botão "Novo lead" em `/leads`, com
   `LEAD_SOURCES_MANUAIS` (subconjunto de `LeadSource`: `website`, `app` e
   `trade_in` ficam de fora, para o relatório de origem não mentir).
3. ✅ **Agendamento criado pelo vendedor.** `POST /appointments/dealer` e botão
   "Novo agendamento" em `/agendamentos`. `customer_user_id` virou nulo e o
   contato passou a ser copiado para o agendamento; a constraint
   `appointments_tem_contato` exige cliente, lead ou nome+telefone.
4. ✅ **Deduplicação.** Mesmo telefone normalizado ou e-mail, na mesma loja, em
   30 dias e fora de status terminal, vira interação `duplicate` no lead que já
   existia. A resposta traz `deduplicado: true` e a tela avisa.
5. ✅ **Clique no WhatsApp e no telefone** vira interação (`whatsapp`, `call`,
   `email`) pelo componente `ContatoDoLead`, usado em `/leads` e no drawer de
   `/agendamentos`. O registro sai em paralelo: se falhar, o link abre do mesmo
   jeito e a tela avisa que a interação não foi gravada.

Antiabuso proporcional, sem CAPTCHA e sem Redis: telefone brasileiro validado
(`normalizarTelefoneBr`), honeypot no formulário e teto de 5 envios por
IP+loja+veículo em janela de 10 minutos, em memória de processo
(`modules/leads/limite-por-ip.ts`). O `trust proxy` foi ligado no `app.setup`
para que `req.ip` seja o do visitante, e não o da borda do Railway — sem isso o
teto barraria a internet inteira depois do quinto envio.

**Pronto quando:** um vendedor consegue passar um dia inteiro de atendimento sem
sair do sistema, incluindo quem chegou por fora do site.

**Ficou de fora, de propósito:** o lead de troca (`POST /catalog/trade-in`) não
passa pela deduplicação — ele carrega `metadata.tradeIn` com o veículo ofertado
e uma avaliação por oferta, e fundir duas ofertas num lead só perderia a
primeira.

## Onda 1 — o que a loja compara na primeira reunião (≈ 2 semanas)

6. ✅ **Distribuição de leads** (23/09/2026). Rodízio entre quem está de
   plantão, aplicado nos três caminhos de criação (formulário público, cliente
   logado e cadastro manual). Ajustes em `/configuracoes` → "Leads e
   atendimento"; plantão por membro em `/equipe`, com "ausente até".

   **A ordem é um anel** por data de entrada na equipe (`created_at`, com o id
   desempatando), e o próximo é quem vem logo depois do último atribuído —
   guardado em `tenant_crm_settings.rodizio_ultimo_usuario_id`. É essa
   previsibilidade que a loja compara com o concorrente: o vendedor consegue
   dizer se o próximo é dele. **Quando não há de onde andar no anel** (primeiro
   lead da loja, ou o último atribuído saiu/entrou de férias), desempata o
   **menor número de leads abertos** — escolher o primeiro da lista faria uma
   pessoa só receber tudo enquanto o ponteiro estivesse fora do ar.

   **A concorrência é resolvida no banco, não em memória.**
   `SELECT … FOR UPDATE` na linha de `tenant_crm_settings`, dentro da **mesma
   transação** que grava o lead: o segundo lead simultâneo fica bloqueado até o
   primeiro confirmar, e então lê o ponteiro já atualizado. Feito em memória de
   processo, o defeito nem aparece com uma réplica só — e apareceria no dia em
   que a API escalasse. A linha é tabela própria justamente por isso: travar
   `tenants` a cada lead prenderia o cadastro inteiro da loja atrás da fila.

   **Sem ninguém elegível o lead fica sem responsável**, com uma interação
   `rotation` dizendo por quê, e aparece no filtro "Sem responsável" de
   `/leads`. Inventar um dono fora do plantão é como um lead dorme o fim de
   semana na caixa de quem não está trabalhando.

7. ✅ **Prazo de primeiro contato (SLA)** (23/09/2026). `firstResponseDueAt` é
   calculado na criação do lead; `firstRespondedAt` é gravado na primeira
   interação **de saída** do vendedor (`call`, `whatsapp`, `email`, `chat`).
   Nota interna não conta, de propósito: escrever sobre o cliente não é falar
   com ele, e contá-la mediria quem digita mais.

   **O relógio só corre no expediente.** Um lead que chega às 23h de sábado não
   pode nascer estourado às 23h15 — a loja estava fechada. O prazo começa a
   contar na próxima abertura. O expediente vem do `businessHours` da filial do
   lead (ou da primeira filial ativa) e o fuso de `Tenant.timezone`; loja sem
   expediente configurado usa o padrão do shared (seg–sex 09–18, sáb 09–13), e
   não 24h por dia — o padrão errado para menos é alarme falso, o errado para
   mais é lead esquecido. Loja sem um único dia aberto **não gera prazo**
   (`null`), em vez de um prazo inventado.

   Etiqueta e filtro em `/leads` (no prazo, vencendo, estourado). Os dois usam
   o mesmo `limiteDeAlertaSegundos`, que a API manda junto da lista: com cada
   ponta calculando o seu, a etiqueta diria "no prazo" sobre um lead que o
   filtro já traz como vencendo.

   **Estouro**: cron a cada 5 minutos (`sla-primeiro-contato`, sob
   `executarEmUmaReplica`) marca `slaBreachedAt`, escreve a interação
   `sla_breach` e notifica **gerente e administrador** — não o vendedor, que já
   vê a etiqueta vermelha. `slaBreachedAt` é o que torna o job idempotente: sem
   ela o gerente receberia o mesmo alerta a cada 5 minutos, e um alarme que
   repete é um alarme que se aprende a ignorar. **Devolução à fila é
   configurável e nasce desligada**: tirar o lead de um vendedor é decisão de
   gestão, não efeito colateral de um alarme.

   `GET /leads/sla-stats?days=` devolve um **array** de
   `{ userId, nome, leads, respondidos, tempoMedioSegundos, estourados }` — uma
   linha por vendedor, mais uma com `userId: null` ("Sem responsável"), porque
   o lead que ninguém pegou é justamente o que mais estoura. Só entram leads
   com prazo; os anteriores à funcionalidade não são cobráveis. É o que o
   relatório do item 10 consome.

8. ✅ **Carteira do vendedor** (23/09/2026). Com `vendedorVeTodosOsLeads`
   desligado, `salesperson` vê só os próprios leads **e os sem responsável** —
   a fila entra de propósito, senão o lead que o rodízio não distribuiu ficaria
   invisível para quem poderia atendê-lo. Gerente e administrador veem tudo.

   O recorte é uma função só (`modules/leads/carteira.ts`) aplicada em lista,
   contadores, CSV, detalhe, atribuição e exclusão. Montá-lo em cada método é
   como uma superfície fica de fora — e o botão de CSV vira o caminho para
   contornar a carteira inteira. O lead de outro vendedor responde **404, não
   403**: confirmar que ele existe já entrega que o colega tem um cliente com
   aquele id, e o id circula por link.

   **Padrão desligado desde 23/09/2026: carteira fechada.** Nasceu ligado para
   não mudar o que a loja já enxergava, mas o piloto começa com cada vendedor
   vendo os próprios leads e a fila — e, sem cliente pagante ainda, as lojas
   existentes acompanharam o padrão novo (migration
   `20260924000000_carteira_fechada_por_padrao`). O rodízio já nascia ligado.

9. ✅ **Motivo de perda** (23/09/2026). Lista fechada no shared
   (`domain/motivo-perda.ts`), com listas separadas para lead e para negócio —
   o negócio morre por razões que o lead não tem (crédito já pedido e
   reprovado, troca recusada na vistoria). `PATCH /leads/:id` exige
   `lostReasonCode` ao ir para `lost`, e `POST /deals/:id/transition` exige
   `cancelReasonCode` em `canceled` e `rescinded`; "outro" sem texto livre é
   recusado, senão "outro" vira o depósito de tudo. Sair de "perdido" **limpa**
   o motivo — senão o relatório contaria como perda por preço um lead que está
   em negociação. Contagem em `GET /leads/stats` (`porMotivoDePerda`), com as
   perdas anteriores agrupadas em `sem_motivo`, que é honesto.

   **Código em texto, não enum do banco:** motivo de perda é o campo que a loja
   quer ajustar depois da primeira semana de uso, e cada ajuste custaria uma
   migration. Quem recusa valor fora da lista é o Zod da rota; o `CHECK` da
   migration só impede string vazia, e o relatório trata código desconhecido
   como "outro".

   > O formato de `GET /leads/stats` mudou de `{ new: 3, lost: 1 }` para
   > `{ porStatus, porMotivoDePerda }`: a forma antiga era um mapa aberto e a
   > tela somava `Object.values(...)` para o total.
10. ✅ **Relatório por vendedor** (23/09/2026). Seção em `/relatorios`, servida
    por `GET /tenant/reports/salespeople?days=`: leads recebidos e atendidos,
    agendamentos, comparecimento, negócios ganhos, faturamento, margem e
    comissão estimada. São **cinco consultas** no total — a equipe mais quatro
    `groupBy` —, e não uma por vendedor: a API roda numa região diferente do
    banco, e um laço por pessoa transformaria o relatório em meio minuto de
    espera.

    O **tempo médio de primeira resposta** não é calculado aqui: vem de
    `GET /leads/sla-stats` (item 7) e a tela junta os dois. Duas definições do
    mesmo número é como dois relatórios da mesma loja passam a discordar.
    Enquanto a rota do SLA não responde, as duas colunas do prazo mostram "—" e
    o resto da seção continua inteiro.

    **Dinheiro é de gerente para cima** (`manager`, `tenant_admin`,
    `super_admin`, a mesma lista da aba de custo). O vendedor vê a própria
    linha, e o filtro entra na **consulta**: o número do colega não chega a sair
    do banco. Exportação em CSV do desempenho, dos negócios e do estoque, com
    as colunas de dinheiro ausentes para quem não as vê.

11. ✅ **Rascunho de anúncio** (23/09/2026). O estado do **anúncio** passou a ser
    separado do estado do **estoque**: `VehicleStatus` responde "a loja ainda
    tem este carro?" e o novo `ListingStatus` (`draft`, `published`,
    `unpublished`) responde "este carro está na vitrine?". Antes, cadastrar era
    publicar — o carro estreava sem foto e com o preço que o vendedor ainda ia
    conferir.

    Três estados, e não `published_at` nulo ou não: o nulo não distingue "nunca
    foi ao ar" de "foi tirado do ar", e despublicar teria de apagar a data da
    estreia, que é o que a lista de estoque usa para contar dias de giro.

    **Compatibilidade:** a migration é aditiva e traz `UPDATE … SET
    listing_status = 'published' WHERE status = 'available'` — o critério é
    exatamente o que decidia a visibilidade antes dela. Sem esse backfill, toda
    loja em uso perderia o catálogo inteiro no deploy.

    **Publicar exige o mínimo** — ao menos uma foto, preço maior que zero, cor,
    combustível e câmbio — e o veículo tem que estar `available`. A regra mora
    no shared (`domain/anuncio.ts`), usada pela tela para avisar *antes* e pela
    API para recusar *depois*, com 422 dizendo o que falta. Rota própria
    (`POST /vehicles/:id/publish` e `/unpublish`), e não um campo no PATCH:
    aceitar `listingStatus` no corpo seria um jeito de pular a conferência.

    **A vitrine inteira passou a exigir `published`** — catálogo, detalhe,
    `/buscar`, `/c/[slug]`, contagem dos pins do mapa e selo de procedência —,
    e a policy `leitura_publica` do RLS repete a mesma dupla no banco: um
    caminho público novo que esqueça o filtro não volta a expor rascunho.
    Despublicar tira do catálogo sem mexer no estoque, e republicar não zera a
    data da estreia.

**Pronto quando:** dá para demonstrar o ciclo inteiro numa reunião de 20 minutos
e responder "como o lead chega no vendedor certo?" sem constrangimento.

## Bloqueios do primeiro dia — feitos antes da Onda 2 (25/09/2026)

O [piloto do primeiro dia](../produto/piloto-simulado-primeiro-dia.md) encenou
um dono chegando sozinho num ambiente novo e achou paredes que a Onda 2 não
cobria. Nenhuma delas é funcionalidade nova: são fios soltos entre o que já
existe. Foram feitas **antes** da Onda 2 porque cada uma impede o uso.

- **O convite de equipe não podia ser aceito** (B2): o
  `PublicInvitationsController` existia e não estava montado — 404 em produção,
  e um CRM em que só o dono entra não é um CRM. Registrado, com e2e do fluxo
  inteiro e um teste que cruza todo `@Controller(` com os `controllers:` dos
  módulos.
- **"O Zod descartou e a tela comemorou"** (B4, B5): `businessHours`,
  `primaryPhone` e `acceptsTradeIn` sumiam no parse e a tela mostrava "salvo!".
  Corrigidos os schemas; os corpos de `/tenant/me` e `/tenant/branch/:id` são
  `.strict()`, e um teste varre os `api(...)` de escrita do `apps/web` conferindo
  cada campo contra o schema da rota. Ele achou um quarto caso sozinho
  (`status` do veículo). O horário salvo é o que faz **o relógio da Onda 1 rodar
  no expediente real da loja**, e não no padrão do shared.
- **Todo lead tem dono e relógio** (B9): a conta de rodízio e SLA saiu de dentro
  do `LeadsService` para `AtribuicaoDeLead`, no módulo CRM, e o formulário de
  troca passou por ela — com consentimento LGPD e telefone canônico. A Onda 1
  dizia "aplicado nos três caminhos de criação"; a troca era um quarto.
  Deduplicação continua **não** se aplicando à troca, de propósito.
- **Agendamento respeita o expediente** (B10): horários vindos do
  `businessHours` da filial, conferidos de novo na API, e o agendamento entra no
  lead aberto da mesma pessoa, herdando o vendedor. É o primeiro pedaço do
  "costurar a mesma pessoa".
- **Sem a Cloudinary, o produto diz que falta configurar** (B1) — em vez de
  "Falha ao enviar uma das imagens", que travava a publicação inteira num
  ambiente novo. E a página pública parou de cair com id inválido (B13), a
  máscara parou de estragar telefone fixo e o WhatsApp só aparece para celular
  (B6), e o expediente ficou editável a 375 px (B12).

- **O cadastro virou autosserviço** (veredito 1º do piloto, a parede que decide):
  a home prometia "Criar conta grátis" em cinco botões e todos caíam numa tela
  que exigia convite — e num banco recém-migrado não havia caminho para criar o
  **primeiro super admin**, então ninguém emitia convite e ninguém criava a
  primeira loja. Agora `POST /auth/signup-tenant` aceita cadastro sem token, com
  assinatura em `trial` e `trialEndsAt` gravado (14 dias, `DURACAO_DO_TRIAL_DIAS`
  — antes a data nascia nula). O convite continua existindo e sendo consumido,
  para trazer equipe e para o caminho comercial.

  O formulário caiu de **22 campos em 5 etapas para 5 campos numa tela**; o que
  saiu é pedido onde importa (endereço no checklist de primeiros passos, razão
  social e representante legal em `/configuracoes`, antes do contrato). A porta
  pública ganhou teto por IP em memória de processo (3 por hora, sem Redis e sem
  CAPTCHA), o **dígito verificador do CNPJ virou a regra dura** e a BrasilAPI
  virou enriquecimento — fora do ar, 429 ou 404 não impedem mais o cadastro
  (B3). Convidar equipe e publicar anúncio exigem e-mail confirmado; explorar o
  painel e o primeiro login, não. E existe um comando documentado para o
  primeiro super admin, que recusa rodar se já houver algum. Tudo em
  [cadastro em autosserviço](../decisoes/2026-09-25%20cadastro%20em%20autosservico.md).

**Continuam abertos, por serem decisão de produto:** o catálogo global de
marcas nascer vazio e sem `@Roles`/Zod na escrita (B15), o `branch_id` que o
assistente não atribui e zera a contagem do mapa (B7), a coordenada da filial
(B8), a FIPE escolhendo a variante errada (B16) e **o chat do lead anônimo**
(B11) — este último é o que falta do 5º item do veredito e pertence à Onda 2.

## Onda 2 — reordenada pelo piloto simulado (25/09/2026)

O [piloto simulado](../produto/piloto-simulado-operacao.md) encenou uma semana
de operação nas telas e **contrariou a ordem que estava escrita aqui**. O
gargalo não é entrada de lead: é o que acontece com o lead **depois** que ele
entra, e o dinheiro do negócio. Os três primeiros são dias de trabalho, não
semanas, e vêm antes de WhatsApp e portais.

12a. ✅ **Lead manual completo** (25/09/2026). O modal "Novo lead" parou de
     pedir `/users` quando o papel não pode vê-la e passou a carregar equipe e
     estoque **em chamadas separadas** — juntas num `Promise.all`, o 403 de
     `/users` descartava o estoque que tinha voltado 200, e o `select` de
     veículo ficava só com "Nenhum". Cada lista avisa da própria falha.

     `PATCH /leads/:id` passou a aceitar `vehicleId` (e `null`, que desfaz o
     vínculo), com o mesmo recorte de carteira do resto: o lead do colega
     responde **404, não 403**, e veículo de outra loja é 404. Vincular, trocar
     e remover escrevem na timeline — é o histórico que responde "por que este
     lead virou negócio do Corolla se ele ligou perguntando do Onix?". Com
     veículo, o card ganha o botão "Negócio" que já existia.

     `status` virou opcional no schema, e o corpo vazio é recusado: um PATCH
     que não pede nada é bug do chamador, e aceitá-lo em silêncio o esconde.

12b. ✅ **Preço negociável no negócio aberto** (25/09/2026). Cartão "Preço" em
     `/negocios/[id]`, com tabela e desconto; o valor de venda sai da conta e é
     conferido em `Decimal` pela API, como sempre. O campo aceita o formato que
     a tela exibe (`84.900,00`) e diz o que esperava em vez de devolver
     "Validation failed". Margem, funil por valor e comissão acompanham.

     Quem edita: a gerência e **o vendedor do próprio negócio** — negociar
     desconto é o trabalho dele, e um desconto que só o gerente digita não é
     negociação, é fila.

     **Contrato emitido congela o preço.** O PDF arquivado tem os valores
     impressos e um hash conferido no download; mudar o preço por baixo dele
     faria o hash confirmar um valor que não é mais o do sistema. A tela diz
     para anular o contrato e emitir outro, e a API recusa com 409. O porquê
     está em
     [base da comissão e preço negociável](../decisoes/2026-09-25%20base%20da%20comissao%20e%20preco%20negociavel.md).

12c. ✅ **Uma base só para comissão** (25/09/2026). **Percentual do perfil ×
     valor de venda dos negócios faturados, pela data de fechamento.** Uma
     função no shared (`calcularComissao`), consumida por `/equipe`,
     `/relatorios` e pelo próprio negócio — que passou a mostrar a comissão,
     que é onde o vendedor pergunta por ela. Cada tela cita a base junto do
     número.

     A base é o valor de venda, e não a margem, por três razões: a margem é
     informação de gerência (comissão sobre ela seria uma divisão para deduzir
     o custo do carro), a comissão é ela própria um custo que entra na margem
     (cálculo circular), e margem negativa daria comissão negativa. Decisão
     registrada em
     [base da comissão e preço negociável](../decisoes/2026-09-25%20base%20da%20comissao%20e%20preco%20negociavel.md).

**Junto com os três, porque moram no mesmo caminho** (25/09/2026): emitir o
contrato move o negócio para "contrato emitido" — e rascunho não emite, porque
a máquina de estados não vai de `draft` para lá (B10); o botão de emitir nasce
desabilitado em negócio terminal, dizendo por quê (B11); o motivo do
cancelamento aparece na lista, no detalhe e no histórico (B12); comparecimento
e falta só a partir do horário marcado, na API e na tela (B14); o motivo da
perda aparece assim que é salvo, porque a lista passou a usar o lead que o
PATCH devolveu em vez de copiar só o status (B7). De quebra, o detalhe do
negócio parou de rolar de lado em 375 px — a grade estava sem `grid-cols-1` e a
coluna implícita crescia até o max-content do cartão mais largo (B9).

**Depois, e só depois, o ciclo que o mercado cobra (≈ 3 a 4 semanas):**


12. **WhatsApp oficial (API da Meta):** caixa de entrada dentro do sistema,
    conversa ligada ao lead e ao veículo, modelos aprovados para lembrete de
    agendamento e retorno de proposta. É pré-requisito, não diferencial: 11 dos
    15 concorrentes têm.
13. **Entrada de leads dos portais** (o piloto rebaixou para depois do
    WhatsApp — entrada de lead não era o gargalo)**:** OLX, Webmotors, iCarros e Mercado Livre.
    Começar pela **ingestão** (webhook ou leitura da caixa de e-mail que o portal
    já manda), que é o que a loja sente. Publicação automática vem depois.
14. **App do vendedor na prática:** notificação push de verdade (service worker
    + web-push), que hoje só funciona com a aba aberta.

**Pronto quando:** o lead do portal entra sozinho, cai no vendedor de plantão e
é respondido pelo WhatsApp sem ninguém copiar e colar.

## Onda 3 — cobrar (≈ 1 a 2 semanas)

15. **Gateway com Pix e boleto** (Asaas, Pagar.me ou Iugu), assinatura por loja,
    faixa por volume. Hoje plano e trial são trocados na mão pelo super admin e
    não existe cobrança nenhuma.
16. **Limite e bloqueio:** aplicar `seatsLimit`, avisar vencimento, bloquear por
    inadimplência com carência.

    Ficou mais urgente desde 25/09/2026: com o cadastro em autosserviço, o
    trial agora **tem data de fim gravada** (`trialEndsAt`, 14 dias) e **nada
    acontece quando ela passa**. A loja segue usando o produto de graça, sem
    aviso e sem caminho para pagar.

**Pronto quando:** um cliente assina e paga sozinho, sem você emitir nada à mão.

## Onda 4 — o que ninguém tem (≈ 2 semanas)

Aqui o produto deixa de ser "mais um CRM" e passa a ter argumento próprio.

17. **Test drive como objeto de primeira classe:** checklist de saída e retorno,
    CNH do condutor registrada, termo de responsabilidade assinado no celular,
    quilometragem, e conversão de test drive em venda no relatório. Zero
    concorrentes nomeiam isso.
18. **Contrato e consignação no padrão RENAVE:** contrato eletrônico assinado
    para consignado, que a regra de 2026 passou a exigir e que quase ninguém tem.
    Depende da conta de produção da Clicksign e da revisão jurídica.
19. **LGPD como produto:** trilha de auditoria em estoque, negócio e contrato
    (hoje só em duas telas), registro de consentimento, exportação e eliminação
    de dados do titular. Ninguém no mercado vende isso.

## Onda 5 — depois (sem estimativa)

20. Consulta veicular com fornecedor real (bloqueada por contrato comercial).
21. F&I multibanco — barreira comercial com bancos, não técnica.
22. Publicação automática nos portais (integrador).
23. IA ancorada em dado próprio: sugestão de preço com FIPE e histórico da loja,
    resumo de conversa, priorização de lead. Entrar por último e pelo ângulo do
    dado, porque em conversa genérica o mercado inteiro está na mesma fila.

---

## O que este plano deliberadamente não faz

- **Não persegue paridade completa.** Oficina e pós-venda, NF-e, repasse entre
  lojas, fidelização por pontos e múltiplos funis ficam fora: revenda de
  seminovos não compra por isso.
- **Não entra em IA de conversa agora.** Quatro concorrentes já estão lá.
- **Não vira DMS.** Contabilidade e folha são de ERP; o americano junta, o
  brasileiro pequeno não compra assim.

## Decisões que dependem do usuário

1. **Modelo de cobrança:** por loja (como o vertical) ou por usuário (como o
   CRM genérico). A recomendação é por loja, com faixa por volume.
2. **Custo do WhatsApp oficial:** a API da Meta cobra por conversa. Definir se
   entra no preço ou é add-on.
3. **Portais:** quais integrar primeiro depende de onde o cliente-piloto anuncia.
4. **Conta de produção da Clicksign** e revisão jurídica do contrato: hoje
   bloqueiam a Onda 4 e o uso real do que já está pronto.

## Sequência recomendada

Onda 0 e 1 primeiro, porque são baratas e mudam a conversa de venda. A Onda 3
(cobrança) pode ser antecipada se já houver cliente disposto a pagar — receber
por fora no primeiro cliente é aceitável, mas não no terceiro. A Onda 2 é a mais
cara e é o que separa "promissor" de "eu troco meu sistema por isso".

**Os bloqueios do primeiro dia entraram na frente da Onda 2** (25/09/2026), e o
motivo vale ser lembrado: eles não aparecem numa loja com dados, que é onde os
dois pilotos anteriores olharam. Aparecem no dia zero, com o cliente sozinho —
e é o dia zero que decide se existe um segundo dia. Antes de qualquer
funcionalidade nova da Onda 2, vale repetir o roteiro do primeiro dia contra um
banco vazio: foi ele que encontrou nove defeitos que o portão verde não pegava.
