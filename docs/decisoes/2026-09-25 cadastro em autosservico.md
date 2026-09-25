---
tipo: decisao
data: 2026-09-25
---

# Cadastro de loja em autosserviço

## Contexto

O [piloto do primeiro dia](../produto/piloto-simulado-primeiro-dia.md) encenou
um dono de revenda chegando sozinho e bateu numa parede logo no começo: a home
tem cinco botões "Criar conta grátis" e **todos** levam a uma tela que diz que o
cadastro é restrito a convite. Pior que a promessa quebrada: num banco
recém-migrado **não existe caminho para criar o primeiro super admin**, então
ninguém pode emitir convite, e portanto ninguém pode criar a primeira loja.

Era uma contradição entre o que o site vende e o que o produto faz.

## Decisão

**Abrir o cadastro em autosserviço.** Qualquer revenda cria a conta sozinha pela
home, com período de teste, sem depender de convite nem de contato comercial.

O convite por token continua existindo para o que ele sempre foi: **trazer a
equipe para dentro de uma loja que já existe**.

## Por quê

- É o que a home já promete, e alinhar o produto ao site custa menos que
  reescrever o site.
- É o que a concorrência faz: a Auto Adm oferece 14 dias grátis sem cartão, e
  Boom, AutoConf e Revenda Mais publicam preço e entrada direta.
- O objetivo do projeto é fechar o primeiro cliente pagante. Exigir conversa
  comercial antes de qualquer visita ao produto é atrito no topo do funil, e
  quem procura sistema de revenda compara três num fim de semana.
- Sem autosserviço, cada avaliação depende de você estar disponível para emitir
  convite.

## O que isso exige

- Cadastro sem token, com período de teste e a assinatura nascendo em `trial`.
- **Proteção contra abuso**, porque a porta passa a ser pública: CNPJ validado
  (já existe consulta à BrasilAPI, que precisa deixar de bloquear quando a
  consulta falha), limite por IP, e verificação de e-mail antes de liberar o
  que importa.
- **Caminho documentado para o primeiro super admin** num banco novo — hoje não
  existe nenhum, e é o que impede instalar o sistema do zero.
- A home para de prometer e passa a cumprir: o botão leva ao cadastro.

## O que foi descartado

- **Manter por convite e corrigir a home** ("Solicitar acesso"): onboarding
  controlado, menos risco de abuso, mas trabalho comercial por cliente e um
  funil que depende da sua agenda.
- **Adiar para a Onda 3** (quando houver cobrança): o teste grátis não depende
  de gateway, e esperar atrasaria a primeira avaliação real do produto.

---

## O que foi implementado (25/09/2026)

### A porta

`POST /auth/signup-tenant` aceita cadastro **sem** `inviteToken`. Cria tenant,
primeiro `tenant_admin`, filial matriz e assinatura em `trial`. O token de
convite continua sendo aceito, validado e **consumido** — ele deixou de ser
exigido, não de existir. A única diferença que sobra entre os dois caminhos é o
e-mail: com convite a conta nasce verificada (quem emitiu o link já provou o
endereço), sem convite ela nasce por verificar.

A home e o `/comecar` passaram a cumprir a promessa: o botão leva ao cadastro e
não há mais nenhuma menção a "restrito a convite".

### Duração do teste: 14 dias

Porque é o que a home já anuncia em três lugares ("Sem cartão de crédito · 14
dias grátis"), o que o plano Trial promete e o que a concorrência pratica (a
Auto Adm oferece 14 dias sem cartão). Um trial de outra duração recriaria
exatamente a contradição entre site e produto que esta decisão veio desfazer.

O número mora numa constante só, `DURACAO_DO_TRIAL_DIAS` no `@autoconnect/shared`,
consumida pela API (que grava `trialEndsAt`) e pelas telas que citam o prazo.
Antes, `trial_ends_at` **nascia nulo**: o "14 dias" existia no HTML e em lugar
nenhum no banco, então nada no sistema sabia quando o teste acabava. O super
admin continua podendo estender pelo painel (`PATCH /admin/tenants/:id/extend-trial`).

**O que ainda não existe:** nada acontece quando o trial vence. Bloqueio por
vencimento é a Onda 3, junto da cobrança.

### O corte do cadastro: de 22 campos em 5 etapas para 5 campos numa tela

Critério: **o que a loja precisa para existir e funcionar**. O resto é pedido
dentro do produto, no momento em que importa.

Ficaram: **CNPJ, nome da loja, seu nome, e-mail e senha.** Mais o telefone da
loja, opcional. O telefone é o único opcional porque é o que a vitrine publica,
e um campo opcional não é obstáculo.

| Saiu | Por quê | Onde é pedido agora |
|---|---|---|
| Token de convite | É a decisão inteira | — |
| Razão social | A Receita responde por ela a partir do CNPJ | Autopreenchida; **editável em `/configuracoes`** — e é ela que sai no contrato |
| Slug da URL pública | "Slug" não é palavra de revendedor, e era obrigatório antes de a pessoa ver uma tela | Derivado do nome da loja, com sufixo quando colide; visível em `/configuracoes` |
| E-mail da concessionária | Na prática é o mesmo e-mail de acesso, e nada oferecia copiar | Nasce igual ao de acesso; editável em `/configuracoes` |
| Inscrição estadual | Nem toda loja tem, e nenhuma precisa dela no dia zero | `/configuracoes` |
| CPF do responsável | **O contrato não usa este CPF.** Ele usa o do *representante legal*, que já mora em `/configuracoes` e já bloqueia a emissão quando falta | `/perfil`; e o do contrato, em `/configuracoes` |
| Cargo / função | Não alimenta nada | `/perfil` |
| Celular pessoal do dono | Era contato comercial nosso, não do produto | `/perfil` |
| Endereço completo (7 campos) | A loja existe sem endereço; ele passa a importar na vitrine, no mapa e na agenda pública | Autopreenchido pela Receita quando ela responde; **item próprio no checklist de primeiros passos** |

O que o contrato e a LGPD exigem **não** desapareceu: a razão social virou campo
editável em `/configuracoes` (antes era somente leitura — o corte teria deixado
a loja sem como corrigi-la), o CNPJ continua obrigatório, e o representante
legal segue bloqueando a emissão do contrato na mesma tela. O aceite dos Termos
e da Política de Privacidade continua declarado no rodapé do formulário.

O checklist de primeiros passos ganhou **"Informe o endereço da loja"** e passou
de quatro para cinco itens, na ordem em que o cliente sente: veículo, endereço,
horário, equipe, logo.

### Proteção contra abuso

**CNPJ — a regra dura mudou de lugar.** O dígito verificador (`cnpjValido`, no
shared, usado pela tela e pela API) é o que recusa. A consulta à BrasilAPI virou
**enriquecimento**: ela preenche razão social e endereço, e só recusa quando
responde algo *conclusivo e negativo* (BAIXADA, SUSPENSA, INAPTA). Fora do ar,
404 de empresa recém-aberta, 429 do limite de uso do serviço gratuito ou 5xx de
manutenção **não impedem mais o cadastro** — a tela diz "Não conseguimos
consultar a Receita agora — pode seguir normalmente". Era o defeito B3 do
piloto: um serviço gratuito, sem chave e com limite de requisições, decidia quem
podia virar cliente.

**Teto por IP**, no mesmo espírito do formulário de lead: 3 cadastros e 10
reenvios de verificação por IP a cada hora, em memória de processo, sem Redis e
**sem CAPTCHA** — quem avalia um sistema para a própria loja num sábado à noite
desiste no primeiro quebra-cabeça. O teto é conferido *antes* do Zod, para que
um script que despeja corpo inválido também o consuma.
⚠ **Memória de processo: com duas réplicas da API o teto efetivo é `3 × réplicas`.**
É a mesma limitação do teto dos leads, e a razão de o `trust proxy` estar ligado
no `app.setup`.

A classe da janela deslizante passou a morar em `common/limite-por-ip.ts`, usada
pelos dois caminhos — uma segunda cópia seria uma segunda chance de errar a poda
do mapa, que é a parte que derruba o processo.

### O que exige e-mail verificado

**Explorar o painel não exige.** A loja nasce por verificar, entra no painel na
hora e **o login continua funcionando** — barrar o segundo acesso do dono num
e-mail que pode nunca chegar (ambiente sem provedor configurado, spam, domínio
corporativo) tornaria o produto inacessível logo depois de ele o ter criado. Um
ambiente sem e-mail nenhum é um ambiente que funciona: o link vai para o log,
como já acontece com "esqueci a senha".

**Exigem** (`EmailVerificadoGuard`, 403 com código `email_nao_verificado`):

| Ação | Por quê |
|---|---|
| `POST /invitations` — convidar equipe | Manda e-mail a terceiros com a nossa marca. Sem endereço provado, é um relay de spam com um clique |
| `POST /vehicles/:id/publish` — publicar anúncio | Põe a loja na vitrine pública, no mapa e no catálogo, com telefone e endereço visíveis a quem não é cliente nosso |

Cadastrar veículo em rascunho, receber e atender lead, abrir negócio e
configurar a loja continuam liberados. Despublicar também: tirar do ar nunca
pode ficar travado.

O guard **lê o banco, não o JWT** — o token vive 15 minutos e guardaria um "não
verificado" que já não é verdade; o dono clicaria no link e continuaria barrado.
Uma faixa no topo do painel (`AvisoDeEmailNaoVerificado`) avisa antes do 403 e
traz o botão **Reenviar e-mail**. A tela do consumidor final
(`/verifique-seu-email`) ganhou o mesmo botão, que ela não tinha: quem não
recebia o e-mail só podia se cadastrar de novo, com um endereço já em uso.

**O consumidor final continua tendo que confirmar antes de entrar.** A conta
dele serve para favoritar, alertar e conversar com a loja, e nada disso tem
valor num endereço que não é dele.

### O primeiro super admin de um banco novo

Comando de linha, não rota: `apps/api/src/scripts/promover-super-admin.ts`,
exposto como `pnpm --filter @autoconnect/api run super-admin`. Rota de bootstrap
é porta aberta — ela existe para sempre, responde na internet e alguém esquece
de fechá-la.

```bash
DIRECT_URL="postgresql://..." \
  PROMOVER_SUPER_ADMIN_EMAIL="voce@exemplo.com" \
  node apps/api/dist/scripts/promover-super-admin.js
```

Três travas: exige a **variável de ambiente explícita** (sem argumento de linha
e sem padrão, então rodar sem querer não faz nada); **recusa se já houver
qualquer super admin** (é bootstrap, não escalada de privilégio — o segundo se
promove pelo painel, que registra quem promoveu quem); e **promove quem já
existe** em vez de criar conta, para que nenhuma senha passe por variável de
ambiente, log de deploy ou histórico de shell. A promoção zera o `tenantId` (é
o que `escopoDa` exige para o escopo global) e escreve `super_admin_bootstrapped`
no audit log.

⚠ Promova uma conta dedicada: o único `tenant_admin` de uma loja, promovido,
deixa a loja sem administrador.

## Onde está no código

- `packages/shared/src/schemas/auth.ts` — `signupTenantSchema` (`.strict()`,
  convite opcional), `cnpjValido`, `slugDeLoja`, `DURACAO_DO_TRIAL_DIAS`,
  `reenviarVerificacaoSchema`. Testes em `auth.spec.ts`.
- `apps/api/src/modules/auth/auth.service.ts` — cadastro com e sem convite,
  slug derivado, trial com data de fim, razão social da Receita.
- `apps/api/src/modules/auth/limite-de-cadastro.ts` e
  `apps/api/src/common/limite-por-ip.ts` — o teto por IP.
- `apps/api/src/common/guards/email-verificado.guard.ts` — o que exige e-mail.
- `apps/api/src/scripts/promover-super-admin.ts` — o primeiro super admin.
- `apps/web/src/app/(auth)/signup/SignupContent.tsx` — o formulário de cinco campos.
- `apps/web/src/components/AvisoDeEmailNaoVerificado.tsx` — a faixa e o reenviar.
- `apps/api/test/cadastro-autosservico.e2e-spec.ts` — 22 casos, do cadastro sem
  convite ao comando do super admin.
