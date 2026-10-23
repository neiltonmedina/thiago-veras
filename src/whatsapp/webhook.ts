import type { Request, Response } from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { handleMessage } from '../conversation/handler.js';
import { config } from '../config.js';
import type { IncomingMessage } from '../types.js';

/**
 * GET: verificação que a Meta faz ao cadastrar o webhook no painel.
 * Responde o hub.challenge se o verify token bater.
 */
export function verifyWebhook(req: Request, res: Response): void {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && typeof token === 'string' && safeEqual(token, config.whatsapp.verifyToken)
      && typeof challenge === 'string') {
    res.status(200).type('text/plain').send(challenge);
    return;
  }
  res.status(403).send();
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** A Meta assina cada POST com HMAC-SHA256 do corpo cru usando o App Secret. */
function signatureValid(raw: Buffer, header: string | undefined): boolean {
  if (!header?.startsWith('sha256=')) return false;
  const expected = 'sha256=' + createHmac('sha256', config.whatsapp.appSecret).update(raw).digest('hex');
  return safeEqual(header, expected);
}

// A Meta pode reenviar o mesmo evento; guardamos os ids recentes pra não responder duas vezes.
const seen = new Set<string>();
function firstTime(id: string): boolean {
  if (seen.has(id)) return false;
  seen.add(id);
  if (seen.size > 5000) seen.delete(seen.values().next().value!);
  return true;
}

/** POST: mensagens recebidas e status de entrega. Corpo chega cru (express.raw). */
export function handleWebhook(req: Request, res: Response): void {
  const raw = req.body as Buffer;
  if (!Buffer.isBuffer(raw) || !signatureValid(raw, req.header('x-hub-signature-256'))) {
    res.status(401).send();
    return;
  }
  res.status(200).send(); // responde logo; a Meta reenvia se demorar

  let body: any;
  try {
    body = JSON.parse(raw.toString('utf-8'));
  } catch {
    return;
  }

  for (const entry of body?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      const value = change?.value;
      for (const status of value?.statuses ?? []) {
        if (status?.status === 'failed') {
          const err = status?.errors?.[0];
          console.error(`[whatsapp] entrega falhou pra ${status.recipient_id}: ${err?.code} ${err?.title ?? ''}`);
        }
      }
      for (const m of value?.messages ?? []) {
        if (!m?.id || !firstTime(m.id)) continue;
        const text = extractText(m);
        if (!m.from || !text) continue;
        const msg: IncomingMessage = {
          from: String(m.from),
          text: text.trim(),
          timestamp: new Date((Number(m.timestamp) || Date.now() / 1000) * 1000),
        };
        handleMessage(msg).catch(err => console.error('[webhook] handleMessage falhou:', err));
      }
    }
  }
}

function extractText(m: any): string {
  if (m.type === 'text') return m.text?.body ?? '';
  // Botões e listas interativas, se usarmos no futuro
  if (m.type === 'interactive') return m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? '';
  if (m.type === 'button') return m.button?.text ?? '';
  return '';
}
