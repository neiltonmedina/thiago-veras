/**
 * Sessão do painel por cookie assinado (HMAC). O cookie guarda só usuário e
 * validade; a assinatura usa um segredo derivado da senha, então trocar a senha
 * encerra todas as sessões abertas.
 */
import { createHmac, createHash, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';

export const SESSION_COOKIE = 'painel_sessao';
export const SESSION_DAYS = 30;

function secret(): Buffer {
  return createHash('sha256').update(`painel|${config.admin?.user ?? ''}|${config.admin?.password ?? ''}`).digest();
}

function sign(payload: string): string {
  return createHmac('sha256', secret()).update(payload).digest('base64url');
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export function checkCredentials(user: string, pass: string): boolean {
  if (!config.admin) return false;
  // compara os dois campos sempre, para não revelar qual deles errou
  const okUser = safeEqual(user, config.admin.user);
  const okPass = safeEqual(pass, config.admin.password);
  return okUser && okPass;
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
