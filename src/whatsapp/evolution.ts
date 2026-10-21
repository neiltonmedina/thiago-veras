import axios, { AxiosInstance } from 'axios';
import { config } from '../config.js';

const client: AxiosInstance = axios.create({
  baseURL: config.evolution.baseUrl,
  headers: {
    apikey: config.evolution.apiKey,
    'Content-Type': 'application/json',
  },
  timeout: 30_000,
});

function normalizeNumber(n: string): string {
  return n.replace(/\D/g, '');
}

function indent(s: string): string {
  return s.split('\n').map(l => '    ' + l).join('\n');
}

export async function sendText(to: string, text: string): Promise<void> {
  const number = normalizeNumber(to);
  if (config.simulate) {
    console.log(`\n  📱 BOT → ${number} (texto):\n${indent(text)}\n`);
    return;
  }
  try {
    await client.post(`/message/sendText/${config.evolution.instance}`, { number, text });
  } catch (err) {
    logAxiosError('sendText', err);
    throw err;
  }
}

export async function sendImage(to: string, imageUrl: string, caption?: string): Promise<void> {
  const number = normalizeNumber(to);
  if (config.simulate) {
    console.log(`  🖼️  BOT → ${number} (imagem): ${imageUrl}${caption ? `\n${indent(caption)}` : ''}`);
    return;
  }
  try {
    await client.post(`/message/sendMedia/${config.evolution.instance}`, {
      number,
      mediatype: 'image',
      media: imageUrl,
      ...(caption ? { caption } : {}),
    });
  } catch (err) {
    logAxiosError('sendImage', err);
    throw err;
  }
}

/** Envia imagem gerada em memória (ex.: QR Code do Pix), em base64 sem prefixo data:. */
export async function sendImageBase64(to: string, base64: string, caption?: string): Promise<void> {
  const number = normalizeNumber(to);
  if (config.simulate) {
    console.log(`  🖼️  BOT → ${number} (imagem gerada, ${base64.length} bytes base64)${caption ? `\n${indent(caption)}` : ''}`);
    return;
  }
  try {
    await client.post(`/message/sendMedia/${config.evolution.instance}`, {
      number,
      mediatype: 'image',
      mimetype: 'image/png',
      fileName: 'pix.png',
      media: base64,
      ...(caption ? { caption } : {}),
    });
  } catch (err) {
    logAxiosError('sendImageBase64', err);
    throw err;
  }
}

export async function sendVideo(to: string, videoUrl: string, caption?: string): Promise<void> {
  const number = normalizeNumber(to);
  if (config.simulate) {
    console.log(`  🎥 BOT → ${number} (vídeo):  ${videoUrl}${caption ? `\n${indent(caption)}` : ''}`);
    return;
  }
  try {
    await client.post(`/message/sendMedia/${config.evolution.instance}`, {
      number,
      mediatype: 'video',
      media: videoUrl,
      ...(caption ? { caption } : {}),
    });
  } catch (err) {
    logAxiosError('sendVideo', err);
    throw err;
  }
}

function logAxiosError(op: string, err: unknown): void {
  if (axios.isAxiosError(err)) {
    console.error(`[evolution:${op}] ${err.response?.status} ${err.response?.statusText}`,
      err.response?.data ?? err.message);
  } else {
    console.error(`[evolution:${op}]`, err);
  }
}
