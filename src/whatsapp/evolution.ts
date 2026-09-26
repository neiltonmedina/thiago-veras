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

export async function sendText(to: string, text: string): Promise<void> {
  const number = normalizeNumber(to);
  try {
    await client.post(`/message/sendText/${config.evolution.instance}`, {
      number,
      text,
    });
  } catch (err) {
    logAxiosError('sendText', err);
    throw err;
  }
}

export async function sendImage(to: string, imageUrl: string, caption?: string): Promise<void> {
  const number = normalizeNumber(to);
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

export async function sendVideo(to: string, videoUrl: string, caption?: string): Promise<void> {
  const number = normalizeNumber(to);
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
