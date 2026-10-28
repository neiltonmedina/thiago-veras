/**
 * Sessão do painel por cookie assinado (HMAC). O cookie guarda só usuário e
 * validade; a assinatura usa um segredo derivado da senha e da "época", então trocar
 * a senha ou pedir "sair de todos os aparelhos" encerra todas as sessões abertas.
 */
import { createHmac } from 'node:crypto';
import { config } from '../config.js';
import { sessionSecret, safeEqual, checkCredentials } from './credentials.js';

export const SESSION_COOKIE = 'painel_sessao';
export const SESSION_DAYS = 30;

export { safeEqual, checkCredentials };

function sign(payload: string): string {
  return createHmac('sha256', sessionSecret()).update(payload).digest('base64url');
}

export function createSessionToken(now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ u: config.admin?.user, exp: now + SESSION_DAYS * 86_400_000 })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

export function verifySessionToken(token: string | undefined, now = Date.now()): boolean {
  if (!token || !config.admin) return false;
  const [payload, sig] = token.split('.');
  if (!payload || !sig || !safeEqual(sig, sign(payload))) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8')) as { u?: string; exp?: number };
    return data.u === config.admin.user && typeof data.exp === 'number' && data.exp > now;
  } catch {
    return false;
  }
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}
