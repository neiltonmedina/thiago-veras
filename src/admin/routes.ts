/**
 * Painel do Thiago: tela de login, aplicativo (HTML/CSS/JS em ./ui) e a API JSON
 * que ele usa. Tudo sob /admin.
 *
 *  - Login por formulário com cookie assinado (30 dias); a autenticação Basic
 *    continua aceita para ferramentas como curl.
 *  - Os arquivos de ./ui (CSS, JS, ícones, manifest) são públicos: não têm dado
 *    nenhum. Só o HTML do app e a API exigem login.
 *  - Ações (POST) só passam vindas da própria página: exigem o cabeçalho
 *    X-Painel (um site de fora não consegue enviá-lo sem pré-verificação CORS,
 *    que aqui nunca é liberada) e conferem a origem.
 */
import express, { Router, type Request, type Response, type NextFunction } from 'express';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { config } from '../config.js';
import { getCatalog } from '../houses/catalog.js';
import { toIsoDate } from '../dates/parser.js';
import * as store from '../reservations/store.js';
import type { Reservation } from '../reservations/store.js';
import { confirmManually, cancelReservation, blockDates, type ActionResult } from '../reservations/lifecycle.js';
import {
  SESSION_COOKIE, SESSION_DAYS, checkCredentials, createSessionToken, verifySessionToken, readCookie,
} from './session.js';

export const adminRouter = Router();

const __dirname = dirname(fileURLToPath(import.meta.url));
const UI_DIR = join(__dirname, 'ui');
const VERSION = Date.now().toString(36); // muda a cada reinício: força o navegador a baixar o app novo

function page(name: string): string {
  return readFileSync(join(UI_DIR, name), 'utf-8').replaceAll('__V__', VERSION);
}
const LOGIN_HTML = page('login.html');
const APP_HTML = page('app.html');

// ---------- autenticação ----------
function basicOk(req: Request): boolean {
  const [scheme, encoded] = (req.headers.authorization ?? '').split(' ');
  if (scheme !== 'Basic' || !encoded) return false;
  const decoded = Buffer.from(encoded, 'base64').toString('utf-8');
  const sep = decoded.indexOf(':');
  return sep > 0 && checkCredentials(decoded.slice(0, sep), decoded.slice(sep + 1));
}

function isAuthed(req: Request): boolean {
  return verifySessionToken(readCookie(req.headers.cookie, SESSION_COOKIE)) || basicOk(req);
}

function requireLogin(req: Request, res: Response, next: NextFunction): void {
  if (isAuthed(req)) { next(); return; }
  if (req.path.startsWith('/api/')) {
    res.status(401).json({ ok: false, message: 'Sessão expirada. Entre de novo.' });
    return;
  }
  res.redirect(302, '/admin/login');
}

function sameOrigin(req: Request, res: Response, next: NextFunction): void {
  const source = req.headers.origin ?? req.headers.referer;
  try {
    if (source && new URL(source).host === req.headers.host && req.headers['x-painel'] === '1') { next(); return; }
  } catch {
    // URL malformada cai no 403 abaixo
  }
  res.status(403).json({ ok: false, message: 'Requisição bloqueada.' });
}

// ---------- limite de tentativas de login ----------
const falhas = new Map<string, number[]>();
function bloqueado(ip: string): boolean {
  const agora = Date.now();
  const lista = (falhas.get(ip) ?? []).filter(t => agora - t < 15 * 60_000);
  falhas.set(ip, lista);
  return lista.length >= 8;
}

// ---------- arquivos públicos do app ----------
adminRouter.use('/ui', express.static(UI_DIR, { maxAge: '1h', index: false }));

adminRouter.get('/manifest.webmanifest', (_req, res) => {
  res.type('application/manifest+json').json({
    name: 'Painel Thiago Veras',
    short_name: 'Painel',
    start_url: '/admin/',
    scope: '/admin/',
    display: 'standalone',
    background_color: '#2b2b2b',
    theme_color: '#2b2b2b',
    icons: [
      { src: `/admin/ui/icon-192.png?v=${VERSION}`, sizes: '192x192', type: 'image/png' },
      { src: `/admin/ui/icon-512.png?v=${VERSION}`, sizes: '512x512', type: 'image/png' },
    ],
  });
});

// ---------- login ----------
adminRouter.get('/login', (req, res) => {
  if (!config.admin) { res.status(404).send('Painel desligado. Defina ADMIN_PASSWORD no .env.'); return; }
  if (isAuthed(req)) { res.redirect(302, '/admin/'); return; }
  res.set('Cache-Control', 'no-store').type('html').send(LOGIN_HTML);
});

adminRouter.post('/login', express.json({ limit: '2kb' }), (req, res) => {
  if (!config.admin) { res.status(404).json({ ok: false, message: 'Painel desligado.' }); return; }
  const source = req.headers.origin ?? req.headers.referer;
  try {
    if (!source || new URL(source).host !== req.headers.host || req.headers['x-painel'] !== '1') throw new Error('origem');
  } catch {
    res.status(403).json({ ok: false, message: 'Requisição bloqueada.' });
    return;
  }
  if (bloqueado(req.ip ?? '')) {
    res.status(429).json({ ok: false, message: 'Muitas tentativas. Espere alguns minutos e tente de novo.' });
    return;
  }
  const { usuario, senha } = (req.body ?? {}) as { usuario?: unknown; senha?: unknown };
  if (typeof usuario !== 'string' || typeof senha !== 'string' || !checkCredentials(usuario.trim(), senha)) {
    falhas.set(req.ip ?? '', [...(falhas.get(req.ip ?? '') ?? []), Date.now()]);
    res.status(401).json({ ok: false, message: 'Usuário ou senha incorretos.' });
    return;
  }
  falhas.delete(req.ip ?? '');
  const seguro = req.secure ? '; Secure' : '';
  res.set('Set-Cookie', `${SESSION_COOKIE}=${encodeURIComponent(createSessionToken())}; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=${SESSION_DAYS * 86400}${seguro}`);
  res.json({ ok: true });
});

adminRouter.post('/logout', sameOrigin, (_req, res) => {
  res.set('Set-Cookie', `${SESSION_COOKIE}=; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=0`);
  res.json({ ok: true });
});

// ---------- tudo daqui para baixo exige login ----------
adminRouter.use(requireLogin);

adminRouter.get('/', (_req, res) => {
  if (!config.admin) { res.status(404).send('Painel desligado. Defina ADMIN_PASSWORD no .env.'); return; }
  res.set('Cache-Control', 'no-store').type('html').send(APP_HTML);
});

// Estado completo da tela: casas e reservas. O app consulta isto a cada poucos segundos.
adminRouter.get('/api/estado', async (_req, res) => {
  const catalog = await getCatalog();
  const names = new Map(catalog.map(h => [h.code, h.name]));
  const hoje = toIsoDate(new Date());
  const clientes = new Map<number, store.Client | null>();
  const nomeDe = (r: Reservation): string | null => {
    if (r.clientId == null) return r.guestName;
    if (!clientes.has(r.clientId)) clientes.set(r.clientId, store.getClientById(r.clientId));
    return clientes.get(r.clientId)?.name ?? r.guestName;
  };
  res.set('Cache-Control', 'no-store').json({
    agora: Date.now(),
    hoje,
    holdMinutos: config.holdMinutes,
    pixAutomatico: !!config.pix,
    casas: catalog.map(h => ({ codigo: h.code, nome: h.name })),
    reservas: store.listForAdmin(hoje).map(r => ({
      id: r.id,
      casa: r.houseCode,
      casaNome: names.get(r.houseCode) ?? r.houseCode,
      entrada: r.checkIn,
      saida: r.checkOut,
      diarias: r.nights,
      status: r.status,
      origem: r.source,
      nome: nomeDe(r),
      pessoas: r.guests,
      whatsapp: r.clientPhone || null,
      total: r.totalCents,
      sinal: r.depositCents,
      pago: !!r.paidAt,
      obs: r.note,
      expiraEm: r.expiresAt,
      criadoEm: r.createdAt,
    })),
  });
});

function responder(res: Response, r: ActionResult, extra: Record<string, unknown> = {}): void {
  res.status(r.ok ? 200 : 409).json({ ok: r.ok, message: r.message, ...extra });
}

adminRouter.post('/api/reservas/:id/confirmar', sameOrigin, async (req, res) => {
  responder(res, await confirmManually(Number(req.params.id)));
});

adminRouter.post('/api/reservas/:id/cancelar', sameOrigin, async (req, res) => {
  responder(res, await cancelReservation(Number(req.params.id)));
});

adminRouter.post('/api/reservas/:id/mais-tempo', sameOrigin, express.json({ limit: '1kb' }), (req, res) => {
  const id = Number(req.params.id);
  const pedido = Number((req.body as { minutos?: unknown } | undefined)?.minutos);
  const minutos = Number.isFinite(pedido) ? Math.min(Math.max(Math.round(pedido), 5), 24 * 60) : 60;
  const r = store.extendHold(id, minutos);
  if (r.ok) {
    responder(res, { ok: true, message: `Mais ${minutos >= 60 ? `${Math.round(minutos / 60)}h` : `${minutos} min`} para o pedido #${id}.` }, { expiraEm: r.reservation.expiresAt });
    return;
  }
  const msg = r.reason === 'overlap' ? `Não dá: as datas do pedido #${id} já foram ocupadas por outra reserva.`
    : r.reason === 'not_found' ? `Pedido #${id} não encontrado.`
      : `O pedido #${id} não está aguardando pagamento.`;
  responder(res, { ok: false, message: msg });
});

adminRouter.post('/api/bloqueios', sameOrigin, express.json({ limit: '2kb' }), async (req, res) => {
  const b = (req.body ?? {}) as Record<string, unknown>;
  responder(res, await blockDates({
    houseCode: typeof b.casa === 'string' ? b.casa : '',
    checkInIso: typeof b.entrada === 'string' ? b.entrada : '',
    checkOutIso: typeof b.saida === 'string' ? b.saida : '',
    note: typeof b.obs === 'string' ? b.obs : '',
  }));
});

adminRouter.use('/api', (_req, res) => { res.status(404).json({ ok: false, message: 'Não encontrado.' }); });

