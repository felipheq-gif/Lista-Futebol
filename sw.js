// Service worker da Lista do Futebol.
// Estratégia: sempre tenta a rede primeiro (assim o site novo aparece logo após cada atualização)
// e só usa o que está guardado quando a pessoa está sem internet.
// Os dados da lista (Firebase) e os scripts externos NÃO passam por aqui.

const VERSAO = 'v1';
const CACHE = `lista-futebol-${VERSAO}`;
const BASICO = [
    '/',
    '/manifest.json',
    '/icons/icon-192.png',
    '/icons/icon-512.png',
    '/icons/apple-touch-icon.png'
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
