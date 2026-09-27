/**
 * Layout único de todo e-mail do AutoConnect.
 *
 * HTML de e-mail não é HTML de página: Outlook desenha com o motor do Word,
 * Gmail descarta `<style>` em vários clientes e quase todos bloqueiam imagem
 * até o usuário liberar. Por isso:
 *
 * - **tabelas** para a estrutura e **estilo inline** em tudo;
 * - botão "à prova de bala" (tabela com fundo, não `<a>` com padding), mais o
 *   endereço por extenso embaixo — é o que salva quem abre no Outlook antigo
 *   ou tem o botão cortado pelo filtro;
 * - a marca é **texto**, com o símbolo como imagem opcional: com imagem
 *   bloqueada, o cabeçalho continua dizendo "AutoConnect";
 * - `color-scheme: light` para o modo escuro do cliente não inverter o azul
 *   do botão num cinza ilegível;
 * - texto de pré-visualização (`preheader`) escondido no topo: é a linha que a
 *   caixa de entrada mostra ao lado do assunto.
 *
 * **Quem chama escapa.** `paragrafos` e `nota` entram como HTML (para aceitar
 * `<strong>`), então todo dado vindo de formulário tem de passar por `esc`
 * antes. Os campos de texto puro (`etiqueta`, `titulo`, `preheader`,
 * `detalhes`, `motivo`, `botao.texto`) são escapados aqui.
 */

export function esc(texto: string): string {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** O tom pinta a faixa do topo do cartão e a etiqueta. */
export type TomDoEmail = 'info' | 'sucesso' | 'atencao' | 'urgente';

const COR_DO_TOM: Record<TomDoEmail, string> = {
  info: '#2563eb',
  sucesso: '#059669',
  atencao: '#d97706',
  urgente: '#dc2626',
};

export interface ConteudoDoEmail {
  /** Rótulo curto acima do título, em caixa alta: "Cobrança", "Novo lead". */
  etiqueta: string;
  titulo: string;
  /** Linha de pré-visualização da caixa de entrada. */
  preheader: string;
  /** HTML já seguro — quem chama escapa o que veio de formulário. */
  paragrafos: string[];
  /** Quadro de dados (plano, valor, vencimento…). Texto puro. */
  detalhes?: { rotulo: string; valor: string }[];
  botao?: { texto: string; url: string };
  /** Observação menor, abaixo do botão. HTML já seguro. */
  nota?: string;
  /** Por que a pessoa recebeu este e-mail. Texto puro. */
  motivo: string;
  tom?: TomDoEmail;
}

export interface MarcaDoEmail {
  /** Origem do site, sem barra no fim — para o símbolo e o link do rodapé. */
  webUrl: string;
  /** E-mail de suporte que aparece no rodapé. */
  suporte: string;
}

const FONTE = "'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export function montarEmail(c: ConteudoDoEmail, marca: MarcaDoEmail): string {
  const cor = COR_DO_TOM[c.tom ?? 'info'];
  const site = marca.webUrl.replace(/\/+$/, '');
  const dominio = site.replace(/^https?:\/\//, '');

  const paragrafos = c.paragrafos
    .map((p) => `<p style="margin:0 0 16px;font-size:15px;line-height:24px;color:#334155">${p}</p>`)
    .join('');

  const detalhes = c.detalhes?.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
          style="margin:8px 0 24px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px">
        ${c.detalhes
          .map(
            (d, i) => `<tr>
          <td style="padding:12px 16px;${i ? 'border-top:1px solid #e2e8f0;' : ''}font-size:13px;color:#64748b;width:45%">${esc(d.rotulo)}</td>
          <td style="padding:12px 16px;${i ? 'border-top:1px solid #e2e8f0;' : ''}font-size:14px;color:#0f172a;font-weight:600;text-align:right">${esc(d.valor)}</td>
        </tr>`,
          )
          .join('')}
      </table>`
    : '';

  const botao = c.botao
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 16px">
        <tr><td bgcolor="#2563eb" style="border-radius:8px">
          <a href="${esc(c.botao.url)}" target="_blank"
             style="display:inline-block;padding:13px 28px;font-family:${FONTE};font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px">${esc(c.botao.texto)}</a>
        </td></tr>
      </table>
      <p style="margin:0 0 20px;font-size:12px;line-height:18px;color:#94a3b8">
        Se o botão não funcionar, copie e cole este endereço no navegador:<br/>
        <a href="${esc(c.botao.url)}" style="color:#2563eb;word-break:break-all">${esc(c.botao.url)}</a>
      </p>`
    : '';

  const nota = c.nota
    ? `<p style="margin:0;padding-top:16px;border-top:1px solid #e2e8f0;font-size:13px;line-height:20px;color:#64748b">${c.nota}</p>`
    : '';

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<meta name="color-scheme" content="light"/>
<meta name="supported-color-schemes" content="light"/>
<title>${esc(c.titulo)}</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#f1f5f9">${esc(c.preheader)}&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f1f5f9">
<tr><td align="center" style="padding:32px 16px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;font-family:${FONTE}">
    <tr><td style="padding:0 4px 20px">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td style="vertical-align:middle;padding-right:10px">
          <img src="${esc(site)}/icon-192.png" width="32" height="32" alt="" style="display:block;border:0;border-radius:8px"/>
        </td>
        <td style="vertical-align:middle;font-size:20px;font-weight:700;color:#0f172a;letter-spacing:-0.3px">AutoConnect</td>
      </tr></table>
    </td></tr>
    <tr><td style="background:#ffffff;border:1px solid #e2e8f0;border-top:4px solid ${cor};border-radius:12px;padding:32px 32px 28px">
      <p style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:${cor}">${esc(c.etiqueta)}</p>
      <h1 style="margin:0 0 20px;font-size:22px;line-height:30px;font-weight:700;color:#0f172a">${esc(c.titulo)}</h1>
      ${paragrafos}
      ${detalhes}
      ${botao}
      ${nota}
    </td></tr>
    <tr><td style="padding:24px 8px 0;font-size:12px;line-height:19px;color:#94a3b8;text-align:center">
      ${esc(c.motivo)}<br/>
      Dúvidas? Escreva para <a href="mailto:${esc(marca.suporte)}" style="color:#64748b">${esc(marca.suporte)}</a>.<br/><br/>
      <strong style="color:#64748b">AutoConnect</strong> · Atendimento e vendas para revendas e concessionárias<br/>
      <a href="${esc(site)}" style="color:#94a3b8">${esc(dominio)}</a>
    </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`;
}
