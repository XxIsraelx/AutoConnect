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

## Onda 2 — reordenada pelo piloto simulado (25/09/2026)

O [piloto simulado](../produto/piloto-simulado-operacao.md) encenou uma semana
de operação nas telas e **contrariou a ordem que estava escrita aqui**. O
gargalo não é entrada de lead: é o que acontece com o lead **depois** que ele
entra, e o dinheiro do negócio. Os três primeiros são dias de trabalho, não
semanas, e vêm antes de WhatsApp e portais.

12a. **Lead manual completo.** Lead de balcão e de telefone nasce sem veículo e
     não tem como ganhar um depois (`PATCH /leads/:id` só move status), então
     não vira negócio. É a porta de entrada do lead que a loja gera sozinha —
     justamente o que nenhum portal traz. Trazer mais lead de fora antes disso é
     aumentar uma fila que não converte.
12b. **Preço negociável no negócio aberto.** Negociar é o que o vendedor faz o
     dia inteiro e não há onde digitar: o negócio aberto pelo card do lead nasce
     no preço de tabela e nunca muda. O `updateDealSchema` já aceita `discount` e
     `saleValue` — falta a tela. Sem isso o funil por valor mostra números que
     não são os da venda.
12c. **Uma base só para comissão.** Hoje a mesma pessoa aparece com R$ 147,50
     numa tela e R$ 1.950,00 em outra. Num piloto real isso não aparece na
     demonstração: aparece no quinto dia, na conversa sobre pagamento, e depois
     dele o lojista deixa de acreditar em todos os outros números — inclusive na
     margem, que está certa.

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
