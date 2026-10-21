import express, { Router, type Request, type Response, type NextFunction } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';
import { getCatalog } from '../houses/catalog.js';
import { toIsoDate, fromIsoDate } from '../dates/parser.js';
import * as store from '../reservations/store.js';
import type { Reservation } from '../reservations/store.js';
import { confirmManually, cancelReservation, blockDates, type ActionResult } from '../reservations/lifecycle.js';
import { renderPage, type AdminView } from './page.js';

export const adminRouter = Router();

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!config.admin) {
    res.status(404).send('Painel desligado. Defina ADMIN_PASSWORD no .env.');
    return;
  }
  const header = req.headers.authorization ?? '';
  const [scheme, encoded] = header.split(' ');
  if (scheme === 'Basic' && encoded) {
    const decoded = Buffer.from(encoded, 'base64').toString('utf-8');
    const sep = decoded.indexOf(':');
    const user = decoded.slice(0, sep);
    const pass = decoded.slice(sep + 1);
    if (sep > 0 && safeEqual(user, config.admin.user) && safeEqual(pass, config.admin.password)) {
      next();
      return;
    }
  }
  res.set('WWW-Authenticate', 'Basic realm="Painel de reservas", charset="UTF-8"');
  res.status(401).send('Login necessário.');
}

// O navegador reenvia o login Basic sozinho, então um site malicioso poderia
// disparar um POST pro painel. Só aceitamos POST vindo da própria página.
function sameOrigin(req: Request, res: Response, next: NextFunction): void {
  const source = req.headers.origin ?? req.headers.referer;
  try {
    if (source && new URL(source).host === req.headers.host) {
      next();
      return;
    }
  } catch {
    // URL malformada cai no 403 abaixo
  }
  res.status(403).send('Requisição bloqueada.');
}

adminRouter.use(requireAuth);
adminRouter.use(express.urlencoded({ extended: false, limit: '10kb' }));
adminRouter.post('*', sameOrigin);

adminRouter.get('/', async (req, res) => {
  const catalog = await getCatalog();
  const houseNames = new Map(catalog.map(h => [h.code, h.name]));
  const todayIso = toIsoDate(new Date());
  const reservations = store.listForAdmin(todayIso);

  const clientCache = new Map<number, store.Client | null>();
  const clientOf = (r: Reservation) => {
    if (r.clientId == null) return null;
    if (!clientCache.has(r.clientId)) clientCache.set(r.clientId, store.getClientById(r.clientId));
    return clientCache.get(r.clientId) ?? null;
  };

  const view: AdminView = {
    flash: typeof req.query.msg === 'string'
      ? { ok: req.query.ok === '1', text: req.query.msg.slice(0, 300) }
      : null,
    houses: catalog.map(h => ({ code: h.code, name: h.name })),
    todayIso,
    pixMode: config.pix?.mode ?? null,
    depositPercent: config.depositPercent,
    items: reservations.map(r => {
      const client = clientOf(r);
      return {
        r,
        houseName: houseNames.get(r.houseCode) ?? r.houseCode,
        clientName: client?.name ?? null,
        checkIn: fromIsoDate(r.checkIn),
        checkOut: fromIsoDate(r.checkOut),
      };
    }),
  };
  res.set('Cache-Control', 'no-store');
  res.type('html').send(renderPage(view));
});

function redirectWith(res: Response, result: ActionResult): void {
  const qs = new URLSearchParams({ ok: result.ok ? '1' : '0', msg: result.message });
  res.redirect(303, `/admin?${qs}`);
}

adminRouter.post('/reservations/:id/confirm', async (req, res) => {
  redirectWith(res, await confirmManually(Number(req.params.id)));
});

adminRouter.post('/reservations/:id/cancel', async (req, res) => {
  redirectWith(res, await cancelReservation(Number(req.params.id)));
});

adminRouter.post('/blocks', async (req, res) => {
  const body = req.body as Record<string, string | undefined>;
  redirectWith(res, await blockDates({
    houseCode: body.house ?? '',
    checkInIso: body.checkIn ?? '',
    checkOutIso: body.checkOut ?? '',
    note: body.note ?? '',
  }));
});
