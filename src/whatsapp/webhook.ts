import type { Request, Response } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { handleMessage } from '../conversation/handler.js';
import { config } from '../config.js';
import type { IncomingMessage } from '../types.js';

function tokenMatches(received: unknown): boolean {
  if (!config.webhookToken) return true;
  if (typeof received !== 'string') return false;
  const a = Buffer.from(received);
  const b = Buffer.from(config.webhookToken);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Recebe eventos da Evolution API. Formato esperado (v2):
 *
 *   { event: 'messages.upsert', data: { key: {...}, message: {...}, messageTimestamp: 1735600000 } }
 *
 * Respondemos 200 imediatamente pra evitar retry, e processamos em background.
 */
export function handleWebhook(req: Request, res: Response): void {
  if (!tokenMatches(req.query.token)) {
    res.status(401).send();
    return;
  }
  res.status(200).send();

  const body = req.body ?? {};
  const event = body.event ?? body.type;
  if (event !== 'messages.upsert') return;

  const data = body.data ?? body;
  if (!data || data.key?.fromMe) return;

  const remoteJid = String(data.key?.remoteJid ?? '');
  if (!remoteJid || remoteJid.endsWith('@g.us')) return;   // ignora grupos

  const from = remoteJid.replace(/@.*$/, '');
  const text = extractText(data.message);
  if (!from || !text) return;

  const msg: IncomingMessage = {
    from,
    text: text.trim(),
    timestamp: new Date((Number(data.messageTimestamp) || Date.now() / 1000) * 1000),
  };

  handleMessage(msg).catch(err => {
    console.error('[webhook] handleMessage falhou:', err);
  });
}

function extractText(message: unknown): string {
  if (!message || typeof message !== 'object') return '';
  const m = message as Record<string, any>;
  return m.conversation
      || m.extendedTextMessage?.text
      || m.ephemeralMessage?.message?.conversation
      || m.ephemeralMessage?.message?.extendedTextMessage?.text
      || '';
}
