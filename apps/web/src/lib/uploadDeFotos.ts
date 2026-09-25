/**
 * Envio de foto de veículo para a Cloudinary.
 *
 * ## Por que isto existe
 *
 * Sem `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME` toda foto falhava com **"Falha ao
 * enviar uma das imagens"** — a URL montada era
 * `https://api.cloudinary.com/v1_1//image/upload`, com o nome vazio no meio. E
 * como `domain/anuncio.ts` exige pelo menos uma foto para publicar, **nenhum
 * carro chegava ao catálogo público**: o produto inteiro parava num ambiente
 * novo, e a única pista que o lojista recebia era "falhou o envio". Ele
 * tentava cinco vezes com cinco fotos diferentes e concluía que o sistema
 * estava quebrado.
 *
 * A diferença entre "não configurado" e "falhou o envio" é a diferença entre
 * "falta configurar" e "está quebrado" — e só a primeira tem conserto do lado
 * de quem instala. A API já dá o exemplo certo com o `DocumentosStorage`, que
 * avisa na subida quando o Supabase Storage não está configurado; `avisarSeNaoConfigurada`
 * faz o mesmo aqui.
 *
 * ## Duas destinações, de propósito
 *
 * Foto de veículo vai para a Cloudinary com preset *unsigned* (é pública por
 * natureza). Contrato e documento de identidade vão para o Supabase Storage,
 * num bucket privado, com upload pelo backend. Misturar os dois é como uma
 * política de bucket afrouxada expõe documento com CPF.
 */

const CLOUD_NAME = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME ?? '';
const UPLOAD_PRESET = process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET ?? '';

/**
 * ⚠ `NEXT_PUBLIC_*` é embutida no bundle durante o `next build`, não lida em
 * tempo de execução: mudar a variável na plataforma sem um build novo não tem
 * efeito nenhum.
 */
export const ENVIO_DE_FOTOS_CONFIGURADO = CLOUD_NAME !== '' && UPLOAD_PRESET !== '';

export const MOTIVO_ENVIO_INDISPONIVEL =
  'Envio de fotos indisponível neste ambiente: a integração de imagens não está ' +
  'configurada. Fale com o suporte do AutoConnect — não é problema da sua foto.';

/** Falha por configuração ausente, distinta de falha de envio. */
export class EnvioDeFotosNaoConfigurado extends Error {
  constructor() {
    super(MOTIVO_ENVIO_INDISPONIVEL);
    this.name = 'EnvioDeFotosNaoConfigurado';
  }
}

/**
 * Avisa uma vez, no console do navegador, quando a integração não está de pé.
 *
 * Complementa o aviso do servidor em `next.config.mjs`: quem abre o painel num
 * ambiente mal configurado vê a causa sem precisar do log da plataforma.
 */
let jaAvisou = false;
export function avisarSeNaoConfigurada(): void {
  if (ENVIO_DE_FOTOS_CONFIGURADO || jaAvisou) return;
  jaAvisou = true;
  // eslint-disable-next-line no-console
  console.warn(
    '[AutoConnect] NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME/..._UPLOAD_PRESET ausentes: ' +
      'o envio de fotos de veículo está desligado, e sem foto nenhum veículo é ' +
      'publicado. Defina as duas variáveis e refaça o build do web.',
  );
}

/**
 * Sobe uma imagem e devolve a URL segura. Lança com a causa nomeada.
 *
 * Um caminho só para tudo que o navegador manda para a Cloudinary — foto de
 * veículo e avatar. O avatar tinha a mesma cópia do `fetch` dentro de
 * `perfil/page.tsx`, com a mesma URL vazia e a mesma mensagem cega
 * ("Falha no upload").
 */
async function enviarImagem(file: File, pasta: string): Promise<string> {
  if (!ENVIO_DE_FOTOS_CONFIGURADO) throw new EnvioDeFotosNaoConfigurado();

  const form = new FormData();
  form.append('file', file);
  form.append('upload_preset', UPLOAD_PRESET);
  form.append('folder', pasta);

  let res: Response;
  try {
    res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`, {
      method: 'POST',
      body: form,
    });
  } catch {
    throw new Error(
      `Não conseguimos falar com o servidor de imagens ao enviar "${file.name}". ` +
        'Verifique sua conexão e tente de novo.',
    );
  }

  if (!res.ok) {
    // A Cloudinary devolve o motivo em `error.message` (preset errado, arquivo
    // grande demais, formato recusado). Repeti-lo é o que permite ao lojista
    // saber se o problema é a foto dele.
    let detalhe = `erro ${res.status}`;
    try {
      const corpo = (await res.json()) as { error?: { message?: string } };
      if (corpo?.error?.message) detalhe = corpo.error.message;
    } catch {
      // resposta não é JSON — o status já diz o suficiente
    }
    throw new Error(`Não foi possível enviar "${file.name}": ${detalhe}`);
  }

  const data = (await res.json()) as { secure_url: string };
  return data.secure_url;
}

/** Foto de veículo — pública por natureza (o catálogo a exibe). */
export function enviarFotoDeVeiculo(file: File): Promise<string> {
  return enviarImagem(file, 'autoconnect/vehicles');
}

/** Avatar do cliente. */
export function enviarAvatar(file: File): Promise<string> {
  return enviarImagem(file, 'autoconnect/avatars');
}
