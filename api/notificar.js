// Função da Vercel: avisa quem subiu da lista de espera para a lista principal.
//
// O site chama esta função depois que alguém entra ou sai da lista. A função NÃO confia em nada
// que o celular informa: ela lê a lista no Firebase, compara com o "retrato" da última verificação
// e avisa só quem estava na espera e agora está entre os 20. Cada pessoa recebe no máximo um aviso
// por registro, então chamadas repetidas (ou falsas) não geram avisos duplicados.

const admin = require('firebase-admin');
const webpush = require('web-push');

const MAX_VAGAS = 20;
const DATABASE_URL = 'https://lista-da-pelada-default-rtdb.firebaseio.com';

// Só enviamos para servidores de push conhecidos (Chrome/Android, Firefox, Safari/iPhone, Edge).
const HOST_PERMITIDO = /^(fcm\.googleapis\.com|([a-z0-9-]+\.)*push\.services\.mozilla\.com|([a-z0-9-]+\.)*push\.apple\.com|([a-z0-9-]+\.)*notify\.windows\.com)$/;

function inscricaoValida(sub) {
    try {
        if (!sub || typeof sub.endpoint !== 'string' || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) return false;
        const url = new URL(sub.endpoint);
        return url.protocol === 'https:' && HOST_PERMITIDO.test(url.hostname);
    } catch (e) {
        return false;
    }
}

function iniciar(req) {
    if (!admin.apps.length) {
        admin.initializeApp({
            credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
            databaseURL: DATABASE_URL
        });
    }
    webpush.setVapidDetails(
        process.env.VAPID_SUBJECT || `https://${req.headers.host}`,
        process.env.VAPID_PUBLIC_KEY,
        process.env.VAPID_PRIVATE_KEY
    );
}

module.exports = async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');

    if (req.method !== 'POST') {
        return res.status(405).json({ erro: 'Método não permitido.' });
    }

    try {
        iniciar(req);

        // Só aceita quem está logado no app (anônimo ou admin)
        const cabecalho = req.headers.authorization || '';
        const token = cabecalho.startsWith('Bearer ') ? cabecalho.slice(7) : null;
        if (!token) return res.status(401).json({ erro: 'Sem autorização.' });
        await admin.auth().verifyIdToken(token);

        const db = admin.database();

        // 1) Situação atual: quem está na lista principal e quem está na espera
        const snapJogadores = await db.ref('pelada/jogadores').once('value');
        const confirmados = Object.entries(snapJogadores.val() || {})
            .map(([id, j]) => ({ id, ...j }))
            .filter((j) => j.status === 'confirmado')
            .sort((a, b) => (a.criadoEm || 0) - (b.criadoEm || 0) || a.id.localeCompare(b.id));

        const principal = confirmados.slice(0, MAX_VAGAS);
        const espera = confirmados.slice(MAX_VAGAS);

        // 2) Compara com o retrato anterior e já guarda o novo
        const refRetrato = db.ref('notificacoes/retrato');
        const anterior = (await refRetrato.once('value')).val();

        const mapa = (lista) => Object.fromEntries(lista.map((j) => [j.id, j.criadoEm || 0]));
        await refRetrato.set({ principal: mapa(principal), espera: mapa(espera), em: Date.now() });

        if (!anterior) {
            return res.status(200).json({ ok: true, avisados: 0, nota: 'Primeira verificação.' });
        }

        // Subiu = está na principal agora E estava na espera antes (mesmo registro, mesmo horário de entrada)
        const esperaAntes = anterior.espera || {};
        const subiram = principal.filter((j) => esperaAntes[j.id] !== undefined && esperaAntes[j.id] === (j.criadoEm || 0));

        // 3) Envia (uma vez só por pessoa/registro)
        let avisados = 0;
        for (const j of subiram) {
            const claim = await db.ref(`notificacoes/avisados/${j.id}_${j.criadoEm}`)
                .transaction((atual) => (atual ? undefined : Date.now()));
            if (!claim.committed) continue; // outro processo já avisou

            const sub = (await db.ref(`inscricoes/${j.dono}`).once('value')).val();
            if (!inscricaoValida(sub)) continue;

            try {
                await webpush.sendNotification(
                    sub,
                    JSON.stringify({
                        titulo: '⚽ Abriu uma vaga!',
                        corpo: `${j.nome}, você subiu da lista de espera e agora está entre os ${MAX_VAGAS}.`,
                        url: '/'
                    }),
                    { TTL: 3600, urgency: 'high' }
                );
                avisados++;
            } catch (err) {
                // 404/410 = o celular cancelou ou o aviso expirou: limpa a inscrição
                if (err && (err.statusCode === 404 || err.statusCode === 410)) {
                    await db.ref(`inscricoes/${j.dono}`).remove();
                }
            }
        }

        return res.status(200).json({ ok: true, avisados });
    } catch (err) {
        console.error('Erro em /api/notificar:', err && err.message);
        const naoAutorizado = err && typeof err.code === 'string' && err.code.startsWith('auth/');
        return res.status(naoAutorizado ? 401 : 500).json({ erro: naoAutorizado ? 'Sem autorização.' : 'Erro interno.' });
    }
};
