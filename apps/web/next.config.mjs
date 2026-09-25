/**
 * Serviço externo que o **navegador** chama também precisa dizer quando não
 * está configurado.
 *
 * A API já faz isso no boot com o `DocumentosStorage` ("SUPABASE_URL/… ausentes:
 * documentos não serão arquivados"). A Cloudinary, que é mais crítica — sem ela
 * nenhuma foto sobe, e sem foto nenhum veículo é publicado —, não dizia nada:
 * o lojista via "Falha ao enviar uma das imagens" e concluía que o produto
 * estava quebrado.
 *
 * Este aviso sai no `next build` **e** na subida do servidor, que são os dois
 * momentos em que quem instala está olhando. É aqui e não no código da página
 * porque `NEXT_PUBLIC_*` é embutida no bundle durante o build: o valor que
 * importa é o desta máquina, neste instante.
 */
function avisarConfiguracaoAusente() {
  const faltando = [
    'NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME',
    'NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET',
  ].filter((v) => !process.env[v]);

  if (faltando.length === 0) return;

  console.warn(
    `\n⚠  ${faltando.join(' e ')} ausente(s): o envio de fotos de veículo fica ` +
      'desligado.\n   Sem foto nenhum veículo pode ser publicado — o catálogo ' +
      'público nasce vazio.\n   A tela avisa o usuário, mas quem resolve é quem ' +
      'define a variável e refaz o build.\n',
  );
}

avisarConfiguracaoAusente();

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@autoconnect/shared'],
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**.supabase.co' },
      { protocol: 'https', hostname: '**.cloudfront.net' },
    ],
  },
};

export default nextConfig;
