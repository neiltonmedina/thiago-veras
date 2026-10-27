/**
 * API pública do site: calendário de datas ocupadas e pré-reserva.
 *
 * O site (GitHub Pages) chama estes endereços do navegador do cliente. Não há
 * login: por isso a API só devolve datas (nunca dados de clientes), valida tudo,
 * limita pedidos por IP e deixa o conflito de datas por conta do banco, que é
 * quem garante que dois pedidos simultâneos não levem o mesmo período.
 */
import express, { Router, type Request, type Response, type NextFunction } from 'express';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { getCatalog } from '../houses/catalog.js';
import { toIsoDate } from '../dates/parser.js';
import * as store from '../reservations/store.js';
import { PENDING_TTL_MS } from '../reservations/service.js';

export const siteApi = Router();

const MAX_NIGHTS = 60;
const MAX_HOLDS_PER_PHONE = 1;
const LIMITS = { holdsPerIpPerHour: 6, requestsPerIpPerMinute: 60 };

// ---------- CORS: só os sites autorizados ----------
siteApi.use((req: Request, res: Response, next: NextFunction) => {
  const origin = req.headers.origin;
  const allowed = !!origin && (config.webOrigins.includes(origin) || (config.simulate && /^http:\/\/localhost(:\d+)?$/.test(origin)));
  if (allowed) {
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Vary', 'Origin');
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    res.set('Access-Control-Max-Age', '600');
  }
  if (req.method === 'OPTIONS') {
    res.status(allowed ? 204 : 403).end();
    return;
  }
  // Pedido com Origin de fora da lista: o navegador já bloquearia a leitura,
  // mas também não deixamos criar reserva por ele.
  if (req.method === 'POST' && origin && !allowed) {
    res.status(403).json({ erro: 'origem_nao_autorizada' });
    return;
  }
  next();
});

// ---------- Limite simples por IP (em memória) ----------
const hits = new Map<string, number[]>();
function tooMany(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const list = (hits.get(key) ?? []).filter(t => now - t < windowMs);
  if (list.length >= max) {
    hits.set(key, list);
    return true;
  }
  list.push(now);
  hits.set(key, list);
  return false;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, list] of hits) {
    const fresh = list.filter(t => now - t < 60 * 60 * 1000);
    if (fresh.length) hits.set(k, fresh); else hits.delete(k);
  }
}, 10 * 60 * 1000).unref();

siteApi.use((req, res, next) => {
  if (tooMany(`req:${req.ip}`, LIMITS.requestsPerIpPerMinute, 60_000)) {
    res.status(429).json({ erro: 'muitos_pedidos' });
    return;
  }
  next();
});

// ---------- Datas ocupadas ----------
siteApi.get('/disponibilidade', async (req, res) => {
  const catalog = await getCatalog();
  const only = typeof req.query.casa === 'string' ? req.query.casa : undefined;
  if (only && !catalog.some(h => h.code === only)) {
    res.status(404).json({ erro: 'casa_inexistente' });
    return;
  }
  const casas: Record<string, [string, string][]> = {};
  for (const h of catalog) if (!only || h.code === only) casas[h.code] = [];
  for (const o of store.listOccupied(toIsoDate(new Date()), only)) {
    (casas[o.houseCode] ??= []).push([o.checkIn, o.checkOut]);
  }
  res.set('Cache-Control', 'no-store');
  res.json({ casas, holdMinutos: config.holdMinutes });
});

// ---------- Pré-reserva ----------
const ISO = /^\d{4}-\d{2}-\d{2}$/;

function parseIso(v: unknown): Date | null {
  if (typeof v !== 'string' || !ISO.test(v)) return null;
  const [y = 0, m = 0, d = 0] = v.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d ? date : null;
}

function cleanName(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);
  return t || null;
}

function cleanPhone(v: unknown): string {
  if (typeof v !== 'string') return '';
  const digits = v.replace(/\D/g, '');
  const withCountry = digits.length === 10 || digits.length === 11 ? `55${digits}` : digits;
  return /^55\d{10,11}$/.test(withCountry) ? withCountry : '';
}

siteApi.post('/reservar', express.json({ limit: '4kb' }), async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const catalog = await getCatalog();
  const house = catalog.find(h => h.code === body.casa);
  if (!house) { res.status(400).json({ erro: 'casa_invalida' }); return; }

  const checkIn = parseIso(body.entrada);
  const checkOut = parseIso(body.saida);
  if (!checkIn || !checkOut) { res.status(400).json({ erro: 'datas_invalidas' }); return; }

  const todayIso = toIsoDate(new Date());
  const nights = Math.round((checkOut.getTime() - checkIn.getTime()) / 86_400_000);
  if (toIsoDate(checkIn) < todayIso) { res.status(400).json({ erro: 'entrada_no_passado' }); return; }
  if (nights <= 0 || nights > MAX_NIGHTS) { res.status(400).json({ erro: 'periodo_invalido' }); return; }

  const guestsRaw = Number(body.pessoas);
  const guests = Number.isInteger(guestsRaw) && guestsRaw >= 1 && guestsRaw <= 40 ? guestsRaw : null;
  const name = cleanName(body.nome);
  const phone = cleanPhone(body.whatsapp);

  if (tooMany(`hold:${req.ip}`, LIMITS.holdsPerIpPerHour, 60 * 60_000)) {
    res.status(429).json({ erro: 'muitos_pedidos' });
    return;
  }
  if (phone && store.countActiveSiteHolds(phone) >= MAX_HOLDS_PER_PHONE) {
    res.status(429).json({ erro: 'ja_tem_reserva_em_aberto' });
    return;
  }

  // Verifica e grava na mesma transação: o SQLite é síncrono e só uma escrita
  // roda por vez, então dois pedidos para o mesmo período nunca passam juntos.
  const reserve = db.transaction(() => {
    if (store.hasOverlap(house.code, toIsoDate(checkIn), toIsoDate(checkOut))) return null;
    return store.createPending({
      houseCode: house.code,
      checkIn: toIsoDate(checkIn),
      checkOut: toIsoDate(checkOut),
      nights,
      totalCents: 0,
      clientPhone: phone,
      ttlMs: PENDING_TTL_MS,
      source: 'site',
      guestName: name,
      guests,
    });
  });
  const r = reserve();
  if (!r) { res.status(409).json({ erro: 'ocupado' }); return; }

  console.log(`[site] reserva #${r.id} ${house.code} ${r.checkIn}→${r.checkOut} (${name ?? 'sem nome'}, ${guests ?? '?'} pessoas)`);
  res.status(201).json({
    ok: true,
    id: r.id,
    ate: new Date(r.expiresAt ?? Date.now()).toISOString(),
    holdMinutos: config.holdMinutes,
  });
});

// Qualquer outra rota de /api
siteApi.use((_req, res) => { res.status(404).json({ erro: 'nao_encontrado' }); });
