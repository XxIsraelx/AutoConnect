---
tipo: piloto
data: 2026-09-25
---

# Piloto simulado — o primeiro dia da Garagem Central

Segunda parte do piloto. A primeira ([operação](../../../../../Users/israelaureliano/Developer/AutoConnect/docs/produto/piloto-simulado-operacao.md))
encenou uma semana numa loja cheia de dados. Esta encena **o dia zero**: um dono
de revenda em Belo Horizonte, sozinho, achando o produto no site e tentando
deixar a loja de pé sem ninguém para explicar.

Papéis: **Márcio Tavares**, 52 anos, dono da Garagem Central (tenant_admin);
**Wesley Prado**, vendedor convidado; **Juliana Prado**, consumidora.
Telas exercitadas em **1024 px** (Parte A) e **375 px** (Parte B e conferências
de layout).

## Ambiente

- Banco **local de teste**, na mesma instância da suíte
  (`localhost:55432`), num banco **novo e vazio**: `autoconnect_dia1_test`.
  Não usei `autoconnect_test` porque **outras sessões estão rodando contra ele**
  com a loja de demonstração viva, e apagar as lojas de lá destruiria o trabalho
  delas. Migrations aplicadas com `DATABASE_URL` **e** `DIRECT_URL` no mesmo
  comando, apontando para esse banco. `.env` da raiz e `packages/db/.env` não
  foram lidos em momento nenhum.
- Cópia isolada do repositório em `scratchpad/wt-dia1` (`git worktree` do
  `d5a57c4`, HEAD destacado), para não sobrescrever o `.next` das outras
  sessões — o `NEXT_PUBLIC_API_URL` é embutido no build.
- **API em 4300, web em 3300** (3000/3100/3200 e 4000/4100/4200 estavam
  ocupadas). Scripts em `scratchpad/dia1-api.sh` e `dia1-web.sh`; logs em
  `dia1-api.log` e `dia1-web.log`. Nenhum processo alheio foi tocado.
- Nada de Railway, Supabase, Clicksign. E-mail, Supabase Storage, assinatura
  externa e consulta veicular desligados. Cloudinary **não configurada**, de
  propósito — é o caminho que o cliente real percorre se a variável faltar.
- **Nenhum código de produto foi alterado.** Nenhum commit, nenhum push.
- O gerador da demo **não** foi executado: a loja começou vazia, como pedido.

> **Ressalvas de método.** (1) Parte dos cliques foi disparada pelo handler do
> elemento, porque a ferramenta de navegador desalinha coordenada e viewport
> quando há emulação de tela grande; isso não afeta conclusões de fluxo e regra
> de negócio, mas significa que não testei área de toque de alvos pequenos.
> (2) Onde um defeito bloqueava o roteiro (upload de foto, aceite de convite,
> chave de troca), contornei **pelo banco** para seguir encenando — cada
> contorno está marcado no texto e é, ele próprio, o achado.
> (3) A consulta de CNPJ e de CEP sai do navegador para BrasilAPI e ViaCEP, e a
> FIPE sai da API para a Parallelum: são chamadas do próprio produto no fluxo de
> cadastro, não foram simuladas.

---

## 1. Os 17 passos

| # | Passo | | Uma frase |
|---|---|---|---|
| **A1** | Chega no site e acha onde se cadastrar | ❌ | Acha cinco botões "Criar conta grátis" — e todos levam a uma tela que diz que **o cadastro é restrito a convite da equipe AutoConnect**. Sozinho, ele para aqui. |
| **A2** | Cria a conta da loja | 🟡 | Com o convite na mão: 5 etapas, 22 campos, CNPJ **obrigatório e bloqueante** (B3), CPF e celular pessoal do dono antes de ele ver qualquer tela. Erros por campo são bons. |
| **A3** | Confirma e-mail / primeiro login | ✅ | Não há confirmação: o convite já provou o e-mail, a conta nasce verificada e cai logada no painel. Decisão certa. |
| **A4** | Primeira tela: sabe o que fazer? | ✅ | Existe onboarding — "Primeiros passos, 0 de 4". Melhor momento do dia zero. (Dois dos quatro itens são inalcançáveis — ver A5 e A7.) |
| **A5** | Cadastra o primeiro veículo, com foto | ❌ | O catálogo de marcas de um banco novo está **vazio**: ele digita "Chevrolet" e "Onix" à mão, num catálogo global. E a foto falha com **"Falha ao enviar uma das imagens"**, sem dizer por quê (B1). |
| **A6** | Publica e confere a vitrine | ❌ | **Sem foto o botão "Publicar" nasce desabilitado** — correto, e fatal: com a Cloudinary ausente nenhum carro chega à vitrine. Com uma foto inserida à mão, a vitrine sai bonita — com o telefone da loja errado (B6). |
| **A7** | Horário, endereço no mapa, dados da loja | ❌ | **O horário de funcionamento não salva** (B4): o Zod da API descarta o campo, a tela diz "Endereço salvo!" e o banco continua `{}`. O mesmo com "Telefone principal" e "Aceitar veículo na troca" (B5). Não existe campo de coordenada. Em 375 px o horário de fechamento fica cortado fora do cartão (B12). |
| **A8** | Convida um vendedor por e-mail | ❌ | O convite é criado e o link existe, mas **a tela de aceite chama uma rota que não está registrada**: `Cannot POST /api/v1/public/invitations/accept` (B2). Nenhum vendedor entra na loja. |
| **A9** | Define meta e comissão | ✅ | Meta da equipe e por vendedor gravam; a comissão grava e a tela cita a base ("2,5% sobre R$ 0,00 — valor de venda dos negócios faturados no mês"). A correção de 25/09 aparece. |
| **A10** | Dashboard numa loja quase vazia | 🟡 | Ajuda mais do que envergonha — o checklist dá o que fazer. Mas dois dos quatro itens **nunca ficam verdes**: o horário não salva e o logo só aceita URL de imagem já hospedada. |
| **B11** | `/buscar` sem conta: acha a loja? | 🟡 | Acha, e o mapa é bonito. Mas o cartão da loja diz **"0 veíc."** com o estoque publicado (B7), e o pin cai no **centro de Belo Horizonte**, não no endereço (B8). A aba "Veículos" acha o carro por busca textual. |
| **B12** | Demonstra interesse **sem criar conta** | ✅ | O melhor fluxo do produto. Consentimento LGPD com o texto copiado para o lead, mensagem de sucesso clara, rodízio atribuiu ao Wesley, prazo de resposta calculado. O segundo envio virou interação `duplicate` no mesmo lead, sem lead novo. |
| **B13** | Pede avaliação do carro na troca | ❌ | O botão **não existe**: a chave "Aceitar veículo na troca" não salva (B5). Ligada à força no banco, o formulário funciona — e o lead que ele gera entra **sem dono, sem prazo, sem consentimento LGPD e sem telefone normalizado** (B9). |
| **B14** | Cria conta, favorita, salva busca, cria alerta | 🟡 | Tudo funciona. Mas o cadastro do consumidor tem **3 etapas e pede CPF, data de nascimento e endereço completo** para favoritar um carro, e "salvar busca" está atrás de um ícone sem rótulo, dentro de um painel, num link de 11 px. |
| **B15** | Agenda uma visita pela página pública | 🟡 | Agendou **domingo, 27 de setembro às 18:30** — com a loja fechada, sem vendedor atribuído e sem vínculo com o lead que ela já tinha criado (B10). |
| **C16** | Os leads chegaram? Atribuídos? Relógio andando? | 🟡 | O lead do site: sim, com "NO PRAZO · faltam 7h" e o nome do Wesley. O de troca: aparece, com o Fiat Argo e "a avaliar", mas com **"Atribuir"** e **sem etiqueta de prazo**. |
| **C17** | Responde pelo chat e fecha até o negócio | 🟡 | O negócio abre pelo card do lead e anda pela máquina de estados (Rascunho → Proposta), com preço negociável, margem, comissão e contrato bloqueado com o motivo na tela. **O chat, não:** o botão "Conversar" só aparece para lead com conta vinculada, e o lead anônimo — o da Onda 0 — nunca tem (B11). |

**Contagem:** 3 ✅ + 7 🟡 + 7 ❌.

---

## 2. Onde ele desiste

Há três paredes, e todas caem no mesmo dia.

**A primeira, e a que decide: o site vende autoatendimento e o produto é por
convite.** A home tem "Criar conta grátis" no topo, "Criar conta grátis" no
rodapé, "Começar trial", "Assinar Pro" e "Falar com vendas" — **os cinco levam
para `/signup`**, que responde: *"O cadastro de concessionárias é restrito. Você
precisar de um link de convite enviado pela equipe AutoConnect."* (o "precisar"
é do produto). O único caminho é um `mailto:contato@autoconnect.app`. O dono que
chegou por indicação, num sábado, às 21h, não cria conta nenhuma. Pior: **não
existe caminho para criar o primeiro super admin** — nem seed, nem script, nem
variável. Num banco recém-migrado ninguém pode emitir o convite, então *ninguém
pode criar a primeira loja*. Tive de inserir o super admin por SQL para começar
o piloto.

**A segunda, para quem passou da primeira: ele não consegue pôr um carro no
ar.** Sem a Cloudinary configurada, toda foto falha com *"Falha ao enviar uma
das imagens"* — sem dizer que é configuração, sem botão de tentar de novo, sem
alternativa. E a regra de publicação, que é boa, exige pelo menos uma foto. O
resultado é um dono que cadastrou o carro, viu "Rascunho — fora do catálogo
público", leu *"Para publicar, falta pelo menos uma foto"*, tentou cinco vezes
com cinco fotos diferentes e concluiu que o sistema está quebrado. Ele não tem
como saber que o problema é uma variável de ambiente.

**A terceira, para o teimoso: ele fica sozinho.** Convida o vendedor, o vendedor
clica no link, digita nome e senha e recebe **`Cannot POST /api/v1/public/invitations/accept`**
na cara — texto cru do Express, numa tela de boas-vindas. Não há contorno na
interface. Um CRM em que só o dono entra não é um CRM.

O ponto exato, em uma frase: **ele desiste no primeiro clique em "Criar conta
grátis"; quem o trouxe pela mão desiste na foto do primeiro carro; e quem
resistir aos dois desiste quando o vendedor não consegue entrar.**

---

## 3. Bugs

> **Nove foram corrigidos em 25/09/2026** — B1, B2, B4, B5, B6, B9, B10, B12 e
> B13, mais o teto de fotos do B17. O relatório fica como está: é o registro do
> que foi encontrado, com a marca de correção em cada item. O que **não** foi
> mexido, por ser decisão de produto: B3 (CNPJ da BrasilAPI), B7 (`branch_id` do
> veículo e a contagem do mapa), B8 (coordenada da filial), B11 (chat do lead
> anônimo), B14 (`?vehicleId` × `?v=`), B15 (catálogo global de marcas sem papel
> nem Zod), B16 (FIPE escolhendo a variante errada) e o resto do B17.

Ordenados por quanto custam. Os quatro primeiros impedem o uso.

### B1 — Foto de veículo falha em silêncio sem a Cloudinary, e sem foto não há vitrine

> ✅ **Corrigido em 25/09/2026.** Um módulo só (`apps/web/src/lib/uploadDeFotos.ts`)
> fala com a Cloudinary — foto de veículo **e** avatar, que tinha a mesma cópia do
> `fetch`. Ele confere a configuração antes de tentar e distingue "não configurado
> neste ambiente" de "falhou o envio" (a mensagem da Cloudinary é repetida, para
> o lojista saber se o problema é a foto dele). A ausência aparece em três
> lugares: no `next.config.mjs` (build e subida do web, como o `DocumentosStorage`
> faz no boot da API), no console do navegador e numa faixa em `/configuracoes`,
> `/veiculos/novo` e `/veiculos/[id]` — **antes** de a pessoa tentar.
> `servicos-externos-do-web.spec.ts` impede a chamada direta de voltar para dentro
> de uma página.
**Gravidade: a mais alta. Trava o produto inteiro num ambiente novo.**

1. Subir o web sem `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME` / `..._UPLOAD_PRESET`.
2. `/veiculos/novo` → etapa "Fotos" → escolher qualquer imagem.
3. A miniatura some e aparece **"Falha ao enviar uma das imagens."**
   Na tela do veículo, **"Falha no upload da imagem"**.

`uploadToCloudinary` (`veiculos/novo/page.tsx:32` e `veiculos/[id]/page.tsx`)
monta `https://api.cloudinary.com/v1_1//image/upload` com o nome vazio e não
confere nada antes. Não há aviso na inicialização, não há aviso na tela, não há
como o usuário saber a causa. E `domain/anuncio.ts` exige **uma foto** para
publicar — então, sem essa variável, **nenhum carro chega ao catálogo público**
e o produto não faz o que vende.

O contraste é interno: a API loga com honestidade *"SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY
ausentes: documentos não serão arquivados"* no boot. A Cloudinary, que é mais
crítica, não diz nada.

### B2 — `PublicInvitationsController` não está registrado: nenhum convidado entra na equipe

> ✅ **Corrigido em 25/09/2026.** O controller entrou em `controllers:` do
> `InvitationsModule`. O fluxo inteiro tem e2e (`convite-equipe.e2e-spec.ts`):
> convidar → aceitar → token expirado → token já usado → token inexistente →
> corpo inválido. E `controllers-registrados.spec.ts` cruza todo `@Controller(`
> com os `controllers:` dos módulos, porque controller órfão não é erro de
> compilação. **Era o único do projeto.**
**Gravidade: alta. Quebra a formação da equipe.**

1. `/equipe` → "Convidar" → e-mail → o convite aparece em "Convites pendentes".
2. Abrir o link (`/invite/<token>`), preencher nome e senha, enviar.
3. **`Cannot POST /api/v1/public/invitations/accept`** aparece dentro do card,
   como texto cru.

`apps/api/src/modules/invitations/invitations.module.ts` lista só
`InvitationsController` em `controllers`. O `PublicInvitationsController`
(mesmo arquivo do controller privado, linha 66) existe, tem `@Public()` e
`@Post('accept')` — e nunca é montado. Confirmado por `curl`: 404.
**Nenhum e2e cobre a rota** (`grep "public/invitations" apps/api/test` → nada).

É o caso puro da armadilha nº 1 do CLAUDE.md, invertido: a tela existe, o
serviço existe, o teste bate no serviço, e o fio entre eles está solto.

### B3 — CNPJ que a BrasilAPI não conhece bloqueia o cadastro, sem saída
**Gravidade: alta. Fecha a porta de entrada de forma intermitente.**

1. `/signup` → etapa Empresa → digitar um CNPJ qualquer que a BrasilAPI não
   devolva (empresa nova, ou simplesmente um `429` de limite de uso).
2. A tela mostra **"CNPJ não encontrado"** e "Próximo" recusa com
   **"CNPJ não encontrado na Receita Federal"**.

`SignupContent.tsx:236` — `if (!res.ok) { setCnpjStatus('invalid'); return; }`.
Qualquer resposta não-2xx (404, 429, 500, manutenção) vira "CNPJ inválido", e
`validateFields` bloqueia o passo. A falha de **rede** está tratada com cuidado
(`catch` → `idle`, segue à mão); a falha **HTTP** não. Um serviço gratuito de
terceiro, sem chave e com limite de requisições, é hoje um ponto único de falha
do cadastro.

**Efeito colateral no mesmo lugar:** quando o preenchimento automático dá certo,
os erros por campo que já estavam na tela **não somem** — "Informe a razão
social" continua aceso ao lado do campo já preenchido com a razão social. O
`set()` limpa o erro do campo (linha 216), mas o preenchimento automático usa
`setForm` direto e pula essa limpeza.

### B4 — "Horário de funcionamento" nunca é salvo, e a tela diz que salvou

> ✅ **Corrigido em 25/09/2026.** `businessHours` entrou em `createBranchSchema`
> com forma validada (dia 0–6, `HH:MM`, fechamento depois da abertura — um dia
> invertido é silenciosamente ignorado pelo cálculo do SLA). O horário salva, o
> item do onboarding fica verde e o relógio do SLA passa a usar o expediente real.
**Gravidade: alta. Mente para o usuário e contamina o SLA.**

1. `/configuracoes` → "Horário de funcionamento" → mudar sábado para 17:00.
2. "Salvar filial" → toast verde **"Endereço salvo!"**.
3. Recarregar: volta 13:00. No banco, `business_hours` continua `{}`.

A tela envia `businessHours` (`configuracoes/page.tsx:319`), mas
`updateBranchSchema` (`packages/shared/src/schemas/tenant.ts:55`) é
`createBranchSchema.omit({isHeadquarters}).partial()` e **`createBranchSchema`
não tem `businessHours`** — o Zod descarta em silêncio e o Prisma nunca vê o
campo.

Três consequências, todas na primeira semana:
- o item "Configure o horário de funcionamento" do onboarding usa `hasHours`
  (`tenants.service.ts:249`, exige objeto não vazio) e **nunca fica verde**;
- o horário nunca aparece para o cliente na busca, embora o rótulo prometa;
- **o relógio do SLA roda no padrão do shared** (seg–sex 09–18, sáb 09–13) em
  vez do expediente real da loja. Uma loja que abre 08h e fecha 19h recebe
  alerta de prazo estourado fora de hora — exatamente o alarme falso que a Onda 1
  queria evitar.

Os defaults exibidos na tela pioram o quadro: ela **mostra** 09–18 como se
estivesse configurado, então o dono nem desconfia.

### B5 — "Telefone principal" e "Aceitar veículo na troca" também são descartados pelo Zod

> ✅ **Corrigido em 25/09/2026.** Os dois campos entraram no `updateTenantSchema`,
> e **a classe foi fechada**: os schemas de `/tenant/me` e `/tenant/branch/:id`
> são `.strict()` — campo desconhecido vira 400 com o nome do campo (o `ZodFilter`
> passou a traduzir `unrecognized_keys` para `fieldErrors`), em vez de sumir.
> `corpos-do-web.spec.ts` varre os `api(...)` de escrita do `apps/web`, extrai as
> chaves de cada corpo e confere contra o schema da rota. Ele achou um **quarto**
> caso: `PATCH /vehicles/:id` mandava `status` (o `select` "Status *" da tela do
> veículo) e `updateVehicleSchema` não o tinha — reservar, arquivar ou pôr em
> manutenção pela tela não funcionava. `sold` continua fora: quem o grava é o
> faturamento do negócio, junto de `soldAt` e da margem congelada.
**Gravidade: alta. Desliga a funcionalidade de troca inteira.**

1. `/configuracoes` → ligar "Aceitar veículo na troca" → "Salvar".
2. Toast **"Dados da concessionária salvos!"**. Recarregar: desligado.
3. `curl -X PATCH /tenant/me -d '{"acceptsTradeIn":true}'` → **200**, banco `f`.

`configuracoes/page.tsx:279-284` envia `primaryPhone` e `acceptsTradeIn`;
`updateTenantSchema` (`shared/src/schemas/tenant.ts:4`) não tem nenhum dos dois.
Com a chave travada em `false`, o botão "Tenho um carro na troca" nunca é
renderizado (`CatalogoContent.tsx:714`) e **toda a troca — tabela `trade_ins`,
rota `POST /catalog/trade-in`, origem `trade_in` no relatório, avaliação no
drawer do lead — fica inalcançável em qualquer loja nova.**

**O padrão vale mais que os três casos.** A armadilha nº 3 do CLAUDE.md ("todo
corpo passa por Zod") criou uma classe nova de defeito: o Zod descarta em
silêncio e a tela comemora. `mass-assignment.e2e-spec.ts` prova que campos
proibidos são **recusados**; nada prova que os campos que a tela **manda** são
**aceitos**. Um teste que percorra cada `body:` do `apps/web` e confira que o
schema correspondente o reconhece pegaria os três de uma vez.

### B6 — A máscara de telefone estraga o número fixo da loja, no banco

> ✅ **Corrigido em 25/09/2026.** `mascararTelefoneBr` (shared) agrupa 4+4 até dez
> dígitos e 5+4 no décimo primeiro: `3132718080` → `(31) 3271-8080`. Uma
> implementação só, usada por `/signup`, `/cadastrar` e `/configuracoes`.
> O botão de WhatsApp passou por `escolherWhatsApp`, que **só** aceita celular e
> devolve `null` para fixo — e aí o botão não é renderizado, o que é melhor que
> um link para uma conversa que não existe. Campo de WhatsApp separado do
> telefone comercial continua faltando (ver §4).
**Gravidade: média-alta. O número público da loja sai errado.**

1. `/signup` → etapa Endereço → "Telefone comercial" (cujo *placeholder* é
   `(11) 3000-0000`, um fixo) → digitar `3132718080`.
2. A tela formata **`(31) 32718-080`** e grava assim.
3. `/c/garagem-central` exibe `(31) 32718-080` e o botão WhatsApp aponta para
   `wa.me/553132718080`.

`fmtPhone` (`SignupContent.tsx:29`) agrupa sempre 5+4 dígitos, o formato de
celular. Fixo de 8 dígitos sai quebrado. O dono vê o próprio telefone errado na
página pública no primeiro dia — e é o tipo de erro que corrói a confiança em
tudo o mais.

**Junto:** o botão **WhatsApp** da vitrine e do catálogo aponta para esse mesmo
número fixo. Não existe campo de WhatsApp separado do telefone comercial, então
a loja que informa um fixo publica um botão de WhatsApp que não leva a lugar
nenhum.

### B7 — O mapa anuncia "0 veíc." com o estoque publicado
**Gravidade: média-alta. Quebra a tela de descoberta.**

1. Publicar um veículo pelo `/veiculos/novo`.
2. `/buscar` → aba "Lista" → "Lojas": o cartão diz **"0 veíc."**.

`map.service.ts` conta `branch._count.vehicles` — veículos **da filial**. O
assistente de cadastro **nunca atribui `branch_id`**, então todo veículo criado
pela tela nasce com `branch_id = NULL` e nenhuma loja jamais conta nada. A busca
textual por "Onix" acha o carro; o cartão e o balão do pin dizem que a loja está
vazia. Confirmado em `GET /api/v1/map/dealerships`: `"vehiclesCount": 0`.

### B8 — O pin (e a rota do Google Maps) apontam para o centro da cidade
**Gravidade: média.**
Não há campo de latitude/longitude em lugar nenhum da interface, embora
`createBranchSchema` os aceite. O `map.service.ts:77` geocodifica **só o
município** sob demanda e persiste. Resultado: a Garagem Central, na Rua dos
Aimorés, aparece em `-19.9227,-43.9451` (Praça Sete, ~1,5 km), e o botão "Como
chegar" leva o cliente para lá. Duas lojas na mesma cidade caem no mesmo ponto.

### B9 — O lead de troca é um lead de segunda classe

> ✅ **Corrigido em 25/09/2026.** A conta de dono e relógio saiu de dentro do
> `LeadsService` para `AtribuicaoDeLead` (módulo CRM), e o formulário de troca
> passou por ela: rodízio, prazo de primeiro contato, interação `created` na
> timeline. O telefone virou **obrigatório** e é guardado na forma canônica; o
> consentimento LGPD entrou no formulário e é gravado por cópia, como no
> formulário irmão. **Deduplicação continua não se aplicando à troca, de
> propósito**: quem oferece dois carros fez duas propostas, cada uma com placa,
> quilometragem e valor próprios.
**Gravidade: média-alta. É o lead mais valioso de uma revenda.**

Depois de enviar uma proposta de troca pelo catálogo, a linha em `leads`:

| campo | lead do site | lead de troca |
|---|---|---|
| `assigned_to` | Wesley (rodízio) | **nulo** |
| `first_response_due_at` | 25/09 12:15 | **nulo** |
| `consented_at` / `consent_text` | preenchidos | **nulos** |
| `contact_phone_normalized` | `31988774455` | **nulo** (o telefone cru está lá) |

Ou seja: não entra no rodízio, **não tem relógio de prazo** (logo, nunca estoura
e o gerente nunca é avisado de que foi ignorado), **não tem registro de
consentimento** — embora o formulário colete nome, e-mail, telefone e placa, e o
formulário irmão na mesma página exija aceite explícito — e **não participa da
deduplicação**, porque a comparação é pelo telefone canônico que ele não tem.
A Onda 1 diz "aplicado nos três caminhos de criação"; a troca é um quarto
caminho que ficou de fora.

### B10 — Agendamento público aceita domingo às 18:30, sem vendedor e sem lead

> ✅ **Corrigido em 25/09/2026.** Os horários passaram a sair do `businessHours`
> da filial (`horariosDoDia`, no shared), e a API refaz a conferência
> (`dentroDoExpediente`) — tela não valida nada em tempo de execução. Data no
> passado e loja inexistente também são recusadas. E o agendamento entra no lead
> **aberto da mesma pessoa** nessa loja, preferindo o do mesmo veículo, herdando
> dele o vendedor responsável. Marcar pela loja (`POST /appointments/dealer`)
> **não** passa pela conferência: entrega combinada fora do horário é decisão da
> loja, não engano do cliente.
**Gravidade: média.**

1. Catálogo → "Agendar test drive" → escolher **domingo** e **18:30**.
2. **"Agendamento solicitado! Test drive em domingo, 27 de setembro às 18:30."**

Os horários oferecidos são fixos de 08:00 a 18:30, e a data aceita qualquer dia:
nem a tela nem a API consultam o expediente da filial. No banco,
`salesperson_id` é nulo (não há rodízio para agendamento) e `lead_id` é nulo —
a visita **não é ligada ao lead que a mesma pessoa criou para o mesmo carro
minutos antes**. A loja recebe três registros soltos da mesma cliente (lead do
site, lead de troca, agendamento) e não tem como saber que são a mesma pessoa.

### B11 — Lead anônimo não tem chat: a Onda 0 e o chat não se encontram
**Gravidade: média-alta.**
`leads/page.tsx:1114` — o botão "Conversar" é renderizado sob
`{lead.customer?.id && ...}`. O lead da Onda 0 nasce **sem conta** por
definição, então o botão nunca aparece. O único contato possível é o link de
telefone ou o de WhatsApp — que, no caso de uma loja com telefone fixo, não
funciona (B6). O produto anuncia "Chat em tempo real" na home e "Converse com
clientes diretamente pela plataforma"; para o lead que ele mesmo captura, não há
conversa.

### B12 — Em 375 px o horário de fechamento fica fora da tela

> ✅ **Corrigido em 25/09/2026.** A linha do expediente passou a quebrar
> (`flex-wrap`, horários em `basis-full` abaixo de `sm`) e os campos de CEP e
> cidade ganharam duas colunas em vez de três. Medido a 375 px: 367/367, sem
> overflow, e os sete horários de fechamento visíveis.
**Gravidade: média (o dono usa o celular).**
`/configuracoes`, a 375 px: a seção da filial tem `scrollWidth 501` para
`clientWidth 301`. Cada linha do expediente mostra o dia, o switch, a hora de
abertura e **corta o "às ___"** — o horário de fechamento não é visível nem
alcançável, sem barra de rolagem aparente. CEP ("301400") e Cidade ("Belo Ho")
também aparecem cortados. Mesmo que o campo salvasse (B4), no celular ele não
seria editável.

### B13 — `/catalogo/<id>` derruba a página pública com 500 quando o id não é de loja

> ✅ **Corrigido em 25/09/2026.** Os dois lados: `GET /catalog/dealer/:id`,
> `/catalog/slug/:slug` e `/catalog/vehicles/:id` respondem **404** em vez de 200
> vazio, e `fetchDealerMeta` faz `await res.json()` (devolver a promessa de dentro
> do `try` anulava o `catch`). A página inteira vira "Não encontramos esta
> página", sem o cabeçalho com "??" e sem botão de tentar de novo — 404 não
> melhora com repetição.
**Gravidade: média.**

1. Abrir `/catalogo/<qualquer-uuid-que-não-seja-tenant>`.
2. **"Application error: a server-side exception has occurred."**

Dois defeitos encadeados:
- **API:** `GET /catalog/dealer/:id` devolve **200 com corpo vazio** para id
  inexistente, em vez de 404 (`curl -i` confirma `Content-Length: 0`).
- **Web:** `fetchDealerMeta` (`app/catalogo/[id]/page.tsx:14`) faz
  `return res.json() as Promise<DealerMeta>` **dentro** do `try` — devolver a
  promessa em vez de aguardá-la faz o `catch` nunca disparar. O
  `SyntaxError: Unexpected end of JSON input` sobe e mata o `generateMetadata`.

O comentário no próprio arquivo diz "sem isso cai no título genérico" — a
intenção estava certa, a implementação não. Qualquer link velho, compartilhado
no WhatsApp, vira uma tela branca de erro para o consumidor.

### B14 — O carro clicado na página da loja não abre
**Gravidade: baixa-média (um clique a mais, e o link compartilhado não funciona).**
`c/[slug]/PublicDealerClient.tsx:365` linka para
`/catalogo/<tenant>?vehicleId=<id>`, mas `CatalogoContent.tsx:874` lê
**`?v=`**. Clicar no carro na vitrine da loja abre a lista do catálogo, não o
carro.

### B15 — `POST /catalog/brands` e `/brands/:id/models` sem papel e sem Zod
**Gravidade: média (dado global compartilhado entre todos os inquilinos).**
`catalog.controller.ts:30` e `:36` não têm `@Roles`; o guard global só exige
estar autenticado. **Qualquer usuário logado, inclusive um `customer`**, insere
linha no catálogo global de marcas e modelos. O corpo é apenas *anotado*
(`@Body() body: { name: string }`) e o serviço só checa `length < 1` — é a
armadilha nº 3 do CLAUDE.md viva numa rota de escrita. A poluição que o piloto
anterior viu no banco de teste (`Marca 4qtdeq0e`, …) tem exatamente essa porta.

### B16 — A FIPE erra o modelo e culpa o cadastro do lojista
**Gravidade: média (é o recurso que mais impressiona numa demonstração).**

1. Cadastrar Chevrolet Onix 2022, flex, versão "1.0 Turbo".
2. Etapa Preço: **"Não encontramos este veículo na tabela FIPE — confira marca,
   modelo e ano."**

Reproduzido fora do app contra a mesma API pública: a marca casa
(`"Chevrolet"` × `"GM - Chevrolet"` = 60, no limite). O modelo com versão
pontua 45 (abaixo do mínimo 50), então cai no modelo sozinho — e aí **38
variantes do Onix empatam em 80 pontos**, com `score > bestScore` ficando com a
primeira da lista: **"ONIX Lollapalooza 1.0 F.Power 5p Mec."**, cujo único ano é
**2014**. Sem 2022, `matchYear` devolve nulo e a tela manda o lojista conferir um
cadastro que está certo. (Fiat Argo 2019 funcionou: `fipeReference: 49864`.)

### B17 — Pequenos, todos visíveis no primeiro dia
- A home exibe uma barra de navegador falsa com **`localhost:3000/dashboard`**
  escrito (`app/page.tsx:74`). É a primeira dobra do site.
- A home traz **três depoimentos inventados** com nome e empresa ("Carlos
  Mendes, Auto Mendes") e *"Junte-se a centenas de concessionárias"*, com zero
  clientes. Também promete **"Confirmações automáticas por e-mail e WhatsApp"**
  e **"Chat + WhatsApp"** no plano Pro — o WhatsApp é a Onda 2, item 12.
- **"Falar com vendas"** (Enterprise) e **"Assinar Pro"** vão os dois para
  `/signup`. Não existe cobrança (Onda 3): quem clicar em "Assinar Pro" entra num
  trial sem forma de pagar. `trial_ends_at` nasce **nulo** — o trial de 14 dias
  anunciado não tem data de fim gravada.
- `/configuracoes` → Plano exibe **"Status: Active"**, em inglês.
- `/equipe` mostra **"0 / 6vendas"** (sem espaço) e "Comissão estimada —" em vez
  de R$ 0,00.
- `/agendamentos` escreve **"Domingo, 27 De Set."** (título em caixa alta
  aplicado a uma data em português).
- ~~O assistente de cadastro diz **"Até 12 imagens"**; a tela do veículo, **"máx.
  10 fotos"**.~~ ✅ 25/09/2026 — uma constante só (`MAX_IMAGENS = 12`) nas duas telas.
- O texto ao lado do interruptor de plantão é **fixo** (`equipe/page.tsx:486`):
  diz *"Desligado, sai do rodízio…"* mesmo para quem está de plantão. O piloto
  anterior anotou "o texto é o mesmo nos dois estados"; é pior — ele **afirma**
  o estado errado.
- `sales_goals.target_value` (meta em reais, da migration
  `sales_goal_meta_em_reais`) não tem tela, nem API, nem uso: `grep targetValue`
  no `apps/web`, `apps/api` e `packages/shared` não devolve nada.
- Criar dois convites de equipe para o mesmo e-mail é aceito sem aviso: dois
  links válidos, dois cartões idênticos em "Convites pendentes".

---

## 4. Atrito de cadastro

### O que é pedido e não precisava ser (loja)

| Pedido | Por que incomoda |
|---|---|
| **CPF do responsável** (obrigatório, etapa 3 de 5) | O produto ainda não mostrou uma tela. CPF só é necessário na emissão do contrato — e lá já existe "Representante legal" em `/configuracoes`, com CPF próprio. Pedir documento antes do valor é o pedido mais caro do formulário. |
| **Celular pessoal do dono** (obrigatório) | Rotulado "Usado apenas para contato interno". É o telefone do vendedor do AutoConnect, não do produto. |
| **Slug (URL pública)** (obrigatório) | "Slug" não é palavra de revendedor. Ele é derivado do nome fantasia quando a Receita responde — mas quando ela não responde (B3), o dono precisa inventar um, obedecendo "apenas letras minúsculas, números e hífen". |
| **Razão social + nome fantasia + e-mail da loja + e-mail de acesso** | Quatro campos que na prática são dois. O e-mail de acesso e o e-mail da loja são quase sempre o mesmo, e nada oferece copiar. |
| **Endereço completo** antes de existir um carro | Ele precisa do endereço para a vitrine, mas não para ver o produto funcionar. Poderia vir depois do primeiro veículo. |

São **22 campos em 5 etapas** antes de ver o painel. Um concorrente que pede
e-mail, senha e nome da loja ganha esse dono antes da etapa 2.

### O que falta ser pedido

- **Coordenada da loja** (ou confirmação do pino no mapa). Hoje o mapa — a tela
  que o produto usa como diferencial — sempre aponta para o centro da cidade.
- **WhatsApp da loja**, separado do telefone comercial. O botão de WhatsApp já
  existe em vitrine e catálogo, apontando para um número que pode ser fixo.
- **Horário de funcionamento na hora do cadastro**, não escondido em
  configurações. Ele alimenta o relógio do SLA, a agenda pública e o cartão do
  mapa; hoje a loja nasce com o padrão do shared e ninguém sabe.
- **Percentual de comissão padrão da loja**, para não configurar pessoa a
  pessoa num drawer.
- **Nada sobre o estoque**: o sistema nunca pergunta "quantos carros você tem?"
  nem oferece importar planilha. A revenda média tem 20 a 60 carros e vai
  cadastrar um por um, em quatro etapas cada.

### Atrito do consumidor (Parte B)

O cadastro do cliente final tem **3 etapas** e pede **CPF, data de nascimento e
endereço completo** — tudo opcional, mas sem nada dizendo que é opcional (o
botão diz "Próximo", não "Pular"). Para favoritar um carro. E, ao contrário do
lojista, **ele precisa confirmar o e-mail para entrar** ("Você só consegue
entrar após confirmar"), numa tela que **não tem botão de reenviar**: se o
e-mail não chegar, o caminho é se cadastrar de novo — com um e-mail que já está
em uso.

---

## 5. O que o produto deveria fazer sozinho

1. **Nascer com o catálogo de marcas e modelos preenchido.** Hoje o primeiro
   lojista digita "Chevrolet" e "Onix" à mão, num catálogo **global**, sem papel
   exigido e sem validação (B15) — e o que ele digitar aparece para todas as
   outras lojas. A FIPE já é consultada pela API: a mesma fonte poderia semear as
   marcas na migration.
2. **Dizer quando ele mesmo está mal configurado.** A ausência da Cloudinary é
   invisível para quem usa e fatal para o negócio. A API já dá o exemplo certo no
   boot com o Supabase Storage; o upload de foto precisa de uma checagem antes do
   `fetch` e de uma mensagem que diga "envio de fotos indisponível — fale com o
   suporte", não "falha ao enviar".
3. **Confirmar o que salvou, e recusar o que não salva.** Três campos de
   `/configuracoes` somem no Zod e a tela comemora (B4, B5). Um corpo com campo
   desconhecido deveria ser **recusado** (`.strict()`), não silenciosamente
   podado — hoje o dono não tem como distinguir "salvou" de "fingiu".
4. **Atribuir e cronometrar todo lead, venha de onde vier.** O de troca entra
   sem dono, sem prazo e sem consentimento (B9); o agendamento entra sem
   vendedor e sem vínculo com o lead da mesma pessoa (B10). Só o formulário de
   interesse foi contemplado.
5. **Colocar o carro na filial.** O assistente não pergunta e o veículo nasce
   sem `branch_id`, o que zera a contagem do mapa (B7). Com uma filial só — que
   é o caso de 100% das lojas no dia zero —, isso deveria ser automático.
6. **Costurar a mesma pessoa.** Juliana mandou um interesse, ofereceu um carro
   na troca, criou conta com o mesmo e-mail e agendou uma visita. O painel mostra
   isso como **quatro coisas sem relação**. O telefone canônico e o e-mail já
   estão lá; falta usá-los fora do formulário de interesse.
7. **Oferecer um jeito de subir o logo.** O checklist de primeiros passos manda
   "Adicione o logo da concessionária" e o único campo aceita **URL de imagem já
   hospedada**. Um dono de revenda não tem onde hospedar um PNG.
8. **Explicar, no convite do vendedor, de qual loja e com qual papel.** A tela
   diz só "Bem-vindo à equipe!" — quem recebe o link pelo WhatsApp não sabe de
   quem é nem para quê.

---

## 6. Veredito — as 5 mudanças que mais aumentam a chance de sobreviver à primeira semana

**1ª — Fazer o site e o produto contarem a mesma história sobre o cadastro.**
É a primeira parede e a mais barata de derrubar. Ou o autoatendimento existe (e
então `/signup` aceita quem chega, com o super admin semeado por um comando
documentado, e o convite vira opcional), ou ele não existe — e aí a home para de
prometer "Criar conta grátis" cinco vezes e passa a ter um formulário honesto de
"quero ser avisado". Hoje o dono clica no que o site mais destaca e leva uma
porta na cara. Junto, e no mesmo dia: um caminho para criar o **primeiro**
super admin, porque sem ele um ambiente novo não pode ter nem a primeira loja.

**2ª — Tornar impossível um ambiente sem upload de foto passar despercebido.** ✅ *(25/09/2026 — B1)*
Sem a Cloudinary, o produto inteiro para: nada é publicado, nada aparece na
vitrine, nada chega ao mapa, nenhum lead entra pelo catálogo. E a única pista que
o usuário recebe é "Falha ao enviar uma das imagens". Uma verificação na
inicialização do web (ou uma faixa no painel) e uma mensagem que nomeie a causa
custam meia hora e são a diferença entre "está quebrado" e "falta configurar".
Vale a mesma disciplina para qualquer serviço externo que o *navegador* chame.

**3ª — Registrar o `PublicInvitationsController` e cobrir o aceite com um e2e.** ✅ *(25/09/2026 — B2)*
Uma linha de código. Sem ela, o CRM é monousuário — o dono não consegue colocar
o vendedor dentro do sistema, que é a razão de existir do produto. E o e2e
importa tanto quanto a correção: a rota nunca foi testada, o que significa que o
portão verde não protege esse caminho hoje.

**4ª — Fechar o buraco "o Zod descartou e a tela comemorou".** ✅ *(25/09/2026 — B4, B5 e um quarto caso que o teste novo achou sozinho)*
Três campos de `/configuracoes` se perdem assim (horário, telefone principal,
aceitar troca) e cada um desliga algo maior: o horário contamina o relógio do
SLA e trava um item do onboarding para sempre; a troca desliga uma
funcionalidade inteira, com tabela, rota e tela prontas. A correção pontual é
acrescentar os campos aos schemas; a correção que impede o próximo é
`.strict()` nos schemas de atualização — mais um teste que percorra os corpos
que o `apps/web` envia e confira que o schema correspondente os reconhece. É o
irmão gêmeo da armadilha nº 1 do CLAUDE.md: aqui a tela existe, a rota existe, e
o que se perde é o dado.

**5ª — Dar dono e relógio a todo lead, e costurar a mesma pessoa.** 🟡 *(25/09/2026 — troca e agendamento feitos; o chat do lead anônimo continua aberto)*
O funil da Onda 0 funciona muito bem por um caminho só. O lead de troca entra
órfão, sem prazo e sem consentimento LGPD; o agendamento entra sem vendedor e
sem vínculo; e o lead anônimo — o que o produto foi construído para capturar —
**não tem chat**, porque o botão exige conta vinculada. O resultado, numa loja
de verdade, é o gerente olhando uma tela que diz que está tudo no prazo enquanto
a proposta de troca mais valiosa da semana dorme sem responsável e sem alarme.
Na ordem: rodízio e SLA no lead de troca e no agendamento; consentimento no
formulário de troca; e o chat aberto para lead sem conta.

**Fora da lista, mas anote:** ✅ *(as duas foram feitas em 25/09/2026)* B6 (a máscara que estraga o telefone fixo) custa
três linhas e evita que o dono veja o próprio número errado na página pública no
primeiro dia — é pequeno e é exatamente o tipo de erro que faz um lojista de 50
anos parar de confiar no resto dos números. E B13 (a página pública que devolve
500) é a única falha desta simulação que um **cliente do cliente** vê.

---

## Estado deixado no ambiente

Banco `autoconnect_dia1_test` (novo, criado por este piloto; `autoconnect_test`
não foi tocado): 1 loja (Garagem Central), 4 usuários (super admin de bootstrap,
Márcio, Wesley, Juliana), 1 veículo publicado, 1 marca e 1 modelo no catálogo
global, 2 leads (site e troca), 1 agendamento de domingo, 1 negócio em Proposta,
meta de setembro e comissão de 2,5% para o Wesley.

Contornos aplicados por SQL, todos por causa de um defeito: super admin inicial
(não há caminho), foto do veículo (B1), usuário do Wesley (B2) e
`accepts_trade_in` (B5).

API (4300) e web (3300) seguem rodando a partir de `scratchpad/dia1-api.sh` e
`scratchpad/dia1-web.sh`, sobre o worktree `scratchpad/wt-dia1`; logs em
`dia1-api.log` e `dia1-web.log`. Para desmontar: matar os dois processos,
`git worktree remove scratchpad/wt-dia1` e
`DROP DATABASE autoconnect_dia1_test`.
