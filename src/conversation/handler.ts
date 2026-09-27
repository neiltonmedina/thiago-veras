import type { House, IncomingMessage } from '../types.js';
import { getCatalog } from '../houses/catalog.js';
import { matchHouse } from './matcher.js';
import { classify } from '../ai/gemini.js';
import { getState, setState, resetState } from './state.js';
import * as msg from './messages.js';
import { sendText, sendImage, sendVideo } from '../whatsapp/evolution.js';
import { config } from '../config.js';

export async function handleMessage(m: IncomingMessage): Promise<void> {
  console.log(`[in] ${m.from}: ${m.text}`);

  const catalog = await getCatalog();
  const state = getState(m.from);
  const t = m.text.trim();

  // "sair" tira do modo humano e volta pro fluxo
  if (/^(voltar|menu|recomecar|reiniciar)$/i.test(t)) {
    resetState(m.from);
    await sendText(m.from, msg.greeting(catalog));
    setState(m.from, { step: 'awaiting_house_choice' });
    return;
  }

  // Já foi passado pra humano: bot silencia, deixa o atendente conduzir
  if (state.step === 'handoff_human') {
    return;
  }

  // Palavras diretas de pedir atendente (checa em qualquer posição da mensagem)
  if (/\b(atendente|humano|falar com (uma )?pessoa|falar com alguem|falar com alguém|falar com o dono|ajuda|preciso de ajuda)\b/i.test(t)) {
    await sendText(m.from, msg.HANDOFF);
    await notifySupport(m.from, t);
    setState(m.from, { step: 'handoff_human' });
    return;
  }

  // 1. Tentativa direta: bater no catálogo (código, nome, keyword)
  const direct = matchHouse(t, catalog);
  if (direct) {
    await presentHouse(m.from, direct);
    setState(m.from, { step: 'showing_house', houseCode: direct.code });
    return;
  }

  // 2. Classificar via Gemini
  const intent = await classify(t);
  console.log(`[intent] ${m.from}:`, intent);

  switch (intent.type) {
    case 'greeting':
    case 'list_houses':
      await sendText(m.from, msg.greeting(catalog));
      setState(m.from, { step: 'awaiting_house_choice' });
      break;

    case 'select_house': {
      const h = matchHouse(intent.query ?? t, catalog);
      if (h) {
        await presentHouse(m.from, h);
        setState(m.from, { step: 'showing_house', houseCode: h.code });
      } else {
        await sendText(m.from, msg.NOT_FOUND);
      }
      break;
    }

    case 'want_reserve':
      await sendText(m.from, msg.RESERVE_SOON);
      await notifySupport(m.from, t);
      setState(m.from, { step: 'handoff_human' });
      break;

    case 'want_human':
      await sendText(m.from, msg.HANDOFF);
      await notifySupport(m.from, t);
      setState(m.from, { step: 'handoff_human' });
      break;

    default:
      await sendText(m.from, msg.greeting(catalog));
      setState(m.from, { step: 'awaiting_house_choice' });
  }
}

async function presentHouse(to: string, h: House): Promise<void> {
  const photos = h.photos.slice(0, 3);
  for (const p of photos) {
    await sendImage(to, absoluteMediaUrl(p));
  }
  if (h.video) {
    await sendVideo(to, absoluteMediaUrl(h.video));
  }
  await sendText(to, msg.houseCaption(h));
}

function absoluteMediaUrl(pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  return `${config.mediaBaseUrl}/${pathOrUrl.replace(/^\/+/, '')}`;
}

async function notifySupport(from: string, originalText: string): Promise<void> {
  if (from === config.supportPhone) return; // não notifica a si mesmo
  try {
    await sendText(
      config.supportPhone,
      `📩 *Novo atendimento humano solicitado*\n\n` +
      `De: ${from}\n` +
      `Mensagem: "${originalText}"`
    );
  } catch (err) {
    console.error('[notifySupport] falhou:', err);
  }
}
