/*
 * Service worker do AutoConnect — só notificação push.
 *
 * Não intercepta requisição nenhuma (não há `fetch` aqui) de propósito: um
 * cache mal invalidado serviria tela velha depois de um deploy, e o painel
 * depende de dado fresco. O trabalho deste arquivo é um só: mostrar o aviso de
 * lead novo e de mensagem do cliente com o navegador fechado, e levar o toque
 * para a tela certa.
 */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let n = { titulo: 'AutoConnect', corpo: '', url: '/leads', etiqueta: 'autoconnect' };
  try {
    n = { ...n, ...event.data.json() };
  } catch (e) {
    // Aviso sem corpo legível: mostra o genérico em vez de nada.
  }
  event.waitUntil(
    self.registration.showNotification(n.titulo, {
      body: n.corpo,
      // Mesma etiqueta substitui o aviso anterior (a conversa, o lead); o
      // `renotify` faz o celular vibrar de novo mesmo assim.
      tag: n.etiqueta,
      renotify: true,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: n.url },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const destino = new URL((event.notification.data && event.notification.data.url) || '/leads', self.location.origin).href;
  event.waitUntil((async () => {
    const janelas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const janela of janelas) {
      if (janela.url.startsWith(self.location.origin) && 'focus' in janela) {
        await janela.focus();
        if ('navigate' in janela) await janela.navigate(destino);
        return;
      }
    }
    await self.clients.openWindow(destino);
  })());
});
