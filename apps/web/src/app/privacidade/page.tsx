import type { Metadata } from 'next';
import Link from 'next/link';
import PaginaLegal, { CONTATO_LEGAL } from '@/components/PaginaLegal';

export const metadata: Metadata = {
  title: 'Política de Privacidade — AutoConnect',
  description: 'Como o AutoConnect coleta, usa, compartilha e protege dados pessoais, conforme a LGPD.',
};

// ⚠ Texto redigido a partir do que o código de fato faz, mas ainda sem revisão
// jurídica — mesma ressalva do template de contrato. Ao mudar a coleta de dados
// (novo fornecedor, novo campo pessoal, analytics), atualize esta página.
export default function PrivacidadePage() {
  return (
    <PaginaLegal
      titulo="Política de Privacidade"
      resumo="Coletamos só o necessário para você encontrar um veículo, falar com a concessionária e fechar negócio. Não vendemos dados, não usamos cookies de publicidade e você pode pedir acesso, correção ou exclusão dos seus dados a qualquer momento."
    >
      <p>
        Esta Política explica como o <strong>AutoConnect</strong> (&quot;nós&quot;) trata dados
        pessoais de quem usa a plataforma — clientes que procuram veículos e equipes das
        concessionárias —, em conformidade com a Lei Geral de Proteção de Dados Pessoais (Lei nº
        13.709/2018, &quot;LGPD&quot;). Ela complementa os <Link href="/termos">Termos de Uso</Link>.
      </p>

      <h2>1. Quem é responsável pelos seus dados</h2>
      <p>O papel do AutoConnect muda conforme o dado:</p>
      <ul>
        <li>
          <strong>Somos controladores</strong> dos dados da sua conta na plataforma (cadastro,
          login, preferências, favoritos, buscas salvas e alertas) e dos dados técnicos de uso.
        </li>
        <li>
          <strong>Somos operadores</strong> dos dados que uma concessionária gerencia no seu
          painel — leads, conversas, agendamentos, negócios, dados de comprador e contratos. Nesse
          caso, a <strong>concessionária é a controladora</strong>: ela decide para que usa esses
          dados, e nós os tratamos em nome dela e segundo as instruções dela.
        </li>
      </ul>
      <p>
        Se o seu pedido for sobre dados que uma concessionária tem de você, você pode falar com ela
        diretamente ou conosco — nós encaminhamos e apoiamos a resposta.
      </p>

      <h2>2. Quais dados coletamos</h2>
      <h3>Dados que você nos informa</h3>
      <ul>
        <li><strong>Conta:</strong> nome, e-mail, telefone e senha (guardada apenas como hash, nunca em texto).</li>
        <li>
          <strong>Login com Google:</strong> se você escolher entrar com o Google, recebemos seu
          nome, e-mail e foto de perfil. Não acessamos sua agenda, seus contatos, seu Gmail nem
          qualquer outro dado da conta Google.
        </li>
        <li>
          <strong>Perfil de cliente (opcional):</strong> CPF, data de nascimento, cidade, estado,
          CEP e forma de contato preferida.
        </li>
        <li>
          <strong>Compra de veículo:</strong> para emitir o contrato, a concessionária registra os
          dados de qualificação do comprador — nome completo, CPF, RG e órgão emissor,
          nacionalidade, estado civil, profissão e endereço.
        </li>
        <li>
          <strong>Equipe da concessionária:</strong> nome, e-mail, telefone, cargo, papel no
          sistema, metas e comissões.
        </li>
        <li>
          <strong>Conversas e interesse:</strong> mensagens trocadas no chat, pedidos de contato
          (leads), agendamentos de visita e test drive, e o histórico desses atendimentos.
        </li>
      </ul>

      <h3>Dados gerados pelo uso</h3>
      <ul>
        <li>Veículos visualizados, favoritos, buscas salvas e alertas de preço.</li>
        <li>
          Dados de sessão: endereço IP, tipo de navegador e dispositivo, e data do último acesso —
          usados para manter você conectado e proteger a conta.
        </li>
      </ul>

      <h3>Localização</h3>
      <p>
        Na busca por mapa, se você tocar em &quot;minha localização&quot;, o navegador pede sua
        permissão e informa sua posição para centralizar o mapa e mostrar as lojas próximas. Essa
        posição é usada <strong>apenas no seu aparelho</strong>: não a enviamos nem a
        armazenamos em nossos servidores. Você pode negar ou revogar a permissão no navegador.
      </p>

      <h3>O que não coletamos</h3>
      <p>
        Não usamos ferramentas de publicidade, pixels de rastreamento nem analytics de terceiros.
        Não coletamos dados sensíveis (origem racial, saúde, religião, biometria etc.) e não
        tomamos decisões automatizadas que afetem seus direitos.
      </p>

      <h2>3. Para que usamos os dados e com qual base legal</h2>
      <ul>
        <li>
          <strong>Criar e manter sua conta, autenticar o acesso e prestar o serviço</strong> —
          execução de contrato (art. 7º, V, da LGPD).
        </li>
        <li>
          <strong>Conectar você à concessionária</strong> (chat, leads, agendamentos, lembretes por
          e-mail) — execução de contrato e procedimentos preliminares a pedido do titular (art. 7º, V).
        </li>
        <li>
          <strong>Emitir contrato de compra e venda e registrar o negócio</strong> — execução de
          contrato e cumprimento de obrigação legal ou regulatória (art. 7º, II e V).
        </li>
        <li>
          <strong>Segurança, prevenção a fraude e registros de acesso</strong> — legítimo interesse
          e cumprimento do Marco Civil da Internet (art. 7º, II e IX; Lei nº 12.965/2014, art. 15).
        </li>
        <li>
          <strong>Alertas de preço e buscas salvas</strong> — você os ativa e desativa quando
          quiser; tratamos com base no seu consentimento (art. 7º, I), que pode ser revogado a
          qualquer momento.
        </li>
        <li>
          <strong>Exercício de direitos em processos</strong> — art. 7º, VI.
        </li>
      </ul>

      <h2>4. Com quem compartilhamos</h2>
      <p><strong>Não vendemos nem alugamos dados pessoais.</strong> Compartilhamos apenas:</p>
      <ul>
        <li>
          <strong>Com a concessionária com que você interage</strong> — ao mandar mensagem,
          demonstrar interesse, agendar ou comprar, seus dados de contato e do atendimento ficam
          disponíveis para a equipe daquela loja. Uma concessionária não vê os dados que você
          compartilhou com outra.
        </li>
        <li>
          <strong>Com fornecedores que operam a plataforma por nós</strong>, sob contrato e apenas
          para o serviço contratado:
          <ul>
            <li>Supabase — banco de dados e armazenamento privado de documentos (servidores em São Paulo, Brasil);</li>
            <li>Railway — hospedagem da aplicação (servidores nos Estados Unidos);</li>
            <li>Cloudinary — hospedagem das fotos de veículos anunciados (Estados Unidos);</li>
            <li>Google — login com Google, quando você o escolhe;</li>
            <li>Resend e/ou Google (Gmail) — envio de e-mails transacionais, como confirmação de conta, redefinição de senha, convites e lembretes.</li>
          </ul>
        </li>
        <li>
          <strong>Com autoridades</strong>, quando houver obrigação legal ou ordem judicial.
        </li>
        <li>
          <strong>Em operação societária</strong> (fusão, aquisição), mantidas as garantias desta Política.
        </li>
      </ul>

      <h2>5. Transferência internacional</h2>
      <p>
        O banco de dados fica no Brasil, mas a aplicação é hospedada nos Estados Unidos e as fotos
        de veículos ficam em servidores fora do país. Por isso, dados pessoais podem ser
        processados no exterior. Essas transferências se apoiam nas hipóteses do art. 33 da LGPD,
        incluindo cláusulas contratuais com os fornecedores e a execução do contrato com você, e
        os fornecedores adotam padrões de segurança compatíveis com esta Política.
      </p>

      <h2>6. Armazenamento no navegador e cookies</h2>
      <p>
        Não usamos cookies de publicidade nem de rastreamento. Usamos o armazenamento local do seu
        navegador (<em>localStorage</em>) apenas para o funcionamento do site:
      </p>
      <ul>
        <li>manter você conectado (token de sessão);</li>
        <li>lembrar o tema claro ou escuro;</li>
        <li>lembrar avisos que você já dispensou;</li>
        <li>marcar veículos e lojas que você já visitou na busca.</li>
      </ul>
      <p>
        Esses itens ficam no seu aparelho e somem ao sair da conta ou limpar os dados do navegador.
      </p>

      <h2>7. Como protegemos</h2>
      <ul>
        <li>Conexão criptografada (HTTPS) em todo o site.</li>
        <li>Senhas guardadas apenas como hash.</li>
        <li>
          Isolamento no banco de dados: os dados de cada concessionária são separados por regras de
          segurança no próprio banco, e uma loja não consegue ler os dados de outra.
        </li>
        <li>
          Contratos e documentos ficam em armazenamento privado, sem endereço público; o acesso é
          por link temporário que expira em 10 minutos, e cada contrato tem uma impressão digital
          (hash) que permite detectar alteração.
        </li>
        <li>Acesso interno restrito a quem precisa, por perfil de usuário.</li>
      </ul>
      <p>
        Nenhum sistema é totalmente imune a incidentes. Se ocorrer um incidente que possa trazer
        risco ou dano relevante, comunicaremos os titulares afetados e a ANPD, como exige a LGPD.
      </p>

      <h2>8. Por quanto tempo guardamos</h2>
      <ul>
        <li><strong>Dados de conta:</strong> enquanto a conta estiver ativa.</li>
        <li>
          <strong>Registros de acesso:</strong> por 6 meses, prazo mínimo do Marco Civil da Internet.
        </li>
        <li>
          <strong>Contratos, negócios e dados do comprador:</strong> pelo prazo que a concessionária
          precisa guardar para cumprir obrigações legais, fiscais e se defender em processos — em
          regra, até 5 anos após o fim da relação, podendo ser maior quando a lei exigir.
        </li>
        <li>
          <strong>Conversas e leads:</strong> enquanto a concessionária mantiver a conta, ou até que
          você peça a exclusão, respeitadas as obrigações da concessionária.
        </li>
      </ul>
      <p>
        Ao fim do prazo, os dados são excluídos ou anonimizados, salvo quando a guarda for
        permitida pelo art. 16 da LGPD.
      </p>

      <h2>9. Seus direitos</h2>
      <p>Pela LGPD (art. 18), você pode, a qualquer momento:</p>
      <ul>
        <li>confirmar se tratamos seus dados e acessá-los;</li>
        <li>corrigir dados incompletos, inexatos ou desatualizados;</li>
        <li>pedir anonimização, bloqueio ou eliminação de dados desnecessários ou tratados em desconformidade;</li>
        <li>pedir a portabilidade dos dados a outro fornecedor;</li>
        <li>pedir a eliminação dos dados tratados com base no seu consentimento;</li>
        <li>saber com quem compartilhamos seus dados;</li>
        <li>revogar o consentimento e ser informado sobre as consequências de não o dar;</li>
        <li>se opor a tratamento feito em desconformidade com a lei.</li>
      </ul>
      <p>
        Grande parte dos dados pode ser vista e editada direto no seu perfil. Para os demais
        pedidos, escreva para <a href={`mailto:${CONTATO_LEGAL}`}>{CONTATO_LEGAL}</a>.
        Podemos pedir informações para confirmar sua identidade antes de atender, e respondemos em
        até 15 dias. Você também pode apresentar reclamação à Autoridade Nacional de Proteção de
        Dados (ANPD), em <a href="https://www.gov.br/anpd" target="_blank" rel="noreferrer">gov.br/anpd</a>.
      </p>

      <h2>10. Crianças e adolescentes</h2>
      <p>
        A plataforma é destinada a maiores de 18 anos. Não coletamos intencionalmente dados de
        menores; se identificarmos esse caso, os dados serão excluídos.
      </p>

      <h2>11. Mudanças nesta Política</h2>
      <p>
        Podemos atualizar esta Política quando o serviço ou a lei mudarem. A data de vigência fica
        no topo da página; em mudanças relevantes, avisaremos por e-mail ou dentro da plataforma
        antes de elas valerem.
      </p>

      <h2>12. Contato e encarregado</h2>
      <p>
        O canal do encarregado pelo tratamento de dados pessoais (DPO) é{' '}
        <a href={`mailto:${CONTATO_LEGAL}`}>{CONTATO_LEGAL}</a>. Use-o para dúvidas, pedidos e
        reclamações sobre privacidade.
      </p>
    </PaginaLegal>
  );
}
