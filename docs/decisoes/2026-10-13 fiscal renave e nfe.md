---
tipo: decisao
data: 2026-10-13
estado: aceita
---

# Fiscal entra: RENAVE e NF-e, num plano só

## Contexto

Em 27/09/2026 a NF-e foi **adiada** ([plano de resolução](../planos/plano-resolucao-de-pendencias.md#adiado-por-decisão))
e o RENAVE ficou registrado como pendência sem dono em
[estado-e-pendencias](../planos/estado-e-pendencias.md). Desde então:

- O prazo de adequação da Resolução Contran nº 1.026/2026 venceu (28/09/2026), e
  a Circular nº 2/2026 da Senatran deu às lojas **até 20/10** para indicar a
  integradora no RENAVE, com operação assistida de 12/10 a 20/11.
- O financeiro entrou ([decisão](2026-09-27%20modulo%20financeiro.md)) e agora
  tem aquisição, venda e pagamento ligados ao veículo — os mesmos dados que a
  nota e o RENAVE pedem.
- Concorrentes vendem NF-e na faixa básica (Auto Adm em todos os planos), e a
  loja que já emite nota em outro sistema tem um motivo concreto para não trocar.

## Decisão

**NF-e e RENAVE entram**, num plano só ([plano-fiscal-renave-nfe](../planos/plano-fiscal-renave-nfe.md)),
dividido entre **duas sessões** — uma por trilha. O AutoConnect **prepara, envia
e guarda**: a NF-e sai por emissor terceiro, o RENAVE pela integradora
credenciada que a loja escolher. Começa pelo **registro manual de protocolo** do
RENAVE, que serve a qualquer loja já nas próximas semanas.

## Por quê

O lojista precisa que estoque, nota e RENAVE contem a mesma história. Fazer as
duas coisas no mesmo plano é o que garante que a nota e o registro apontam para
o mesmo `Deal` e a mesma `VehicleAcquisition`, em vez de cada uma pedir o valor
de novo.

A fronteira continua a de 27/09: o AutoConnect não calcula tributo, não vira
emissor próprio nem integradora credenciada. O que muda é que deixamos de fingir
que a nota não existe.

## Descartado

- **Manter o adiamento da NF-e e fazer só o RENAVE** — a saída do RENAVE pede a
  nota da venda (a confirmar no manual), e a conferência entre os três ficaria
  pela metade.
- **Virar integradora RENAVE** — credenciamento por estado, com e-CNPJ e
  regulamento técnico próprio, para um mercado que já tem uma dúzia delas.
- **Emitir NF-e direto na SEFAZ** — regra estadual muda, a reforma tributária
  muda o layout até 2033, e é um produto inteiro.
- **Integração RENAVE antes do registro manual** — a integradora de cada loja é
  escolha dela, e o prazo de outubro chega antes de qualquer adaptador.

## Depois: o emissor

Em 14/10/2026 o Israel escolheu a **Focus NFe** (API REST, homologação, cadastro
de empresa por API, webhook). O desenho que saiu dela — nenhum token de loja no
banco, certificado que passa e não fica, produção só com liberação explícita —
está na fase N3 do plano.

Ligada em homologação no mesmo dia. **A validação fica para o primeiro cliente**
(14/10/2026): a SEFAZ exige CNPJ com inscrição estadual e o certificado A1 dele
até em homologação, e comprar um só para testar é custo fixo antes de cliente. A
implantação da NF-e nessa loja é o teste — o roteiro está na fase N3.

## Onde está no código

- `packages/shared/src/domain/chave-nfe.ts` — contrato comum entre as duas
  trilhas (Fase 0).
- O resto entra fase a fase; o estado fica na tabela "Onde o plano está" do plano.
