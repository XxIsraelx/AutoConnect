---
tipo: produto
data: 2026-09-24
---

# Roteiro de demonstração — 10 minutos

Para mostrar o AutoConnect a um dono de revenda, no celular ou no notebook,
usando a loja fictícia **Aurora Seminovos**.

Os dados saem do gerador `packages/db/prisma/demo.ts` — tudo fictício, tudo
datado em relação a hoje. Como renovar, o que ele cria e o que apagar está em
[Preparar a loja](#preparar-a-loja-antes-da-reunião), no fim.

> **A loja é de mentira e não esconde isso.** Razão social diz "loja de
> demonstração", e-mails são `@example.com`, CNPJ e CPFs saem de faixas que a
> Receita não emite, telefones são de um bloco que a Anatel não aloca. Se o
> cliente perguntar, a resposta é essa — e ela joga a favor: nada ali é dado de
> outro cliente.

---

## Antes de abrir a boca

- [ ] Rodar o gerador (ver o fim desta nota) **no mesmo dia** da reunião, de
      preferência de manhã. Ele planta lead de hoje, agendamento de hoje e de
      amanhã; rodado há uma semana, a tela abre parada. E rodado depois das
      18h, o agendamento "de hoje" cai fora do horário da loja, porque ele é
      marcado para mais tarde no mesmo dia.
- [ ] Anotar o **id do catálogo** que o script imprime — a URL
      `/catalogo/<id>` muda a cada execução.
- [ ] Deixar duas abas abertas: a loja pública e o painel já logado como
      **Ana Beatriz** (a vendedora). Trocar de usuário no meio custa 40
      segundos que você não tem.
- [ ] Celular no modo retrato. A demonstração inteira funciona em 375 px, e é
      assim que o vendedor dele vai usar.

### Quem é quem

| Papel | Entrar em `/login` com | Senha | Por que usar |
|---|---|---|---|
| Dono (`tenant_admin`) | `demo.dono@example.com` | `Demo@2026` | Vê dinheiro: margem, custo, comissão |
| Gerente | `demo.gerente@example.com` | `Demo@2026` | Vê tudo da equipe e o alerta de prazo estourado |
| Vendedora **Ana Beatriz** | `demo.ana@example.com` | `Demo@2026` | Carteira fechada: só os leads dela e a fila |
| Vendedor Rogério | `demo.rogerio@example.com` | `Demo@2026` | |
| Vendedor Wesley | `demo.wesley@example.com` | `Demo@2026` | |
| Cliente final | `demo.cliente.juliana@example.com` (e os outros nomes) | `Cliente@2026` | Entrar em `/entrar`, não em `/login` |

### Links

| O quê | Onde |
|---|---|
| Loja pública | `/c/demo` |
| Catálogo completo | `/catalogo/<id impresso pelo script>` |
| Mapa de concessionárias | `/buscar` |
| Painel | `/login` |

---

## O roteiro

### 0:00 — A vitrine, no celular `/c/demo`

Abra pelo celular, não pelo notebook.

> "Esta é a página que o seu cliente vê. Ela sai no ar sozinha: você cadastra o
> carro, publica, e ela já está aqui. Não tem site para contratar à parte."

Mostre: logotipo e cor da loja, endereço, botão de WhatsApp, os doze carros com
foto, preço e quilometragem, e os filtros por condição e preço.

**Não role até o fim.** Escolha um carro e toque.

### 1:00 — O visitante vira lead sem criar conta

No card do carro, toque em **Tenho interesse**. Preencha com um nome e um
telefone quaisquer (`(16) 90000-0099` serve) e envie.

> "Repare que ele não criou conta, não confirmou e-mail, não fez nada. Do lado
> de dentro, isso já virou um lead com dono."

Se sobrar tempo, toque em **Tenho um carro na troca** só para mostrar que
existe — mas não preencha.

### 2:00 — `/leads` — o lead que acabou de chegar

Entre no painel como **Ana Beatriz**. A tela abre em `/leads`.

Mostre, nesta ordem:

1. **O lead que vocês acabaram de criar**, no topo, com a etiqueta de prazo
   **correndo**. "O relógio é de 15 minutos, e só corre no horário da loja — um
   lead que chega sábado à noite não nasce atrasado."
2. **O responsável já preenchido.** "Ninguém distribuiu. O rodízio fez isso,
   por ordem de entrada na equipe. O vendedor consegue prever se o próximo é
   dele — é isso que muda a conversa na segunda-feira de manhã."
3. **O filtro "Estourado"**, no alto. Tem um lead de dois dias atrás que
   ninguém atendeu. "Esse aqui o gerente já foi avisado. Uma vez, não a cada
   cinco minutos."
4. **A carteira.** "A Ana está vendo os leads dela e os que estão na fila. Os
   do Rogério ela não vê. Isso é uma chave que você liga e desliga."

### 3:30 — Registrar o contato e parar o relógio

Abra o lead novo, toque no botão de **WhatsApp**.

> "Abriu o WhatsApp com o número já preenchido — e, do lado de dentro, ficou
> registrado que houve contato. O prazo parou aqui. Nota interna não conta:
> escrever sobre o cliente não é falar com ele."

Abra a **linha do tempo** de um lead antigo (o do Kicks, por exemplo) e mostre
a sequência: criado → distribuído → ligação → avaliação da troca → mudança de
status.

### 4:30 — `/agendamentos` — a agenda de hoje e de amanhã

> "A tela abre na semana. Test drive de hoje às 17h, entrega marcada para
> sexta, e ali atrás dois que não apareceram."

Mostre o indicador de **comparecimento** no topo. "Isso é o número que ninguém
tem na planilha: de cada dez test drives marcados, quantos viraram gente na
loja."

### 5:30 — `/negocios` — onde o dinheiro está

> "Aqui não é uma lista de vendas. É o funil por **valor**."

1. Aponte as etapas com dinheiro em cada uma — proposta, crédito, contrato,
   assinado, faturado.
2. Abra o **T-Cross (Renata Villela)**, que está em *assinado*.
3. Mostre a composição do pagamento (entrada + financiamento) e a linha do
   tempo do negócio.
4. Abra a aba do **contrato** e **baixe o PDF**.

> "O contrato sai com as duas partes qualificadas, CPF conferido, garantia
> legal declarada, e um código que prova que este arquivo é o mesmo que foi
> assinado. Se alguém mexer no modelo depois, o sistema recusa entregar o
> documento em vez de entregar um diferente."

⚠ **Diga também, sem ser perguntado:** o modelo de contrato ainda não passou
por advogado. É honesto e evita a única pergunta que derruba a reunião.

Se quiser um segundo momento: o **Renegade** está com contrato *emitido e não
assinado* — dá para assinar ali, na frente dele.

### 7:00 — `/veiculos` — publicar um carro ao vivo

Filtre por **Rascunho**. Há três:

- **Fiat Pulse** — completo. Toque em **Publicar**. Volte à aba da loja
  pública e recarregue: ele está lá. *Esse é o momento que vende.*
- **VW Gol** — o botão está desligado, dizendo "falta pelo menos uma foto".
- **Renault Kwid** — faltam cor e câmbio.

> "Cadastrar não é publicar. O carro só vai para a vitrine quando tem foto,
> preço conferido e ficha completa. O sistema não deixa você estrear um anúncio
> pela metade."

### 8:00 — `/relatorios` — o que o dono quer ver

Entre como **dono** (ou já tenha a aba aberta).

1. **Margem por venda**, mês a mês. "Isso é preço de venda menos o que o carro
   custou: compra mais preparação, mecânica e documentação. Congelado no
   faturamento — se você trocar o pneu depois, a margem da venda não muda."
2. **Giro do estoque**: quantos dias cada carro está parado.
3. **Desempenho por vendedor**: leads recebidos, atendidos, comparecimento,
   faturamento, margem e **comissão estimada**.

> "O vendedor só enxerga a linha dele. O número do colega não sai do banco."

### 9:00 — `/equipe` e `/configuracoes` — as duas chaves

- Em `/equipe`: metas do mês, plantão por vendedor ("ausente até" tira do
  rodízio sem ninguém lembrar de religar na volta), comissão por pessoa.
- Em `/configuracoes` → *Leads e atendimento*: o rodízio, o prazo de primeiro
  contato e a carteira. "São três chaves. Nenhuma delas é um projeto."

### Fechamento

> "Tudo o que você viu está funcionando, e o carro que a gente publicou há dois
> minutos está no ar. O que falta para a sua loja é colocar o seu estoque
> dentro. Quer que eu monte com você na semana que vem?"

---

## Se sobrar tempo (ou se perguntarem)

| Perguntaram sobre | Vá para | O que mostrar |
|---|---|---|
| "Como o cliente me acha?" | `/buscar` | A loja no mapa, com o número de carros no pino |
| "E a conversa?" | `/chat` | A proposta aceita pelo Marcelo, dentro do chat, que virou negócio |
| "Vocês avaliam meu usado?" | `/leads`, lead da Letícia | Oferta de troca com a avaliação registrada |
| "Perdi uma venda, por quê?" | `/leads`, faixa de motivos | Perdas agrupadas por motivo |

## O que **não** mostrar

- **Consulta veicular** (`/veiculos/[id]` → aba de consulta): o fornecedor real
  ainda não existe, e por isso a demonstração **não** tem nenhuma consulta
  plantada. Se abrir, a tela fica vazia. Se perguntarem, diga que é a próxima
  integração — não improvise um resultado.
- **Assinatura eletrônica externa** (Clicksign): o contrato da demonstração foi
  assinado **dentro** do sistema. O envio externo depende de conta de produção.
- **Admin global** (`/admin`): é a sua cozinha, não a dele.

---

## Preparar a loja antes da reunião

```bash
pnpm --filter @autoconnect/db run demo
```

| Variável | Efeito |
|---|---|
| *(nenhuma)* | Cria a loja. Se `demo` já existe, **não faz nada** |
| `DEMO_RESET=1` | Apaga e recria, com as datas recalculadas a partir de hoje |
| `DEMO_APAGAR=1` | Só apaga |

O script imprime, no fim, o link do catálogo e os dois logins principais.

**Renovar as datas** é rodar com `DEMO_RESET=1`. Tudo é relativo ao instante da
execução: os leads se espalham pelas últimas oito semanas, sempre com um de
hoje; a agenda tem hoje, amanhã e o resto da semana; os negócios faturados
caem no mês corrente, para a tela de equipe e o relatório de 30 dias terem
conteúdo. Uma demonstração montada há duas semanas mostra uma loja parada —
rode de novo.

### O que o gerador cria

Uma concessionária (`slug: demo`) com filial em Ribeirão Preto/SP, e dentro
dela:

- **Equipe de 5**: dono, gerente e três vendedores, com comissão, plantão e
  metas do mês corrente e do anterior.
- **25 seminovos** com foto, custo de aquisição e três custos de preparação
  cada. 12 publicados e disponíveis, 6 reservados, 4 vendidos, 3 em rascunho.
- **10 clientes finais** (contas globais, como na plataforma real).
- **26 leads** em todos os status e em oito origens, distribuídos pelo rodízio
  em ordem cronológica, com linha do tempo, prazo de primeira resposta e um
  estouro já notificado.
- **13 agendamentos**, incluindo test drive concluído, dois não comparecimentos,
  um hoje e dois amanhã.
- **11 negócios**, um em cada estágio do funil mais um cancelado, sendo quatro
  faturados com margem congelada.
- **6 contratos**, cinco assinados pelas duas partes dentro do sistema e um
  emitido à espera de assinatura.
- **3 conversas de chat**, uma com proposta aceita e uma com mensagem não lida.
- Avaliação de troca em dois lugares: um lead de troca avaliado e um usado
  aceito dentro de um negócio faturado.

### As fotos

Vêm do **Wikimedia Commons**, escolhidas modelo a modelo, todas sob licença que
permite uso comercial (CC0, domínio público, CC BY ou CC BY-SA). Autor, licença
e página de origem de cada arquivo estão na tabela `FOTOS` do
`packages/db/prisma/demo.ts`, e o crédito acompanha a imagem no texto
alternativo (`alt`).

> ⚠ CC BY e CC BY-SA **exigem atribuição**. Numa demonstração fechada, o
> crédito no `alt` e no script dá conta. Se alguma dessas fotos for parar em
> material público — site, anúncio, apresentação —, o crédito precisa ficar
> **visível ao lado da foto**.

Nenhuma foto foi copiada de anúncio de loja real, e nenhuma imagem é do estoque
de um cliente.

### Rodar em produção

A loja de demonstração convive com as lojas reais: ela é um tenant como
qualquer outro, e tudo o que o script escreve está dentro dele. As duas
exceções, deliberadas, são o catálogo global de marcas e modelos (upsert por
nome, nunca apagado) e os dez clientes finais, que na plataforma são contas
globais — todos com e-mail `demo.cliente.*@example.com`, apagados por essa
lista exata.

Antes de rodar em produção, confira que:

- o slug `demo` está livre;
- o CNPJ `11.222.333/0001-81` não está em uso por nenhuma loja (a coluna é
  única);
- ninguém depende dos e-mails `demo.*@example.com`.

`DEMO_APAGAR=1` remove a loja inteira por cascata. É irreversível.
