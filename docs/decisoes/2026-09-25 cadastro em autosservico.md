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
