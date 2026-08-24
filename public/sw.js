// Service Worker para MatchGo PWA (Notificaciones Push)
/* eslint-disable no-restricted-globals */

self.addEventListener('push', (event) => {
  console.log('[Service Worker] Notificación Push recibida.');

  let payload = {
    title: 'MatchGo',
    body: 'Tenés una nueva notificación.',
    icon: '/icons/icon.svg',
    badge: '/icons/icon.svg',
    data: {
      url: '/player'
    }
  };

  if (event.data) {
    try {
      const data = event.data.json();
      payload = {
        title: data.title || payload.title,
        body: data.body || payload.body,
        icon: data.icon || payload.icon,
        badge: data.badge || payload.badge,
        data: {
          url: data.url || (data.data && data.data.url) || '/player',
          ...data.data
        }
      };
    } catch (e) {
      // Fallback si la data no es JSON
      payload.body = event.data.text();
    }
  }

  const options = {
    body: payload.body,
    icon: payload.icon,
    badge: payload.badge,
    vibrate: [100, 50, 100],
    data: payload.data,
    actions: [
      {
        action: 'open',
        title: 'Ver ahora'
      }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(payload.title, options)
  );
});

self.addEventListener('notificationclick', (event) => {
  console.log('[Service Worker] Click en la notificación recibido.');
  
  event.notification.close();

  const targetUrl = event.notification.data?.url || '/player';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // Si ya hay una ventana abierta de la app, enfocarla y navegar a la URL objetivo
      for (let i = 0; i < windowClients.length; i++) {
        const client = windowClients[i];
        if ('focus' in client) {
          client.focus();
          if ('navigate' in client) {
            return client.navigate(targetUrl);
          }
        }
      }
      // Si no hay ventana abierta, abrir una nueva
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});
