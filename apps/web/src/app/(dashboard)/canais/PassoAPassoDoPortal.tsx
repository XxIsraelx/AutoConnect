'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, ChevronDown, Copy } from 'lucide-react';
import { CONTATO_SUPORTE, type ChaveDoPortal } from '@autoconnect/shared';
import { API_URL } from '@/lib/api';
import { cn } from '@/lib/utils';

export interface ProgressoDoPortal {
  confirmacaoDoGmail: { codigo: string; recebidaEm: string } | null;
  recebeuDoPortal: boolean;
  recebeuLead: boolean;
}

interface Props {
  chave: ChaveDoPortal;
  nome: string;
  conectado: boolean;
  progresso: ProgressoDoPortal;
  /** O endereço recém-gerado — só existe na hora de conectar (o banco guarda o hash). */
  endereco: { token: string; email: string | null } | null;
  emailDisponivel: boolean;
  administra: boolean;
}

type Provedor = 'gmail' | 'outlook' | 'outro';

/** "da OLX", "do iCarros": o texto do passo a passo fala do portal pelo nome. */
const DO: Record<ChaveDoPortal, string> = {
  olx: 'da OLX',
  webmotors: 'da Webmotors',
  icarros: 'do iCarros',
  mercadolivre: 'do Mercado Livre',
  outro: 'da integração',
};

/**
 * O passo a passo de Canais, para o lojista conectar um portal sozinho.
 *
 * Um só para os quatro portais, porque o processo é o mesmo: o portal avisa o
 * lead por e-mail, e a caixa da loja encaminha esse e-mail para o endereço da
 * loja aqui. O que muda é o **provedor de e-mail da loja** — o Gmail pede um
 * código de confirmação, o Outlook não —, e é por ele que o texto varia. A
 * integração (Zapier, Make, RD Station) é outro processo: uma URL de webhook.
 *
 * As etapas se marcam sozinhas pelo que já chegou (`progresso`, calculado pela
 * API desde a conexão): o código do Gmail aparece no passo em que ele é pedido.
 *
 * O remetente dos avisos de cada portal **não** é citado de propósito: ele
 * muda sem aviso, e um endereço errado aqui faria o filtro nunca pegar nada.
 * O passo manda copiar o remetente de um e-mail de lead de verdade.
 */
export default function PassoAPassoDoPortal(props: Props) {
  const { conectado, progresso, endereco } = props;
  const [aberto, setAberto] = useState(!!endereco || (conectado && !progresso.recebeuLead));
  const [provedor, setProvedor] = useState<Provedor>('gmail');
  // Acabou de conectar: é a hora em que o lojista precisa do passo a passo.
  useEffect(() => { if (endereco) setAberto(true); }, [endereco]);

  const integracao = props.chave === 'outro';
  const feitos = integracao
    ? [conectado, progresso.recebeuDoPortal, progresso.recebeuLead]
    : [
        conectado,
        provedor !== 'gmail' || !!progresso.confirmacaoDoGmail || progresso.recebeuDoPortal,
        progresso.recebeuDoPortal,
        progresso.recebeuLead,
      ];
  const concluidos = feitos.filter(Boolean).length;

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs font-semibold txt-medio"
      >
        <ChevronDown size={14} className={cn('transition-transform', aberto ? '' : '-rotate-90')} />
        {integracao ? 'Passo a passo: como ligar uma integração' : `Passo a passo: como conectar ${DO[props.chave].replace(/^d/, '')}`}
        <span className={cn('ml-auto font-medium', concluidos === feitos.length ? 'text-emerald-600 dark:text-emerald-400' : 'txt-fraco')}>
          {concluidos === feitos.length ? 'Tudo pronto' : `${concluidos} de ${feitos.length}`}
        </span>
      </button>

      {aberto && (
        <div className="px-3 pb-4 pt-1 space-y-4 text-sm txt-medio">
          {integracao
            ? <GuiaDeIntegracao {...props} feitos={feitos} />
            : <GuiaDeEmail {...props} feitos={feitos} provedor={provedor} onProvedor={setProvedor} />}
        </div>
      )}
    </div>
  );
}

/* ── Peças ────────────────────────────────────────────────── */

function Etapa({ numero, titulo, feita, children }: {
  numero: number;
  titulo: string;
  feita: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="flex gap-3">
      <div className="shrink-0 pt-0.5">
        {feita ? (
          <CheckCircle2 size={20} className="text-emerald-600 dark:text-emerald-400" aria-label="concluída" />
        ) : (
          <span className="w-5 h-5 rounded-full border border-slate-300 dark:border-slate-600 text-[11px] font-bold flex items-center justify-center txt-fraco">
            {numero}
          </span>
        )}
      </div>
      <div className="flex-1 min-w-0 space-y-2">
        <p className={cn('font-semibold', feita ? 'txt-fraco' : 'txt-forte')}>{titulo}</p>
        {children}
      </div>
    </section>
  );
}

function Lista({ itens }: { itens: React.ReactNode[] }) {
  return (
    <ol className="list-decimal pl-5 space-y-1 text-[13px]">
      {itens.map((item, i) => <li key={i}>{item}</li>)}
    </ol>
  );
}

function Destaque({ children }: { children: React.ReactNode }) {
  return <strong className="txt-forte font-semibold">{children}</strong>;
}

function Copiar({ valor, rotulo }: { valor: string; rotulo: string }) {
  const [copiado, setCopiado] = useState(false);
  async function copiar() {
    try {
      await navigator.clipboard.writeText(valor);
      setCopiado(true);
    } catch {
      // Silencioso com motivo: a área de transferência é negada em alguns
      // contextos, e o valor está na tela para copiar à mão.
    }
  }
  return (
    <div className="flex items-center gap-2">
      <code className="flex-1 min-w-0 break-all text-xs rounded-lg px-2 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
        {valor}
      </code>
      <button type="button" onClick={copiar} aria-label={`Copiar ${rotulo}`}
              className="shrink-0 inline-flex items-center gap-1 text-xs font-semibold text-blue-600 dark:text-blue-400">
        <Copy size={12} /> {copiado ? 'Copiado' : 'Copiar'}
      </button>
    </div>
  );
}

/** Etapa 1, igual nos dois guias: gerar o endereço e guardá-lo. */
function GerarEndereco({ conectado, endereco, administra, feita, oQue }: {
  conectado: boolean;
  endereco: Props['endereco'];
  administra: boolean;
  feita: boolean;
  oQue: 'email' | 'url';
}) {
  const url = endereco ? `${API_URL.replace(/\/+$/, '')}/api/v1/webhooks/portais/${endereco.token}` : null;
  return (
    <Etapa numero={1} titulo="Gerar o endereço da loja" feita={feita}>
      {!conectado && administra && (
        <p className="text-[13px]">
          Clique em <Destaque>Conectar</Destaque>, aqui em cima.
          O {oQue === 'email' ? 'e-mail de encaminhamento' : 'endereço (URL)'} aparece <Destaque>uma vez só</Destaque>:
          deixe esta tela aberta até terminar o próximo passo.
        </p>
      )}
      {!conectado && !administra && (
        <p className="text-[13px]">Peça ao administrador da loja para clicar em <Destaque>Conectar</Destaque>.</p>
      )}
      {conectado && endereco && (oQue === 'email' ? endereco.email : url) && (
        <>
          <p className="text-[13px]">Este é o endereço da loja. Copie agora: por segurança, ele não aparece de novo.</p>
          <Copiar valor={(oQue === 'email' ? endereco.email : url)!} rotulo="o endereço" />
        </>
      )}
      {conectado && !endereco && (
        <p className="text-[13px]">
          O endereço apareceu na hora de conectar. Não guardou? Clique em <Destaque>Novo endereço</Destaque> —
          o anterior para de valer, então troque-o onde já estiver configurado.
        </p>
      )}
    </Etapa>
  );
}

/* ── Os portais: encaminhar o e-mail de lead ──────────────── */

function GuiaDeEmail({ chave, nome, conectado, progresso, endereco, emailDisponivel, administra, feitos, provedor, onProvedor }: Props & {
  feitos: boolean[];
  provedor: Provedor;
  onProvedor: (p: Provedor) => void;
}) {
  const doPortal = DO[chave];

  if (!emailDisponivel) {
    return (
      <p className="text-[13px] rounded-lg px-3 py-2 bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
        O e-mail de entrada ainda não está ligado neste servidor. Fale com o suporte ({CONTATO_SUPORTE}).
      </p>
    );
  }

  const codigo = progresso.confirmacaoDoGmail;

  return (
    <>
      <p className="text-[13px]">
        {`${doPortal.replace(/^d(.)/, (_, a: string) => a.toUpperCase())} avisa cada interessado por e-mail. O que você vai fazer é pedir ao seu e-mail que mande uma `}
        <Destaque>cópia</Destaque>{` desses avisos para o endereço da loja aqui — e cada um vira lead sozinho, no vendedor da vez. `}
        Seu e-mail continua recebendo tudo normalmente.
      </p>

      <GerarEndereco conectado={conectado} endereco={endereco} administra={administra} feita={feitos[0]} oQue="email" />

      <div>
        <p className="text-xs font-semibold txt-fraco mb-1.5">Qual é o e-mail que recebe os avisos {doPortal}?</p>
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Provedor de e-mail">
          {([['gmail', 'Gmail'], ['outlook', 'Outlook / Hotmail'], ['outro', 'Outro']] as const).map(([k, rotulo]) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={provedor === k}
              onClick={() => onProvedor(k)}
              className={cn(
                'text-xs font-medium px-3 py-1 rounded-full border transition',
                provedor === k
                  ? 'bg-blue-600 border-blue-600 text-white'
                  : 'border-slate-200 dark:border-slate-700 txt-medio',
              )}
            >
              {rotulo}
            </button>
          ))}
        </div>
      </div>

      <Etapa numero={2} titulo="Autorizar o endereço no seu e-mail" feita={feitos[1]}>
        {provedor === 'gmail' ? (
          <>
            <p className="text-[13px]">O Gmail só encaminha para um endereço depois de confirmar que ele existe.</p>
            <Lista itens={[
              <>Abra o Gmail <Destaque>no computador</Destaque> — o aplicativo do celular não tem esta opção.</>,
              <>Clique na <Destaque>engrenagem</Destaque> (canto superior direito) › <Destaque>Ver todas as configurações</Destaque>.</>,
              <>Abra a aba <Destaque>Encaminhamento e POP/IMAP</Destaque> › <Destaque>Adicionar um endereço de encaminhamento</Destaque> › cole o endereço do passo 1 › <Destaque>Próxima</Destaque> › <Destaque>Continuar</Destaque> › <Destaque>OK</Destaque>.</>,
              <>O Gmail manda um código de confirmação para esse endereço. Ele aparece logo abaixo (clique no botão de atualizar do cartão, se ainda não apareceu).</>,
              <>Volte ao Gmail, digite o código no campo <Destaque>Código de confirmação</Destaque> e clique em <Destaque>Verificar</Destaque>.</>,
              <>Na mesma aba, deixe marcado <Destaque>Desativar encaminhamento</Destaque> e clique em <Destaque>Salvar alterações</Destaque>. A outra opção mandaria <Destaque>todos</Destaque> os e-mails da loja — quem escolhe o que vai é o filtro do passo 3.</>,
            ]} />
            {codigo ? (
              <div className="rounded-lg border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50/60 dark:bg-emerald-500/5 p-3">
                <p className="text-xs txt-fraco mb-1">
                  Código de confirmação do Gmail (chegou em {new Date(codigo.recebidaEm).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}):
                </p>
                <Copiar valor={codigo.codigo} rotulo="o código" />
              </div>
            ) : conectado ? (
              <p className="text-xs txt-fraco">Aguardando o código do Gmail…</p>
            ) : null}
          </>
        ) : provedor === 'outlook' ? (
          <p className="text-[13px]">O Outlook não pede confirmação: siga para o passo 3.</p>
        ) : (
          <p className="text-[13px]">
            Alguns provedores pedem para confirmar o endereço de destino. Se o seu pedir, o código ou o link chega
            nas <Destaque>entregas</Destaque> deste portal, aqui em Canais.
          </p>
        )}
      </Etapa>

      <Etapa numero={3} titulo={`Encaminhar só os e-mails de lead ${doPortal}`} feita={feitos[2]}>
        <p className="text-[13px]">
          Primeiro, abra um e-mail de interessado que {doPortal.replace(/^d/, '')} mandou para você e anote o
          <Destaque> remetente</Destaque> (o campo De). Use o remetente exato dos avisos de lead: com só o domínio,
          propaganda e avisos de plano {doPortal} também seriam encaminhados.
        </p>
        {provedor === 'gmail' && (
          <Lista itens={[
            <>Na barra de pesquisa do Gmail, clique no ícone de <Destaque>opções de pesquisa</Destaque> (à direita da barra).</>,
            <>No campo <Destaque>De</Destaque>, cole o remetente.</>,
            <>Clique em <Destaque>Criar filtro</Destaque>, marque <Destaque>Encaminhar para</Destaque>, escolha o endereço do passo 1 e clique em <Destaque>Criar filtro</Destaque> de novo.</>,
          ]} />
        )}
        {provedor === 'outlook' && (
          <Lista itens={[
            <>No Outlook na web, clique na <Destaque>engrenagem</Destaque> › <Destaque>Email</Destaque> › <Destaque>Regras</Destaque> › <Destaque>Adicionar nova regra</Destaque>.</>,
            <>Nome: <Destaque>Leads {nome}</Destaque>. Condição: <Destaque>De</Destaque> → cole o remetente.</>,
            <>Ação: <Destaque>Encaminhar para</Destaque> → cole o endereço do passo 1. Clique em <Destaque>Salvar</Destaque>.</>,
            <>Em conta de empresa (Microsoft 365), o administrador pode ter bloqueado o encaminhamento para fora. Se nada chegar aqui, peça para liberar.</>,
          ]} />
        )}
        {provedor === 'outro' && (
          <Lista itens={[
            <>No webmail do seu provedor, procure por <Destaque>Filtros</Destaque>, <Destaque>Regras</Destaque> ou <Destaque>Encaminhamento</Destaque>.</>,
            <>Crie uma regra: e-mails desse remetente → <Destaque>encaminhar</Destaque> (ou <Destaque>redirecionar</Destaque>) para o endereço do passo 1.</>,
          ]} />
        )}
        <p className="text-xs txt-fraco">
          Só os avisos que chegarem daqui em diante são encaminhados. Confira também, nas configurações da sua conta
          {' '}{doPortal}, se o aviso de interessado por e-mail está ligado.
        </p>
      </Etapa>

      <Etapa numero={4} titulo="Conferir o primeiro lead" feita={feitos[3]}>
        <p className="text-[13px]">
          Peça a alguém que mande uma mensagem num anúncio da loja {doPortal.replace(/^d/, 'n')}. Em até um minuto,
          aparece nas <Destaque>entregas</Destaque> deste portal:
        </p>
        <ul className="list-disc pl-5 space-y-1 text-[13px]">
          <li><Destaque>Lead criado</Destaque> — pronto: o lead entra no vendedor da vez, com o prazo de primeiro contato correndo.</li>
          <li>
            <Destaque>Não entendido</Destaque> — o e-mail chegou, mas num formato que o sistema ainda não lê. Avise o
            suporte ({CONTATO_SUPORTE}): o e-mail fica guardado e é reprocessado, nenhum lead se perde.
          </li>
        </ul>
      </Etapa>
    </>
  );
}

/* ── Integração: a URL de webhook ─────────────────────────── */

const EXEMPLO_DE_CORPO = `{
  "nome": "Maria Souza",
  "telefone": "(11) 98765-4321",
  "email": "maria@exemplo.com",
  "mensagem": "Ainda está disponível?",
  "anuncio": {
    "titulo": "Chevrolet Onix 1.0 LT 2019",
    "preco": "55900",
    "url": "https://…",
    "codigo": "123456"
  },
  "id": "lead-123"
}`;

function GuiaDeIntegracao({ nome, conectado, endereco, administra, feitos }: Props & { feitos: boolean[] }) {
  return (
    <>
      <p className="text-[13px]">
        Para ferramentas que enviam o lead direto para um endereço na internet (webhook): Zapier, Make, n8n,
        RD Station ou o sistema de um portal. Se a sua ferramenta só manda e-mail, use o e-mail de encaminhamento
        e o passo a passo de um dos portais.
      </p>

      <GerarEndereco conectado={conectado} endereco={endereco} administra={administra} feita={feitos[0]} oQue="url" />

      <Etapa numero={2} titulo="Configurar o envio na sua ferramenta" feita={feitos[1]}>
        <Lista itens={[
          <>Crie uma ação que envia uma requisição HTTP — no Zapier, <Destaque>Webhooks by Zapier › POST</Destaque>; no Make, <Destaque>HTTP › Make a request</Destaque>; no n8n, <Destaque>HTTP Request</Destaque>.</>,
          <>Método <Destaque>POST</Destaque>, tipo de conteúdo <Destaque>JSON</Destaque> (application/json), e a URL do passo 1.</>,
          <>Monte o corpo neste formato (os nomes dos campos em português, como abaixo):</>,
        ]} />
        <pre className="text-[11px] leading-relaxed rounded-lg p-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 overflow-x-auto">
          {EXEMPLO_DE_CORPO}
        </pre>
        <ul className="list-disc pl-5 space-y-1 text-[13px]">
          <li><Destaque>telefone</Destaque> (com DDD) ou <Destaque>email</Destaque>: pelo menos um dos dois — sem contato, não há lead.</li>
          <li><Destaque>anuncio</Destaque> e <Destaque>id</Destaque> são opcionais. O <Destaque>id</Destaque> do lead na ferramenta evita duplicar quando ela reenvia.</li>
          <li>Pode mandar uma lista de leads (<code>[{'{…}'}, {'{…}'}]</code>) numa requisição só.</li>
        </ul>
      </Etapa>

      <Etapa numero={3} titulo="Testar" feita={feitos[2]}>
        <p className="text-[13px]">
          Use o envio de teste da ferramenta. Nas <Destaque>entregas</Destaque> desta linha aparece
          <Destaque> Lead criado</Destaque>; se aparecer <Destaque>Não entendido</Destaque>, o corpo saiu fora do
          formato acima — confira os nomes dos campos.
        </p>
      </Etapa>
    </>
  );
}
