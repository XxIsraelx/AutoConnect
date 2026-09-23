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

6. **Distribuição de leads:** rodízio entre vendedores ativos, com plantão
   configurável, e atribuição automática do lead que chega.
7. **Prazo de primeiro contato (SLA):** contador no lead, alerta ao gerente e
   devolução do lead à fila se estourar. É o motivo de compra mais citado no
   mercado global, e só dois produtos brasileiros monitoram.
8. **Carteira do vendedor:** ver só os próprios leads, com o gerente vendo tudo.
   Hoje o filtro é por loja.
9. **Motivo de perda** obrigatório ao marcar lead ou negócio como perdido, e
   relatório por motivo. O campo `lostReason` já existe no banco, sem tela.
10. **Relatório por vendedor:** leads atendidos, tempo médio de primeira
    resposta, agendamentos, comparecimento, vendas, margem e comissão.
11. **Rascunho de anúncio:** hoje todo veículo `available` já aparece no
    catálogo público, sem etapa de publicação.

**Pronto quando:** dá para demonstrar o ciclo inteiro numa reunião de 20 minutos
e responder "como o lead chega no vendedor certo?" sem constrangimento.

## Onda 2 — o ciclo que o mercado considera obrigatório (≈ 3 a 4 semanas)

12. **WhatsApp oficial (API da Meta):** caixa de entrada dentro do sistema,
    conversa ligada ao lead e ao veículo, modelos aprovados para lembrete de
    agendamento e retorno de proposta. É pré-requisito, não diferencial: 11 dos
    15 concorrentes têm.
13. **Entrada de leads dos portais:** OLX, Webmotors, iCarros e Mercado Livre.
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
