# AutoConnect — Funcionalidades do Produto

Documento de referência para todas as funcionalidades implementadas. Nível de detalhe: intermediário.

---

## Autenticação e Acesso

### Cadastro de concessionária
O fluxo de onboarding começa em `/comecar`. O usuário preenche dados da empresa (nome, CNPJ, cidade) e cria o primeiro administrador. Ao finalizar, um `Tenant` e uma `DealershipBranch` são criados no banco, e o usuário recebe o role `tenant_admin`. A partir daí ele é redirecionado para o dashboard.

### Login e recuperação de senha
A autenticação usa JWT com dois tokens: `access_token` (expira em 15 min) e `refresh_token` (30 dias). O login acontece em `/entrar`. Se o usuário esquecer a senha, ele acessa `/esqueci-minha-senha`, recebe um email com link de reset válido por 1 hora, e redefine em `/redefinir-senha`.

### Login com Google
Disponível via OAuth 2.0 (Google). Ao clicar em "Entrar com Google", o usuário é redirecionado para autenticação Google e volta ao sistema já logado. Se for o primeiro acesso, uma conta é criada automaticamente.

### Verificação de email
Clientes que se cadastram pelo catálogo público recebem um email de verificação. Enquanto não verificarem, o acesso a certas funcionalidades (como chat) fica restrito. A verificação usa um token JWT de 24 horas.

### Roles e permissões
O sistema tem 5 níveis de acesso:
- **super_admin**: acessa o painel admin global, gerencia todas as concessionárias
- **tenant_admin**: gerencia tudo dentro de sua concessionária
- **manager**: gerencia equipe, leads e agendamentos; não altera configurações da empresa
- **salesperson**: acessa leads e agendamentos atribuídos a ele
- **customer**: acessa o catálogo público, seu perfil e suas conversas

---

## Catálogo Público

### Busca de veículos (`/buscar`)
Página pública com mapa interativo (Mapbox, tema dark) e sidebar de listagem. O cliente pode filtrar por marca, modelo, condição (novo/usado/seminovo/demo), combustível, câmbio, faixa de preço, ano e quilometragem. Os resultados são paginados. No mapa, pins animados representam as concessionárias — ao clicar, a sidebar filtra os veículos daquela loja.

### Detalhe do veículo (`/catalogo/[id]`)
Página completa do veículo com galeria de imagens, ficha técnica (motor, câmbio, combustível, portas, cor, quilometragem), preço e preço promocional quando houver. Tem quatro ações disponíveis:

- **Falar com vendedor**: abre o chat em tempo real com a concessionária
- **Agendar test drive**: abre o modal de agendamento com seleção de data, hora e tipo
- **Simular financiamento**: calcula parcelas pelo sistema Price com entrada configurável e seleção de prazo (12 a 72 meses)
- **Comparar**: adiciona o veículo à lista de comparação (até 3 veículos)

### Comparação de veículos
Disponível tanto em `/buscar` quanto em `/catalogo/[id]`. O cliente seleciona até 3 veículos; uma barra flutuante aparece na tela com os itens selecionados e o botão "Comparar". Ao clicar, abre um modal/drawer com uma tabela lado a lado comparando preço, ano, quilometragem, combustível, câmbio, motor, condição e portas.

### Simulador de financiamento
Acessível na página do veículo. O cliente informa o valor de entrada (0% a 80% do preço) e seleciona o prazo em meses. O sistema calcula a parcela usando a Tabela Price (juros compostos) com uma taxa de referência fixa. Exibe parcela mensal, total pago e custo do financiamento.

### Integração FIPE
Ao cadastrar um veículo no dashboard, o sistema consulta a API pública FIPE (Parallelum) no step de preço. Faz matching fuzzy entre o nome da marca/modelo digitado e o catálogo FIPE, depois retorna o preço de referência para o ano e combustível selecionados. Exibe um card indicando se o preço cadastrado está acima, abaixo ou dentro do valor de mercado (margem de ±5%).

### Página pública da concessionária (`/c/[slug]`)
Cada concessionária tem uma URL pública no formato `/c/nomedaempresa`. Mostra logo, descrição, horários de funcionamento (com accordion — exibe só o dia atual por padrão, expande para ver a semana completa), localização, veículos disponíveis e botões de contato (chat, WhatsApp, telefone). O cliente pode iniciar o chat ou agendar diretamente por essa página.

---

## Perfil do Cliente

### Página de perfil (`/perfil`)
Área exclusiva para usuários com role `customer`. Organizada em 6 abas:

- **Favoritos**: veículos marcados com coração no catálogo. Exibe imagem, preço atual e link para o detalhe
- **Vistos recentemente**: últimos veículos visualizados, ordenados por data
- **Buscas salvas**: filtros que o cliente salvou no `/buscar` para reutilizar depois
- **Alertas de preço**: veículos monitorados — quando o preço cair até o valor-alvo, o cliente será notificado
- **Agendamentos**: lista de test drives e visitas solicitados, com opção de cancelar
- **Conversas**: histórico de chats com concessionárias, com contador de mensagens não lidas

---

## Dashboard da Concessionária

### KPIs em tempo real
O dashboard exibe 6 cards com dados reais consultados em `/tenant/stats`: veículos no estoque, leads hoje, leads novos sem contato, agendamentos hoje, agendamentos da semana e conversas abertas. Cards com badge vermelho indicam itens que precisam de atenção imediata.

### GalaxyMap
Visualização interativa que mostra os clientes da concessionária como pontos no espaço (layout de galáxia). Alterna entre dois modos: clientes "interessados" (que visualizaram veículos ou enviaram leads) e clientes "cadastrados" (com conta). Ao passar o mouse em um ponto, exibe nome e localização do cliente.

### Checklist de onboarding
Aparece no dashboard enquanto a concessionária não completa a configuração inicial. Guia o administrador por passos como: adicionar logo, preencher horários, cadastrar primeiro veículo, convidar primeiro vendedor.

---

## Gestão de Leads

### Kanban de leads
O painel em `/leads` lista todos os leads do tenant em colunas por status: **Novo → Contatado → Qualificado → Negociando → Ganho / Perdido**. Cada card mostra nome do cliente, veículo de interesse, tempo desde o último contato e ícone da fonte (website, WhatsApp, telefone, etc.).

### Atribuição e timeline
Ao clicar em um lead, abre um drawer com: dados do cliente, veículo associado, botão para atribuir vendedor, e timeline cronológica de todas as interações (criação, mudanças de status, notas manuais, agendamentos, mensagens). É possível adicionar notas diretamente pelo drawer.

### Exportação CSV
Botão no topo da página exporta todos os leads do tenant em formato CSV com nome, email, telefone, status, fonte, veículo de interesse e datas.

### Estatísticas de leads
Barra de totais no topo da página mostra contagem de leads por status em tempo real, atualizada sempre que a página carrega.

---

## Agendamentos

### Listagem e filtros
A página `/agendamentos` mostra todos os agendamentos do tenant. Tem dois modos de visualização: **lista** (agrupada por dia: hoje / amanhã / datas futuras) e **calendário semanal** (com navegação por semana e destaque do dia atual). Filtros disponíveis: busca por nome do cliente, status, vendedor responsável e tipo de agendamento.

### Tipos de agendamento
O sistema suporta 6 tipos: test drive, avaliação de usado, visita presencial, reunião online, entrega e revisão/serviço.

### Status e fluxo
Agendamentos passam por: `scheduled` → `confirmed` → `in_progress` → `completed`. Também podem ser marcados como `canceled` ou `no_show` (não compareceu).

### Drawer de detalhes
Ao clicar num agendamento, abre um painel com: data/hora (editável inline para reagendar), card do veículo com imagem, dados do cliente com email e telefone clicáveis, select para trocar o vendedor responsável, campo de notas, e botões de ação (Confirmar, Concluir, Não compareceu, Cancelar).

### Notificações por email
Três eventos disparam emails automáticos:
1. Cliente solicita agendamento → email para o admin/manager da loja com dados do cliente e horário
2. Concessionária confirma → email para o cliente com data e local
3. Concessionária cancela ou reagenda → email para o cliente com o novo status

---

## Chat em Tempo Real

### Conversa cliente ↔ concessionária
O chat usa WebSocket via Socket.IO. Clientes iniciam conversa pela página pública do veículo ou da concessionária. Vendedores respondem pelo dashboard em `/chat`. As mensagens aparecem em tempo real para os dois lados sem necessidade de atualizar a página.

### Tipos de mensagem
Além de texto, o chat suporta: imagens, arquivos, cards de veículo (com foto, modelo e preço) e mensagens de sistema (ex: "Conversa iniciada").

### Proposta comercial
O vendedor pode enviar uma proposta formal pelo chat: informa veículo, valor de desconto, condições e prazo de validade. A proposta aparece como um card especial na conversa, e o cliente pode aceitar ou recusar diretamente pelo chat.

### Indicadores de presença
A sidebar do chat exibe a lista de conversas com badge de mensagens não lidas. Conversas abertas ficam no topo; conversas fechadas são arquivadas mas mantêm o histórico completo.

---

## Gestão de Veículos

### Cadastro passo a passo
O formulário em `/veiculos/novo` divide o cadastro em 4 steps: (1) Marca e modelo — com busca no catálogo existente ou criação de nova marca/modelo; (2) Detalhes técnicos — ano, km, cor, combustível, câmbio, motor, portas, VIN, placa; (3) Preço e condição — com card da FIPE mostrando referência de mercado; (4) Imagens — upload múltiplo com drag-and-drop e definição da foto capa.

### Importação em lote (CSV)
Botão "Importar" na listagem abre um modal que aceita arquivo `.csv`. Antes de importar, o sistema valida cada célula e exibe: total de linhas, linhas válidas, quantidade de erros, e tabela de preview com células problemáticas destacadas em vermelho (com tooltip explicando o erro). Se houver qualquer erro, o botão de confirmar fica bloqueado. O modelo de planilha pode ser baixado pelo mesmo modal.

Validações incluídas: marca numérica, modelo inválido, condição desconhecida, ano fora do intervalo, fabricação posterior ao ano modelo, quilometragem negativa, veículo novo com km alto, preço zero ou suspeito, preço promocional maior que o preço base, câmbio/combustível inválido, número de portas fora do intervalo (2–6), e linhas duplicadas dentro do arquivo.

### Gerenciamento de imagens
Na edição do veículo, é possível adicionar novas fotos, remover existentes e definir qual é a imagem capa. As imagens são armazenadas no Supabase Storage.

### Status do veículo
Cada veículo tem um dos 5 status: disponível, reservado, vendido, em manutenção ou arquivado. A listagem filtra por `available` por padrão.

---

## Gestão de Equipe

### Convite por email
O administrador convida membros pelo email. O sistema envia um link com token válido por 7 dias. Ao aceitar, o convidado cria sua conta já vinculada ao tenant com o role definido no convite.

### Drawer de membro
Ao clicar num membro da equipe, abre um painel com: dados do perfil, role atual (editável), status (ativo/suspenso) e métricas do mês selecionado — leads atribuídos, leads ganhos, taxa de conversão, valor vendido e agendamentos realizados.

### Metas de vendas
É possível definir uma meta mensal de vendas (em número de negócios fechados) por vendedor. O dashboard da equipe exibe barra de progresso individual e percentual atingido da meta coletiva do time.

---

## Relatórios

### Visão geral por período
A página `/relatorios` conecta ao endpoint `/tenant/reports?days=N` e exibe dados reais com período configurável (7, 30, 60 ou 90 dias). Os gráficos são renderizados com a biblioteca Recharts.

### Gráficos disponíveis
- **Leads por dia**: gráfico de área mostrando volume de novos leads ao longo do período
- **Leads por status**: gráfico de barras com distribuição por status (novo, contatado, ganho, perdido, etc.)
- **Leads por canal**: gráfico de pizza com origem dos leads (site, WhatsApp, telefone, indicação, redes sociais, etc.)

### KPIs do período
Cards no topo resumem: total de leads, leads ganhos, taxa de conversão global, e agendamentos realizados.

---

## Configurações da Concessionária

### Dados da empresa
O admin edita nome, CNPJ, slug (URL pública), logo, descrição e redes sociais. O slug define o endereço em `/c/[slug]`.

### Filiais
Cadastro e edição de filiais com endereço completo, coordenadas GPS (para aparecer no mapa), telefone e email de contato.

### Horários de funcionamento
Configuração por dia da semana com horário de abertura e fechamento. Aparece na página pública da concessionária.

### Perfil pessoal
Cada usuário edita seu próprio nome, foto e pode trocar a senha em `/configuracoes` (ou dentro do perfil pelo drawer na equipe).

---

## Painel Administrativo (Super Admin)

### Dashboard global
Acessível apenas para `super_admin`. Mostra KPIs de toda a plataforma: total de concessionárias ativas, usuários cadastrados, leads gerados e conversas abertas.

### Gestão de tenants
Lista todas as concessionárias com filtros. O admin pode: ativar/desativar um tenant, alterar o plano de assinatura, estender o período trial e ver detalhes completos de cada loja.

### Impersonação
O super_admin pode "entrar como" qualquer concessionária para visualizar o sistema exatamente como o administrador daquela loja vê, sem precisar de senha. Útil para suporte e debug.

### Avisos globais
O super_admin pode publicar avisos que aparecem para todos os usuários logados (ex: manutenção programada, novas funcionalidades).

### Log de auditoria
Registro de todas as ações críticas do sistema com timestamp, usuário e tenant. Consultável com filtros por data e tipo de evento.

---

## Trade-in, alertas e automações

### Oferta de veículo na troca (trade-in)
Quando a concessionária ativa "Aceitar veículo na troca" em `/configuracoes`, aparece o botão **"Tenho um carro na troca"** na página pública da loja (`/c/[slug]`) e em cada veículo do catálogo (`/catalogo/[id]`). O cliente descreve o próprio carro (marca, modelo, ano, km, combustível, câmbio, se está financiado, se tem débitos) e seu contato — sem precisar de login. Ao enviar, o sistema consulta a **Tabela FIPE automaticamente** para o carro oferecido e cria um lead com fonte "trade_in", guardando todos os dados e a referência FIPE. Quando aberto a partir de um veículo, o modal mostra que o carro vai "abater do valor" daquele veículo desejado.

### Avaliação da troca pelo vendedor
No painel de leads, um lead de troca exibe um bloco verde com o veículo oferecido, a referência FIPE e o valor que o cliente espera. O vendedor digita quanto a loja oferece pelo usado (ou recusa a proposta). O sistema calcula a **diferença a pagar** no veículo desejado (preço do carro − avaliação) e envia um e-mail ao cliente com o valor avaliado e o abatimento. A avaliação fica registrada na timeline do lead.

### Alertas de preço que disparam
Os alertas de preço que o cliente cria agora funcionam de verdade: quando o vendedor reduz o preço (ou define um promocional) de um veículo no dashboard, o sistema verifica todos os alertas ativos daquele veículo e, para cada cliente cujo preço-alvo foi atingido, envia um e-mail avisando da queda. Cada alerta é marcado como disparado para não reenviar.

### Histórico de preço do veículo
Toda vez que o preço ou o promocional de um veículo muda, o sistema grava a alteração (valor anterior → novo valor, data e autor). Na página de edição do veículo, uma seção **"Histórico de preço"** mostra a linha do tempo das mudanças, com seta verde para quedas e âmbar para aumentos.

### Comissão dos vendedores
No drawer de cada membro em `/equipe`, aparece a **comissão estimada** (valor vendido no período × percentual de comissão). O administrador define o percentual por vendedor diretamente ali, e o cálculo em reais é atualizado na hora.

### Lembretes automáticos de agendamento
Uma rotina horária (cron via `@nestjs/schedule`) verifica os agendamentos confirmados ou marcados que começam nas próximas 24h e ainda não foram lembrados, e envia um e-mail de lembrete ao cliente. Cada agendamento é lembrado uma única vez.

### Re-engajamento de leads frios
Uma rotina diária procura leads parados (status "novo" sem contato há 3 dias, "contatado" há 7 dias) e cria uma notificação interna para o vendedor responsável ("Lead esfriando 🧊"), evitando repetir o aviso do mesmo lead na mesma semana.

---

## Infraestrutura e Integrações

### Multi-tenant
Todo o banco de dados usa isolamento por `tenant_id`. O middleware extrai o tenant do JWT a cada requisição — nenhuma concessionária acessa dados de outra.

### Email transacional
Suporta dois provedores configuráveis via variáveis de ambiente: **Resend** (API key) ou **Gmail SMTP** (app password). Em ambiente de desenvolvimento, os emails são apenas logados no console sem envio real.

### Armazenamento de imagens
Upload de imagens de veículos e logos vai direto para o **Supabase Storage** no bucket `vehicle-images`. As URLs são públicas e ficam salvas no banco vinculadas ao veículo.

### WebSocket
O servidor NestJS expõe um gateway Socket.IO na mesma porta da API (4000). O frontend conecta ao iniciar o chat e mantém a conexão aberta enquanto a página está ativa.

### PWA
O frontend tem `manifest.webmanifest` configurado, o que permite instalação como app no celular pelo Chrome/Safari. Não há service worker ativo para cache offline ou push notifications nativas.
