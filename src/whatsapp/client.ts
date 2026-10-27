/**
 * Cliente da WhatsApp Cloud API (oficial da Meta).
 * Docs: https://developers.facebook.com/docs/whatsapp/cloud-api
 */
import { config } from '../config.js';

const wa = config.whatsapp;

function normalizeNumber(n: string): string {
  return n.replace(/\D/g, '');
}

/** WhatsApp desligado (sem credenciais da Meta): nada é enviado, só fica no log. */
function skipped(to: string): void {
  console.log(`[whatsapp desligado] mensagem para ${normalizeNumber(to)} não enviada`);
}

function indent(s: string): string {
  return s.split('\n').map(l => '    ' + l).join('\n');
}

class WhatsAppError extends Error {
  constructor(op: string, status: number, public code: number | undefined, detail: string) {
    super(`[whatsapp:${op}] HTTP ${status}${code ? ` código ${code}` : ''}: ${detail}`);
  }
}

async function graph(op: string, path: string, init: RequestInit): Promise<any> {
  const res = await fetch(`${wa.graphBase}/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${wa.token}`, ...init.headers },
    signal: AbortSignal.timeout(30_000),
  });
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new WhatsAppError(op, res.status, body?.error?.code, body?.error?.message ?? res.statusText);
  }
  return body;
}

async function sendMessage(op: string, to: string, payload: Record<string, unknown>): Promise<void> {
  await graph(op, `${wa.phoneNumberId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: normalizeNumber(to), ...payload }),
  });
}

export async function sendText(to: string, text: string): Promise<void> {
  if (!wa.enabled) return skipped(to);
  if (config.simulate) {
    console.log(`\n  📱 BOT → ${normalizeNumber(to)} (texto):\n${indent(text)}\n`);
    return;
  }
  await sendMessage('sendText', to, { type: 'text', text: { body: text, preview_url: false } });
}

/** Imagem por URL pública (HTTPS). A Meta baixa o arquivo do nosso servidor. */
export async function sendImage(to: string, imageUrl: string, caption?: string): Promise<void> {
  if (!wa.enabled) return skipped(to);
  if (config.simulate) {
    console.log(`  🖼️  BOT → ${normalizeNumber(to)} (imagem): ${imageUrl}${caption ? `\n${indent(caption)}` : ''}`);
    return;
  }
  await sendMessage('sendImage', to, { type: 'image', image: { link: imageUrl, ...(caption ? { caption } : {}) } });
}

export async function sendVideo(to: string, videoUrl: string, caption?: string): Promise<void> {
  if (!wa.enabled) return skipped(to);
  if (config.simulate) {
    console.log(`  🎥 BOT → ${normalizeNumber(to)} (vídeo):  ${videoUrl}${caption ? `\n${indent(caption)}` : ''}`);
    return;
  }
  await sendMessage('sendVideo', to, { type: 'video', video: { link: videoUrl, ...(caption ? { caption } : {}) } });
}

/** Imagem gerada em memória (QR Code do Pix): sobe pra Meta e envia pelo id. */
export async function sendImageBase64(to: string, base64: string, caption?: string): Promise<void> {
  if (!wa.enabled) return skipped(to);
  if (config.simulate) {
    console.log(`  🖼️  BOT → ${normalizeNumber(to)} (imagem gerada, ${base64.length} bytes base64)${caption ? `\n${indent(caption)}` : ''}`);
    return;
  }
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', 'image/png');
  form.append('file', new Blob([Buffer.from(base64, 'base64')], { type: 'image/png' }), 'pix.png');
  const { id } = await graph('uploadMedia', `${wa.phoneNumberId}/media`, { method: 'POST', body: form });
  await sendMessage('sendImageBase64', to, { type: 'image', image: { id, ...(caption ? { caption } : {}) } });
}

/**
 * Aviso que pode sair fora da janela de 24h do WhatsApp (pro atendente, ou pro
 * cliente quando o Thiago confirma/cancela pelo painel dias depois). Fora da
 * janela, a Meta só entrega template aprovado; com WHATSAPP_SUPPORT_TEMPLATE
 * configurado, usamos ele, senão tentamos texto livre.
 */
export async function sendNotice(to: string, text: string): Promise<void> {
  if (!wa.enabled) return skipped(to);
  if (config.simulate || !wa.supportTemplate) {
    await sendText(to, text);
    return;
  }
  await sendMessage('sendNotice', to, {
    type: 'template',
    template: {
      name: wa.supportTemplate,
      language: { code: wa.templateLang },
      components: [{ type: 'body', parameters: [{ type: 'text', text: templateParam(text) }] }],
    },
  });
}

/** Parâmetro de template não aceita quebra de linha, tab nem 4+ espaços seguidos. */
export function templateParam(text: string): string {
  return text
    .replace(/[*_]/g, '')
    .replace(/\s*\n+\s*/g, ' · ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 1000);
}
