import type { Metadata } from 'next';
import Link from 'next/link';
import PaginaLegal, { CONTATO_LEGAL } from '@/components/PaginaLegal';

export const metadata: Metadata = {
  title: 'Termos de Uso — AutoConnect',
  description: 'Regras de uso da plataforma AutoConnect para clientes e concessionárias.',
};

// ⚠ Texto redigido a partir do funcionamento real da plataforma, mas ainda sem
// revisão jurídica — mesma ressalva do template de contrato.
export default function TermosPage() {
  return (
    <PaginaLegal
      titulo="Termos de Uso"
      resumo="O AutoConnect conecta você a concessionárias de veículos. Quem vende o carro é a concessionária: ela responde pelo veículo, pelo preço e pelo contrato. Nós fornecemos a plataforma, cuidamos dos seus dados e mantemos o serviço funcionando."
    >
      <p>
        Estes Termos regem o uso do site e dos serviços do <strong>AutoConnect</strong>{' '}
        (&quot;plataforma&quot;, &quot;nós&quot;). Ao criar uma conta ou usar a plataforma, você
        concorda com eles e com a <Link href="/privacidade">Política de Privacidade</Link>. Se não
        concordar, não use a plataforma.
      </p>

      <h2>1. O que é o AutoConnect</h2>
      <p>
        O AutoConnect é um software para concessionárias de veículos e um espaço onde clientes
        encontram veículos à venda. A plataforma oferece catálogo e busca por mapa, chat entre
        cliente e vendedor, agendamento de visitas e test drives, gestão de leads e de equipe, e
        ferramentas de negócio e contrato para a concessionária.
      </p>
      <p>
        <strong>O AutoConnect não é vendedor, intermediário financeiro nem parte na compra e venda
        de veículos.</strong> Anúncios, preços, condições, estado dos veículos, negociação,
        pagamento, entrega, garantia e documentação são de responsabilidade exclusiva da
        concessionária que anuncia.
      </p>

      <h2>2. Conta</h2>
      <ul>
        <li>É preciso ter 18 anos ou mais e plena capacidade civil.</li>
        <li>As informações do cadastro devem ser verdadeiras e mantidas atualizadas.</li>
        <li>
          Você é responsável pelo sigilo da sua senha e por tudo o que acontecer na sua conta. Se
          suspeitar de uso indevido, troque a senha e nos avise em{' '}
          <a href={`mailto:${CONTATO_LEGAL}`}>{CONTATO_LEGAL}</a>.
        </li>
        <li>
          Ao entrar com o Google, você também está sujeito aos termos do Google para a sua conta.
        </li>
      </ul>

      <h2>3. Para clientes</h2>
      <ul>
        <li>
          Você pode buscar veículos, favoritar, salvar buscas, criar alertas de preço, conversar
          com vendedores e agendar visitas e test drives, sem custo.
        </li>
        <li>
          As informações dos anúncios são fornecidas pelas concessionárias. Confirme com a loja o
          estado, a documentação e as condições do veículo antes de fechar negócio.
        </li>
        <li>
          Em test drives, siga as regras da concessionária e a legislação de trânsito; é
          necessário ter habilitação válida.
        </li>
        <li>
          A relação de consumo na compra do veículo é entre você e a concessionária, que responde
          nos termos do Código de Defesa do Consumidor. Podemos ajudar a encaminhar reclamações,
          mas a solução cabe à loja.
        </li>
      </ul>

      <h2>4. Para concessionárias</h2>
      <ul>
        <li>
          O uso do painel é contratado conforme proposta comercial, que define plano, preço e
          forma de pagamento. Serviços cobrados por uso — como consultas veiculares — são cobrados
          por chamada, conforme o valor informado na plataforma no momento da consulta.
        </li>
        <li>
          A concessionária garante que seus anúncios são verdadeiros, que tem direito de vender os
          veículos anunciados e que possui as licenças exigidas para a atividade.
        </li>
        <li>
          A concessionária é a <strong>controladora</strong> dos dados dos seus clientes e da sua
          equipe tratados no painel, e deve ter base legal para esse tratamento, nos termos da
          LGPD. O AutoConnect atua como <strong>operador</strong>, tratando esses dados apenas
          para prestar o serviço.
        </li>
        <li>
          A concessionária responde pelos usuários que convida para a equipe e pelos papéis e
          permissões que atribui.
        </li>
        <li>
          <strong>Contratos:</strong> a plataforma gera o contrato de compra e venda a partir de um
          modelo e dos dados informados pela concessionária. O modelo é um ponto de partida e não
          substitui orientação jurídica: cabe à concessionária revisá-lo e adaptá-lo antes de
          usar, e ela responde pelo conteúdo e pelas obrigações assumidas no contrato que emite.
        </li>
      </ul>

      <h2>5. O que não é permitido</h2>
      <ul>
        <li>Publicar anúncio falso ou enganoso, ou de veículo que não se tem direito de vender.</li>
        <li>Usar a plataforma para fraude, golpe ou qualquer atividade ilegal.</li>
        <li>Enviar spam ou conteúdo ofensivo, discriminatório ou que viole direitos de terceiros.</li>
        <li>Coletar dados de outros usuários sem autorização, inclusive por robôs ou raspagem.</li>
        <li>
          Tentar acessar dados de outra concessionária ou conta, contornar medidas de segurança ou
          sobrecarregar os sistemas.
        </li>
        <li>Copiar, revender ou explorar comercialmente a plataforma sem autorização.</li>
      </ul>

      <h2>6. Conteúdo</h2>
      <p>
        Fotos, descrições e demais conteúdos enviados continuam sendo de quem os enviou. Ao
        publicá-los, você nos autoriza a armazená-los, exibi-los e adaptá-los (por exemplo,
        redimensionar fotos) apenas para operar a plataforma. Você declara ter os direitos sobre o
        que envia. A marca, o software e o design do AutoConnect são nossos e protegidos por lei.
      </p>

      <h2>7. Disponibilidade</h2>
      <p>
        Trabalhamos para manter a plataforma disponível e segura, mas ela pode passar por
        manutenções, atualizações e falhas de fornecedores. Podemos alterar, incluir ou remover
        funcionalidades; mudanças que afetem de forma relevante um serviço contratado serão
        avisadas com antecedência.
      </p>

      <h2>8. Responsabilidade</h2>
      <p>
        Respondemos pelos serviços que prestamos, nos termos da lei. Não respondemos pelos atos
        das concessionárias e dos usuários, pelo conteúdo dos anúncios, pela negociação, pelo
        veículo ou pelo contrato celebrado entre cliente e concessionária. Para concessionárias, a
        responsabilidade do AutoConnect por danos indiretos e lucros cessantes fica excluída, e a
        responsabilidade total limita-se ao valor pago nos 12 meses anteriores ao fato. Nada
        nestes Termos limita direitos do consumidor garantidos pelo Código de Defesa do Consumidor.
      </p>

      <h2>9. Suspensão e encerramento</h2>
      <p>
        Você pode encerrar sua conta quando quiser, pedindo em{' '}
        <a href={`mailto:${CONTATO_LEGAL}`}>{CONTATO_LEGAL}</a>. Podemos suspender ou encerrar
        contas que violem estes Termos ou a lei, ou para proteger outros usuários, avisando o
        motivo sempre que possível. Após o encerramento, os dados são tratados conforme a{' '}
        <Link href="/privacidade">Política de Privacidade</Link>, inclusive quanto aos prazos
        legais de guarda.
      </p>

      <h2>10. Mudanças nestes Termos</h2>
      <p>
        Podemos atualizar estes Termos. A data de vigência fica no topo da página; mudanças
        relevantes serão avisadas por e-mail ou na plataforma antes de valerem. Continuar usando a
        plataforma depois disso significa aceitar a nova versão.
      </p>

      <h2>11. Lei e foro</h2>
      <p>
        Estes Termos seguem a lei brasileira. Para clientes consumidores, o foro é o do seu
        domicílio. Nos demais casos, fica eleito o foro do domicílio do AutoConnect.
      </p>

      <h2>12. Contato</h2>
      <p>
        Dúvidas sobre estes Termos: <a href={`mailto:${CONTATO_LEGAL}`}>{CONTATO_LEGAL}</a>.
      </p>
    </PaginaLegal>
  );
}
