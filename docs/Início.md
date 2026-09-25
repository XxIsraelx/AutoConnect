---
tipo: indice
---

# AutoConnect — cofre

Este cofre é a pasta `docs/` do repositório. O que está aqui é versionado junto
com o código e lido pelo Claude quando o assunto aparece.

> O contexto operacional (stack, armadilhas, regras de isolamento, como rodar)
> continua no [CLAUDE.md](../CLAUDE.md), que o Claude carrega em toda sessão.
> Aqui fica o que é longo demais para carregar sempre.

## Onde cada coisa mora

| Pasta | O que vai nela | Quem escreve |
|---|---|---|
| [inbox](inbox/) | Ideia, bug, pedido solto — sem cerimônia. Nota nova cai aqui por padrão | você |
| [decisoes](decisoes/) | Uma decisão por nota: o que, por quê, o que foi descartado | Claude, ao fechar uma decisão com você |
| [planos](planos/) | Planos de implementação em fases e levantamentos | os dois |
| [produto](produto/) | O que o produto faz, do ponto de vista de quem usa | os dois |
| [arquitetura](arquitetura/) | Banco, diagrama ER, desenho técnico | os dois |
| [diario](diario/) | Nota do dia (`Ctrl/Cmd+P → Abrir nota de hoje`) | você |
| [modelos](modelos/) | Modelos das notas acima | — |

## Documentos principais

- [Plano de implementação — vendas e contrato](planos/plano-implementacao-vendas.md)
- [Plano — paridade de CRM e diferenciação](planos/plano-paridade-crm.md)
  · [levantamento dos CRMs do mercado](planos/levantamento-crms-e-paridade.md)
- [Levantamento — vendas e contratos](planos/levantamento-vendas-e-contratos.md)
- [Piloto simulado — uma semana na operação](produto/piloto-simulado-operacao.md)
  · [o primeiro dia, do zero](produto/piloto-simulado-primeiro-dia.md)
- [Funcionalidades do produto](produto/features.md)
- [MVP e arquitetura](produto/mvp-and-architecture.md)
- [Design do banco](arquitetura/database-design.md) · [diagrama ER](arquitetura/erd.mermaid)
- [Isolamento por tenant (RLS)](arquitetura/isolamento-por-tenant.md)
- [Testes e CI — detalhes](arquitetura/testes-e-ci.md)
- [Vendas e contrato — decisões](decisoes/vendas-e-contrato.md)
  · [assinatura externa](decisoes/2026-09-22%20assinatura%20externa.md)
  · [cadastro em autosserviço](decisoes/2026-09-25%20cadastro%20em%20autosservico.md)
- [Estado, pendências e próximos passos](planos/estado-e-pendencias.md)

## Como pedir algo ao Claude usando o cofre

- **"Veja o inbox"** — o Claude lê as notas de `inbox/`, resume e propõe o que
  fazer com cada uma. Nota tratada vira decisão, vai para um plano ou é apagada.
- **"Registre essa decisão"** — vira uma nota em `decisoes/` a partir do modelo.
- Links entre notas usam markdown relativo (`[texto](caminho.md)`), não
  `[[wikilink]]`: assim funcionam igual no Obsidian, no GitHub e no terminal.

## Não coloque aqui

Senha, token, chave de API, CPF de cliente real. O cofre é versionado no git.
Acessos ficam no `ACESSOS.md` da raiz, que está fora do cofre e no `.gitignore`.
