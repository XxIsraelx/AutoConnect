---
tipo: levantamento
data: 2026-09-23
---

# O que os CRMs vendem hoje, e onde o AutoConnect está

Levantamento de 2026 sobre 15 sistemas usados por revenda e concessionária no
Brasil, 12 CRMs de concessionária do mercado americano e 9 CRMs de vendas
genéricos, cruzado com um inventário do que o AutoConnect faz hoje — conferido
no código, não na memória.

O plano que sai daqui: [plano de paridade e diferenciação](plano-paridade-crm.md).

**Recorte escolhido com o usuário em 23/09/2026:** cliente-alvo é **revenda de
seminovos** (1 a 3 lojas, 2 a 8 vendedores), e a prioridade é **o que destrava o
primeiro cliente pagante**, não paridade completa.

## Método e limites

- Só foi registrado o que estava em página oficial de produto, página de preço,
  material de ajuda ou review com base pública (B2B Stack, G2, Capterra).
- **Preço e review são opacos no vertical brasileiro:** apenas 4 dos 15 produtos
  publicam valores, e Syonet e Linx DMS estão com zero avaliações no B2B Stack.
  Avaliar esses produtos depende do processo comercial deles.
- Ausência aqui significa "não encontrado em material público", não "não existe".

---

## 1. O ciclo que toda revenda espera fechar

Presente em 10 ou mais dos 15 produtos brasileiros. Não entregar isso não é
desvantagem competitiva: é produto incompleto.

> estoque → **publica sozinho nos portais** → lead volta para um funil →
> **distribui entre vendedores** → vendedor atende **por WhatsApp no celular** →
> sai relatório

| Base do mercado | Produtos com | AutoConnect hoje |
|---|---|---|
| Funil / gestão de oportunidade | 15 de 15 | ✅ funil de lead + negócio com máquina de estados |
| Relatórios e dashboards | 13 de 15 | ✅ inclusive margem e giro, que poucos fecham por unidade |
| Integrações / API | 13 de 15 | 🟡 API própria, sem integração com portal |
| **Captação de leads de portais** (OLX, Webmotors, iCarros, Mercado Livre) | 13 de 15 | ❌ **nenhuma** |
| Estoque de veículos | 10 de 15 | ✅ com custo, FIPE e importação CSV |
| **Distribuição / rodízio de leads** | 10 de 15 | ❌ só atribuição manual |
| **WhatsApp** | 11 de 15 | ❌ só link `wa.me`, conversa não volta |
| App mobile do vendedor | 11 de 15 | 🟡 site responsivo, sem app e sem push real |
| Site da loja integrado ao estoque | 7 de 8 no nicho | ✅ `/c/[slug]` e catálogo público |
| **Publicação automática em múltiplos portais** | padrão no segmento | ❌ |

Quatro buracos, e três deles (portal, rodízio, WhatsApp) aparecem na primeira
conversa de venda com um lojista.

### Buracos que a pesquisa de mercado não mostra, e o código mostra

O inventário do código encontrou cinco coisas que quebram o uso real antes mesmo
de qualquer comparação com concorrente:

1. **Lead anônimo não existe.** O formulário público exige login. Visitante que
   não cria conta não vira contato — e esse é o caminho da maior parte do tráfego.
2. **O vendedor não cadastra lead à mão.** Quem chega por telefone, WhatsApp ou
   balcão fica de fora do sistema.
3. **O vendedor não agenda pelo cliente.** Só o cliente logado cria agendamento;
   o vendedor apenas confirma ou reagenda.
4. **Sem deduplicação:** o mesmo cliente clicando três vezes vira três leads.
5. **Sem carteira:** todo vendedor vê os leads de todo mundo.

---

## 2. Onde há espaço — as três lacunas do mercado brasileiro

**Test drive não existe como entidade em produto nenhum.** Em 15 sistemas,
nenhum nomeia agendamento de test drive. Existe agenda de visita, agenda do
vendedor e autoagendamento de **oficina** — o agendamento que o mercado
automatizou é o de revisão, não o de experimentar o carro. O AutoConnect já
trata agendamento com tipo, lembrete, no-show e comparecimento medido, o que
nenhum material público de concorrente descreve.

**Contrato com assinatura eletrônica é quase vazio, bem na hora em que virou
conformidade.** Só a Boom cita assinatura nativa; o resto "armazena documentos".
Enquanto isso, as regras de 2026 do RENAVE passaram a exigir **contrato
eletrônico com assinatura digital** para consignado, e banco só financia veículo
registrado no RENAVE. O AutoConnect já tem contrato versionado, snapshot, hash
conferido no download e Clicksign integrada — falta a conta de produção.

**LGPD está vazia como posicionamento.** Em 15 produtos que manipulam CPF, RG,
CNH, comprovante de renda e score para submeter proposta a vários bancos, só um
cita registro de atividade e controle por perfil. O AutoConnect tem isolamento
por loja no próprio banco (RLS), documento privado com link de 10 minutos e
trilha de auditoria — hoje usada só em duas telas.

## 3. Onde não há espaço

**Agente de IA no WhatsApp.** AutoForce, Syonet, AutoConf e Mobiauto estão todos
nisso agora. Chegar aí é entrar em fila. O ângulo que sobra é o que a AutoForce
já ocupou: IA ancorada em dado próprio (estoque, FIPE, tabela de preço), não
conversa genérica.

---

## 4. O que o mercado global antecipa

Serve para saber o que vem depois, não para copiar: os CRMs americanos
(VinSolutions, DealerSocket, Elead/CDK, Reynolds, Dominion) resolvem um mercado
com estrutura diferente.

**Tem paralelo aqui:**
- **Desking** — montar a proposta com entrada, parcela e taxa lado a lado, em
  vários cenários. Está em 8 de 8 produtos. É o equivalente maduro da nossa
  proposta no chat.
- **Velocidade de resposta ao lead** é o motivo de compra mais citado, e vem
  antes de qualquer recurso sofisticado.
- **App com leitura de CNH e chassi por câmera** é tratado como básico.
- **Equity mining** — vasculhar a base para achar quem está pronto para trocar.

**Não se transfere:**
- ADF/XML como padrão de lead é convenção americana; aqui cada portal tem API
  ou webhook próprio.
- TCPA, OFAC, Red Flags, Adverse Action, Military Lending Act: exigências
  americanas sem equivalente direto. O que vale aqui é LGPD, e fraude documental.
- "DMS" americano inclui contabilidade e folha; no Brasil isso é ERP separado.
- Financiamento com aprovação no mesmo dia depende de uma rede de credores
  integrados que não existe por aqui.

---

## 5. Preço e modelo de cobrança

O dado que mais muda a estratégia comercial:

- **No vertical, a cobrança não é por usuário.** Boom cobra por loja
  (R$ 269 e R$ 589/mês), AutoForce por marca (a partir de R$ 1.985/mês).
  Followize e Autoweb usam "usuários ilimitados" como argumento de venda.
- **Quem cobra por usuário veio de fora do automotivo:** RD Station
  (R$ 65,70 a R$ 117,90) e Agendor (R$ 59 a R$ 156).
- Num setor de alta rotatividade de vendedor, cobrar por assento é atrito: a
  loja passa a evitar cadastrar gente.
- **55,9% dos compradores de SaaS no Brasil não usam cartão de crédito**
  (B2B Stack, fev/2026): boleto 18,6%, Pix 15,9%. Cobrar só no cartão corta
  metade do mercado.

**Recomendação:** preço por loja, com faixa por volume de estoque ou de usuários,
e cobrança com Pix e boleto desde o primeiro dia.

---

## 6. Sobre o CRM genérico no automotivo

RD Station é o mais usado por tabela, e sua nota mais baixa no B2B Stack é
justamente "Recursos e funcionalidades" (3,9 de 5, com 2.548 avaliações). Existe
material comercial dedicado a integrar Syonet com RD Station — a loja compra os
dois e costura. Isso descreve uma dor real: o genérico é barato e fácil, mas não
sabe o que é estoque, FIPE, procedência e contrato.

É exatamente a fresta em que o AutoConnect entra, desde que feche o ciclo básico
que a Parte 1 descreve.
