// Service worker da Lista do Futebol.
// Estratégia: sempre tenta a rede primeiro (assim o site novo aparece logo após cada atualização)
// e só usa o que está guardado quando a pessoa está sem internet.
// Os dados da lista (Firebase) e os scripts externos NÃO passam por aqui.

const VERSAO = 'v2';
const CACHE = `lista-futebol-${VERSAO}`;
const BASICO = [
    '/',
    '/manifest.json',
    '/icons/icon-192.png',
    '/icons/icon-512.png',
    '/icons/apple-touch-icon.png',
    '/icons/badge-96.png'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE)
            .then((cache) => cache.addAll(BASICO))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((nomes) => Promise.all(nomes.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;
    const url = new URL(req.url);
    if (url.origin !== self.location.origin) return; // Firebase, gstatic etc. seguem direto para a rede

    event.respondWith(
        fetch(req)
            .then((resp) => {
                if (resp.ok) {
                    const copia = resp.clone();
                    caches.open(CACHE).then((cache) => cache.put(req, copia));
                }
                return resp;
            })
            .catch(() => caches.match(req).then((guardado) => guardado || caches.match('/')))
    );
});

// ---------- Notificações (avisos de vaga) ----------
self.addEventListener('push', (event) => {
    let dados = {};
    try {
        dados = event.data ? event.data.json() : {};
    } catch (e) {
        dados = { corpo: event.data ? event.data.text() : '' };
    }
    event.waitUntil(
        self.registration.showNotification(dados.titulo || 'Lista do Futebol', {
            body: dados.corpo || '',
            icon: '/icons/icon-192.png',
            badge: '/icons/badge-96.png',
            data: { url: dados.url || '/' }
        })
    );
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const alvo = (event.notification.data && event.notification.data.url) || '/';
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((janelas) => {
            for (const janela of janelas) {
                if ('focus' in janela) return janela.focus();
            }
            return clients.openWindow(alvo);
        })
    );
});
