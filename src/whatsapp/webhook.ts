import type { Request, Response } from 'express';
import { handleMessage } from '../conversation/handler.js';
import type { IncomingMessage } from '../types.js';

/**
 * Recebe eventos da Evolution API. Formato esperado (v2):
 *
 *   { event: 'messages.upsert', data: { key: {...}, message: {...}, messageTimestamp: 1735600000 } }
 *
 * Respondemos 200 imediatamente pra evitar retry, e processamos em background.
 */
export function handleWebhook(req: Request, res: Response): void {
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
