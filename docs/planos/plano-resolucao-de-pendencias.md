---
tipo: plano
---

# Plano de resolução das pendências

Junta num lugar só o que está em aberto: a lista de
[estado-e-pendencias](estado-e-pendencias.md), as dívidas declaradas dentro do
[plano de paridade](plano-paridade-crm.md) e do
[plano de vendas](plano-implementacao-vendas.md), e os achados da auditoria de
**27/09/2026** (`fc1235c`).

**O critério da ordem é um só:** o que aproxima o primeiro cliente pagante.
Dentro do mesmo valor, o mais barato primeiro. Item que depende de terceiro
entra antes do que depende só de nós, porque o relógio dele começa fora daqui —
advogado, conta de produção e fornecedor levam dias respondendo, e esse tempo
corre em paralelo ao código.

**O que este plano não inclui:** funcionalidade nova de roadmap. A Onda 4 do
plano de paridade e as Fases 4 e 5 do plano de vendas continuam nos seus
planos; aqui só entra o que já existe e está pela metade, quebrado, invisível ou
desatualizado.

| Onda | O que é | Prazo | Depende de |
|---|---|---|---|
| **A** | Captação ligada, dinheiro visível, casa arrumada | ~1 dia | nós |
| **B** | Três relógios de terceiro que precisam começar a correr | 1 dia nosso + espera | advogado, Clicksign, fornecedor |
| **C** | Onda 2 do plano de paridade: WhatsApp, portais, push | 3 a 4 semanas | decisões 2 e 3 do plano de paridade |
| **D** | Portabilidade LGPD e costura do que ficou pela metade | ~1 semana | nós |
| **E** | Dívidas com gatilho: só viram trabalho quando o gatilho acontecer | — | o gatilho |
| — | **Adiado por decisão** (NF-e, financeiro da loja) | — | — |

**Quem executa:** duas sessões em paralelo, com dono por módulo — a divisão, as
regras de convivência e o prompt da sessão 2 estão em
[divisão entre sessões](divisao-entre-sessoes.md). A Onda B fica fora dela: é
pedido e espera, não código.

---

## Onda A — um dia, e o produto para de trabalhar contra si

### A1. Ligar a captação do Raio-X (a mais barata de todas)

- **O que:** criar a loja "AutoConnect" em produção pelo cadastro normal, dar
  **cortesia** a ela em `/admin › Concessionárias`, e cadastrar
  `NEXT_PUBLIC_RAIO_X_TENANT_ID` no serviço web do Railway. Decidir de passagem
  se o `NEXT_PUBLIC_CLARITY_ID` entra agora.
- **Por quê agora:** o formulário do Raio-X **não aparece** na home hoje — o
  pedido cai no `wa.me`, que é o fallback deliberado do código. A captação
  principal da landing nova está no caminho alternativo, e o funil que
  justificaria o Raio-X não é medido.
- **Como:** cadastro em `/signup` → cortesia pelo painel (senão o trial dela
  vence em 14 dias e o Raio-X para de gravar lead) → variável no Railway →
  **deploy novo**, porque `NEXT_PUBLIC_*` é embutida no build e variável sem
  build não tem efeito.
- **Pronto quando:** a home mostra o formulário em vez do botão de WhatsApp, e
  um pedido de teste vira lead na loja "AutoConnect".
- **Custo:** 30 a 60 min. **Depende de:** nós.

### A2. Tornar o sandbox da cobrança visível

- **O que:** `log.warn` no boot quando a URL da Asaas tem `sandbox` e
  `NODE_ENV=production`, e selo na tela do plano e na aba Sistema do `/admin`.
  O `sandbox` já vem no `GET /cobranca` e está **declarado e nunca renderizado**
  em `configuracoes/plano/page.tsx:46`.
- **Por quê agora:** a assinatura externa avisa duas vezes quando está em
  sandbox; a cobrança não avisa em lugar nenhum. Uma chave de sandbox em
  produção cobraria ninguém, em silêncio — e hoje não se sabe, sem abrir o
  Railway, se a fatura criada na `autohaus` foi dinheiro real.
- **Pronto quando:** subir com `ASAAS_API_URL=https://api-sandbox.asaas.com` e
  `NODE_ENV=production` mostra o aviso no boot e o selo na tela.
- **Custo:** 1 a 2 h. **Depende de:** nós. Copia o padrão de
  `contracts/assinatura/provedor.ts:103`.

### A3. Varredura de casa arrumada

Três itens pequenos que só ficam mais caros esperando:

- **`GET /fipe/variantes` sem chamador** (`fipe.controller.ts:49`) — armadilha
  nº 1 do CLAUDE.md. A tela usa `/fipe/estimate`, que já devolve `alternativas`.
  Apagar a rota (o método do serviço continua em uso) ou ligar a tela nela.
  **Pronto quando:** o cruzamento rota × chamada volta a ter só as 4 legítimas
  (callback do Google e os três webhooks).
- **Quatro frases desatualizadas no CLAUDE.md** — a do trial ("nada acontece
  quando vence", linha 451, quando a Onda 3 bloqueia desde 25/09) e três sobre a
  Asaas nunca ter falado com a Asaas (linhas 21, 595 e 798), que a conta em
  produção desmentiu.
- **`suppressHydrationWarning` no `<html>`** (`app/layout.tsx:40`) — o script de
  tema roda antes do React e o aviso de atributo extra aparece em toda carga em
  dev, escondendo aviso de hidratação de verdade quando aparecer um.

**Custo dos três:** ~1 h. **Depende de:** nós.

---

## Onda B — os três relógios que correm fora daqui

Nenhum destes é trabalho nosso de dias; é **pedir** e esperar. Por isso vêm no
começo: o custo de atrasar é o tempo do terceiro, não o nosso.

### B1. Revisão jurídica — o bloqueio mais antigo

- **O que:** advogado revisando **quatro** textos: o template de contrato de
  compra e venda, os Termos de Uso, a Política de Privacidade e o termo do
  programa de fundadores.
- **Por quê agora:** o sistema **já emite** documento com efeito jurídico a
  partir de um template declarado no código como ponto de partida, e as duas
  páginas legais já estão publicadas e ligadas no Branding do Google.
- **Como:** juntar os quatro num pedido de orçamento (o contrato sai do próprio
  produto: emitir um negócio de teste e baixar o PDF). Advogado de direito
  civil/consumidor com prática em revenda de veículos.
- **Pronto quando:** o template versionado no banco é o texto revisado, e o
  aviso "não revisado por advogado" sai do CLAUDE.md e da decisão.
- **Depende de:** terceiro. É o item que mais atrasa se ficar para depois.

### B2. Clicksign de produção

- **O que:** conta de produção (URL, token e webhook novos) e **uma assinatura
  de ponta a ponta** — que ainda falta até no sandbox.
- **Por quê agora:** o boot de produção loga `Clicksign em SANDBOX com
  NODE_ENV=production: as assinaturas não têm validade`. Assinatura de sandbox
  não vale nada, e é o que está ligado.
- **Como:** primeiro a assinatura de ponta a ponta no sandbox (confirma o
  cabeçalho do HMAC, o link do PDF assinado e o `signer.key` do webhook), depois
  a conta de produção. Nessa ordem: trocar a conta antes de validar o fluxo
  esconde o erro no ambiente que custa dinheiro.
- **Pronto quando:** um contrato assinado pelo comprador volta `signed` pelo
  webhook e o PDF assinado abre pela tela, sem o aviso de sandbox no boot.
- **Depende de:** terceiro (aprovação da conta) + B1 para ter validade de fato.

### B3. Fornecedor de consulta veicular

- **O que:** contratar um fornecedor (a estrutura está pronta: cache antes de
  idempotência, idempotência antes da chamada, custo por consulta medido no
  `/admin`).
- **Por quê agora:** sem `CONSULTA_FORNECEDOR` a API recusa em voz alta, e
  procedência é o que sustenta o selo na vitrine.
- **Como:** cotar 2 ou 3 (preço por consulta, cobertura de leilão/sinistro,
  contrato mínimo), escolher e escrever o adaptador — que é pequeno, porque a
  camada neutra já existe.
- **Pronto quando:** uma consulta real responde, cai no cache da loja e aparece
  no gasto do mês no painel do super admin.
- **Depende de:** contrato comercial.

---

## Onda C — Onda 2 do plano de paridade (3 a 4 semanas)

O piloto simulado já reordenou esta onda: os itens 12a, 12b e 12c foram feitos
em 25/09/2026. Sobram os três que o mercado cobra, na ordem do
[plano de paridade](plano-paridade-crm.md#onda-2--reordenada-pelo-piloto-simulado-25092026):

- **C1 — WhatsApp oficial (item 12).** Caixa de entrada dentro do sistema,
  conversa ligada ao lead e ao veículo, modelos aprovados. 11 dos 15
  concorrentes têm; sem isso a conversa fica fora do sistema e com ela o
  histórico e a medição do tempo de resposta — que é o argumento do Raio-X.
  **Antes de começar:** a decisão 2 do plano de paridade (a API da Meta cobra
  por conversa: embutido no preço ou adicional).
- **C2 — Entrada de leads dos portais (item 13).** Começar pela **ingestão**
  (webhook ou leitura da caixa que o portal já manda), OLX primeiro.
  **Antes de começar:** a decisão 3 (quais portais), que depende de onde as
  lojas fundadoras anunciam — pergunta de implantação.
- **C3 — Push do vendedor (item 14).** Service worker + web-push; hoje só
  funciona com a aba aberta, e o rodízio perde a razão se o vendedor não vê o
  lead a tempo.

**Pronto quando:** o lead do portal entra sozinho, cai no vendedor de plantão e
é respondido pelo WhatsApp sem ninguém copiar e colar.

---

## Onda D — portabilidade e o que ficou pela metade (~1 semana)

- **D1. Exportação completa dos dados da loja.** Existem
  `GET /leads/export/csv`, `salespeople.csv`, `deals.csv` e `inventory.csv`;
  faltam **agendamentos, conversas/mensagens e clientes vinculados**. A
  portabilidade da LGPD e a cláusula 6 do termo de fundador pedem que a loja
  leve tudo. **Pronto quando:** e2e baixa cada CSV com dois tenants e nenhum
  vaza dado do outro, e o arquivo abre no Excel com acento certo.
- **D2. Listagem de clientes da loja.** Hoje o modal de agendamento escolhe o
  cliente pelo lead; cliente com conta e **sem** lead na loja é inalcançável
  pela tela. Endpoint novo respeitando a policy `cliente_relacionado` (quem tem
  lead, agendamento ou conversa com a loja — não a base inteira).
- **D3. Motivo de perda consolidado no negócio.** O negócio grava
  `cancel_reason_code` e nenhuma tela agrupa por ele — o lead já tem contagem,
  o negócio mostra só no detalhe. É a pergunta "por que perdemos" respondida
  uma vez por mês.
- **D4. Aviso quando o CSV bate o teto.** Negócios e estoque exportam no máximo
  5.000 linhas e a loja que passa disso recebe um recorte **sem aviso**. O teto
  fica; o silêncio não.

---

## Onda E — dívidas com gatilho

Não são trabalho hoje. Cada uma tem o gatilho que a transforma em trabalho —
registrado para ninguém precisar redescobrir o porquê.

| Dívida | Gatilho |
|---|---|
| Teto por IP em memória de processo (`5 × réplicas`) | segunda réplica da API |
| Cron do SLA processa 200 leads por rodada | loja ligando o prazo com centenas de leads antigos |
| Relógio do SLA usa o expediente de uma filial só | loja com filiais em fusos diferentes |
| Devolução à fila não reatribui | vendedor reclamando de lead parado em "sem responsável" |
| Rodízio sem escala por turno nem férias por filial | loja com mais de 8 vendedores |
| Publicar confere o que está salvo, não o formulário aberto | reclamação de "falta cor" depois de digitar a cor |
| Domínio próprio da loja (`www.sualoja.com.br`) | loja com site próprio pedindo para migrar |
| Sem infraestrutura de feature flag | primeira funcionalidade que precise entrar desligada |
| API e banco em regiões diferentes (~0,6 s/consulta) | lentidão reclamada por cliente, não medida por nós |
| CVEs do Next (correção só na linha 15.x) | CVE explorável no nosso uso, ou a migração virar barata |
| Lead de troca fora da deduplicação | duplicata de troca aparecendo na operação real |
| ~20 `catch` silenciosos deliberados | nenhum — cada um tem o porquê comentado na linha |

---

## Adiado por decisão

- **NF-e — adiado em 27/09/2026** (decisão do Israel nesta auditoria). Os dois
  planos se contradiziam: a Fase 5 do plano de vendas previa emissor terceiro e
  o plano de paridade dizia que NF-e ficava fora. **Vale o adiamento**, e a
  contradição some apontando os dois para cá. Quando voltar: emissor terceiro
  (Focus NFe, NFe.io, Tecnospeed), nunca do zero — regra estadual muda e é um
  produto inteiro. O que pesa a favor de voltar: Auto Adm inclui NF-e em todos
  os planos e a Autoconf põe na faixa básica de mercado, então é motivo de "não
  troco de sistema" numa loja que já emite nota.
- **Financeiro da loja (fluxo de caixa, contas a pagar e receber).** A
  recomendação do levantamento é parar no DRE por veículo e comissão — não virar
  ERP. Falta só **registrar a decisão** em `docs/decisoes/`, que é meia hora e
  fecha o assunto.

---

## Como este plano se mantém vivo

Item resolvido é riscado em [estado-e-pendencias](estado-e-pendencias.md) com a
data e o commit, **e** marcado aqui. Achado novo entra primeiro lá, no formato da
seção "Pendências conhecidas", e só vira linha daqui quando tiver ordem e custo.
Plano que não é atualizado ao fechar item vira ficção em duas semanas.
