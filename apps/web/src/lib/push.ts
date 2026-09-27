'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';

/**
 * Notificação push neste aparelho: o service worker, a permissão do navegador
 * e a inscrição na API.
 *
 * O estado que a tela mostra, e por quê:
 * - `sem-suporte`: o navegador não tem push (raro fora do iPhone);
 * - `iphone-sem-app`: o Safari do iPhone só recebe push com o AutoConnect na
 *   tela inicial (iOS 16.4+) — é o caso mais comum de "não funciona", e a tela
 *   ensina o caminho em vez de esconder o botão;
 * - `bloqueado`: a pessoa negou a permissão; só se libera nas configurações do
 *   site, e a tela diz isso;
 * - `indisponivel`: o servidor não tem push configurado.
 */
/**
 * Aviso entre as partes da tela que mostram o estado do push (o cartão de
 * Canais e o convite da barra lateral): ativou num, o outro some.
 */
const EVENTO_DE_MUDANCA = 'autoconnect:push-mudou';

export type EstadoDoPush =
  | 'carregando' | 'indisponivel' | 'sem-suporte' | 'iphone-sem-app' | 'bloqueado' | 'desativado' | 'ativado';

function ehIphone(): boolean {
  return /iPhone|iPad|iPod/.test(navigator.userAgent);
}

function instaladoNaTelaInicial(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function suportaPush(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

/** A chave VAPID vem em base64url; o `subscribe` quer bytes. */
function bytesDaChave(chave: string): ArrayBuffer {
  const b64 = (chave + '='.repeat((4 - (chave.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const bruto = atob(b64);
  const buffer = new ArrayBuffer(bruto.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bruto.length; i++) bytes[i] = bruto.charCodeAt(i);
  return buffer;
}

async function registroDoServiceWorker(): Promise<ServiceWorkerRegistration> {
  return (await navigator.serviceWorker.getRegistration('/')) ?? navigator.serviceWorker.register('/sw.js');
}

async function inscricaoAtual(): Promise<PushSubscription | null> {
  if (!suportaPush()) return null;
  const registro = await navigator.serviceWorker.getRegistration('/');
  return registro ? registro.pushManager.getSubscription() : null;
}

/**
 * Este aparelho já recebe push? O aviso da aba aberta (o polling do menu)
 * consulta isto para não repetir o que o push já mostrou.
 */
export async function temPushNesteAparelho(): Promise<boolean> {
  try {
    return typeof Notification !== 'undefined' && Notification.permission === 'granted' && !!(await inscricaoAtual());
  } catch {
    // Silencioso com motivo: na dúvida, o aviso da aba sai — melhor repetido que perdido.
    return false;
  }
}

/**
 * Ao sair da conta: o aparelho para de receber os avisos desta pessoa. Sem
 * isto, quem entrasse depois no mesmo celular veria os leads da anterior.
 * Melhor-esforço: sair da conta nunca pode falhar por causa do push.
 */
export async function desinscreverEsteAparelho(token: string | null): Promise<void> {
  try {
    const inscricao = await inscricaoAtual();
    if (!inscricao) return;
    if (token) {
      await api('/push/inscricoes/remover', { method: 'POST', token, body: { endpoint: inscricao.endpoint } })
        // Silencioso com motivo: a API fora do ar não pode impedir o logout;
        // o `unsubscribe` abaixo já corta o aviso neste aparelho.
        .catch(() => undefined);
    }
    await inscricao.unsubscribe();
  } catch {
    // Silencioso com motivo: ver acima — o logout segue de qualquer jeito.
  }
}

export function usePush(token: string | null) {
  const [estado, setEstado] = useState<EstadoDoPush>('carregando');
  const [chavePublica, setChavePublica] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const avaliar = useCallback(async () => {
    if (!token) return;
    if (!suportaPush()) {
      setEstado(ehIphone() && !instaladoNaTelaInicial() ? 'iphone-sem-app' : 'sem-suporte');
      return;
    }
    try {
      const cap = await api<{ disponivel: boolean; chavePublica: string | null }>('/push/capacidade', { token });
      if (!cap.disponivel || !cap.chavePublica) { setEstado('indisponivel'); return; }
      setChavePublica(cap.chavePublica);
      if (Notification.permission === 'denied') { setEstado('bloqueado'); return; }
      setEstado((await inscricaoAtual()) && Notification.permission === 'granted' ? 'ativado' : 'desativado');
    } catch {
      // Silencioso com motivo: sem a resposta, a oferta de ativar só não
      // aparece — nada do que o usuário espera ver depende dela.
      setEstado('indisponivel');
    }
  }, [token]);

  useEffect(() => {
    void avaliar();
    const reavaliar = () => { void avaliar(); };
    window.addEventListener(EVENTO_DE_MUDANCA, reavaliar);
    return () => window.removeEventListener(EVENTO_DE_MUDANCA, reavaliar);
  }, [avaliar]);

  const ativar = useCallback(async () => {
    if (!token || !chavePublica) return;
    setOcupado(true);
    setErro(null);
    try {
      const permissao = await Notification.requestPermission();
      if (permissao !== 'granted') {
        setEstado(permissao === 'denied' ? 'bloqueado' : 'desativado');
        return;
      }
      const registro = await registroDoServiceWorker();
      await navigator.serviceWorker.ready;
      const inscricao = (await registro.pushManager.getSubscription()) ??
        await registro.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytesDaChave(chavePublica) });
      await api('/push/inscricoes', { method: 'POST', token, body: inscricao.toJSON() });
      setEstado('ativado');
      window.dispatchEvent(new Event(EVENTO_DE_MUDANCA));
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Não foi possível ativar as notificações.');
    } finally {
      setOcupado(false);
    }
  }, [token, chavePublica]);

  const desativar = useCallback(async () => {
    setOcupado(true);
    setErro(null);
    await desinscreverEsteAparelho(token);
    setEstado('desativado');
    setOcupado(false);
    window.dispatchEvent(new Event(EVENTO_DE_MUDANCA));
  }, [token]);

  const testar = useCallback(async () => {
    if (!token) return;
    setOcupado(true);
    setErro(null);
    try {
      const r = await api<{ enviados: number }>('/push/teste', { method: 'POST', token });
      if (r.enviados === 0) setErro('O aviso não saiu: reative as notificações neste aparelho.');
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'O teste falhou.');
    } finally {
      setOcupado(false);
    }
  }, [token]);

  return { estado, ocupado, erro, ativar, desativar, testar };
}
