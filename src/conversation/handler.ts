import type { House, IncomingMessage, ConversationState } from '../types.js';
import { getCatalog } from '../houses/catalog.js';
import { matchHouse } from './matcher.js';
import { classify } from '../ai/gemini.js';
import { getState, setState, resetState } from './state.js';
import * as msg from './messages.js';
import { sendText, sendImage, sendVideo } from '../whatsapp/evolution.js';
import { config } from '../config.js';
import { parseDateRange, fromIsoDate } from '../dates/parser.js';
import { parseClientData } from '../reservations/clientData.js';
import { checkAvailability, createPendingReservation, attachClientData } from '../reservations/service.js';

export async function handleMessage(m: IncomingMessage): Promise<void> {
  console.log(`[in] ${m.from}: ${m.text}`);

  const catalog = await getCatalog();
  const state = getState(m.from);
  const t = m.text.trim();

  if (/^(voltar|menu|recomecar|reiniciar|cancelar)$/i.test(t)) {
    resetState(m.from);
    await sendText(m.from, msg.greeting(catalog));
    setState(m.from, { step: 'awaiting_house_choice' });
    return;
  }

  if (state.step === 'handoff_human') return;

  if (/\b(atendente|humano|falar com (uma )?pessoa|falar com alguem|falar com alguém|falar com o dono|ajuda|preciso de ajuda)\b/i.test(t)) {
    await sendText(m.from, msg.HANDOFF);
    await notifySupport(m.from, `📩 Pedido de atendimento humano\nMensagem: "${t}"`);
    setState(m.from, { step: 'handoff_human' });
    return;
  }

  // ============ Estados da Fase 2 ============

  if (state.step === 'awaiting_dates') {
    await handleDatesReply(m.from, t, state.houseCode, catalog);
    return;
  }

  if (state.step === 'confirming_reservation') {
    if (/^(sim|s|confirma|confirmo|isso|pode|ok|okay|claro|bora)/i.test(t)) {
      await sendText(m.from, msg.ASK_CLIENT_DATA);
      setState(m.from, {
        step: 'awaiting_client_data',
        houseCode: state.houseCode,
        checkInIso: state.checkInIso,
        checkOutIso: state.checkOutIso,
        totalCents: state.totalCents,
        nights: state.nights,
      });
      return;
    }
    if (/^(nao|não|n|cancela|cancelar|desisto)/i.test(t)) {
      await sendText(m.from,
        `Sem problema! 🙂 Quer tentar *outras datas* ou *outra casa*? ` +
        `Digite o código (C01…C05) ou o nome.`);
      resetState(m.from);
      setState(m.from, { step: 'awaiting_house_choice' });
      return;
    }
    // Se não bateu sim/não, tenta interpretar como novas datas
    await handleDatesReply(m.from, t, state.houseCode, catalog);
    return;
  }

  if (state.step === 'awaiting_client_data') {
    await handleClientDataReply(m.from, t, state, catalog);
    return;
  }

  // ============ Fluxo normal (Fase 1) ============

  // Se cliente está vendo uma casa (ou aguardando escolha) e envia algo que parece data,
  // encaminha pra fluxo de reserva ao invés de tentar match como casa
  const parsedDates = parseDateRange(t);
  if (parsedDates) {
    const house = houseFromState(state, catalog);
    if (house) {
      await handleParsedDates(m.from, parsedDates, house);
      return;
    }
    // Sem casa selecionada ainda
    await sendText(m.from,
      `Ótimo, entendi as datas! 📅\n\n` +
      `Mas antes me diga *de qual casa*. Digite o código (C01…C05) ou o nome.`);
    setState(m.from, { step: 'awaiting_house_choice' });
    return;
  }

  // 1. Match direto no catálogo
  const direct = matchHouse(t, catalog);
  if (direct) {
    await presentHouse(m.from, direct);
    setState(m.from, { step: 'showing_house', houseCode: direct.code });
    return;
  }

  // 2. Classificar via Gemini (ou fallback)
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

    case 'want_reserve': {
      const house = houseFromState(state, catalog);
      if (!house) {
        await sendText(m.from,
          `Pra reservar, primeiro me diga *qual casa*. Digite o código (C01…C05) ou o nome.`);
        setState(m.from, { step: 'awaiting_house_choice' });
        break;
      }
      // Se a mensagem já contém datas, tenta parsear
      const parsed = parseDateRange(intent.dateHint ?? t);
      if (parsed) {
        await handleParsedDates(m.from, parsed, house);
      } else {
        await sendText(m.from, msg.askDates(house));
        setState(m.from, { step: 'awaiting_dates', houseCode: house.code });
      }
      break;
    }

    default:
      await sendText(m.from, msg.greeting(catalog));
      setState(m.from, { step: 'awaiting_house_choice' });
  }
}

async function handleDatesReply(
  from: string, text: string, houseCode: string, catalog: House[],
): Promise<void> {
  const house = catalog.find(h => h.code === houseCode);
  if (!house) {
    await sendText(from, msg.NOT_FOUND);
    setState(from, { step: 'awaiting_house_choice' });
    return;
  }
  const parsed = parseDateRange(text);
  if (!parsed) {
    await sendText(from, msg.INVALID_DATES);
    return; // mantém estado awaiting_dates
  }
  await handleParsedDates(from, parsed, house);
}

async function handleParsedDates(
  from: string, range: { checkIn: Date; checkOut: Date }, house: House,
): Promise<void> {
  const avail = checkAvailability(house, range);
  if (!avail.available) {
    await sendText(from, msg.notAvailable(house, range.checkIn, range.checkOut));
    setState(from, { step: 'awaiting_dates', houseCode: house.code });
    return;
  }

  await sendText(from,
    msg.priceConfirmation(house, avail.nights, avail.totalCents, range.checkIn, range.checkOut));

  setState(from, {
    step: 'confirming_reservation',
    houseCode: house.code,
    checkInIso: isoOf(range.checkIn),
    checkOutIso: isoOf(range.checkOut),
    totalCents: avail.totalCents,
    nights: avail.nights,
  });
}

async function handleClientDataReply(
  from: string, text: string,
  state: Extract<ConversationState, { step: 'awaiting_client_data' }>,
  catalog: House[],
): Promise<void> {
  const data = parseClientData(text);
  if (!data) {
    await sendText(from, msg.INVALID_CLIENT_DATA);
    return; // mantém estado
  }
  const house = catalog.find(h => h.code === state.houseCode);
  if (!house) {
    await sendText(from, msg.NOT_FOUND);
    resetState(from);
    return;
  }

  const checkIn = fromIsoDate(state.checkInIso);
  const checkOut = fromIsoDate(state.checkOutIso);

  // Re-checa disponibilidade — outro cliente pode ter reservado enquanto esse digitava
  const avail = checkAvailability(house, { checkIn, checkOut });
  if (!avail.available) {
    await sendText(from, msg.notAvailable(house, checkIn, checkOut));
    setState(from, { step: 'awaiting_dates', houseCode: house.code });
    return;
  }

  const { reservation } = createPendingReservation({
    house, range: { checkIn, checkOut }, clientPhone: from,
  });
  attachClientData({
    reservationId: reservation.id,
    phone: from, name: data.name, cpf: data.cpf,
  });

  await sendText(from, msg.reservationConfirmed({
    id: reservation.id, house,
    clientName: data.name, clientCpf: data.cpf,
    checkIn, checkOut,
    nights: reservation.nights, totalCents: reservation.totalCents,
  }));

  await notifySupport(from, msg.reservationNotifySupport({
    id: reservation.id, house, clientPhone: from,
    clientName: data.name, clientCpf: data.cpf,
    checkIn, checkOut,
    nights: reservation.nights, totalCents: reservation.totalCents,
  }));

  setState(from, { step: 'reservation_pending', reservationId: reservation.id });
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

function houseFromState(state: ConversationState, catalog: House[]): House | null {
  if ('houseCode' in state) {
    return catalog.find(h => h.code === state.houseCode) ?? null;
  }
  return null;
}

function isoOf(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function absoluteMediaUrl(pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  return `${config.mediaBaseUrl}/${pathOrUrl.replace(/^\/+/, '')}`;
}

async function notifySupport(from: string, message: string): Promise<void> {
  if (from === config.supportPhone) return;
  try {
    await sendText(config.supportPhone, message);
  } catch (err) {
    console.error('[notifySupport] falhou:', err);
  }
}
