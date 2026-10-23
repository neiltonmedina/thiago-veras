/**
 * Ciclo de vida da reserva depois de criada: cobrança Pix, confirmação de
 * pagamento, expiração e ações manuais do painel. Tudo que avisa o cliente
 * ou o atendente pelo WhatsApp passa por aqui.
 */
import type { House } from '../types.js';
import { config } from '../config.js';
import { getCatalog } from '../houses/catalog.js';
import * as msg from '../conversation/messages.js';
import { sendText, sendImageBase64, sendNotice } from '../whatsapp/client.js';
import { pixProvider } from '../pix/provider.js';
import { fromIsoDate, nightsBetween } from '../dates/parser.js';
import * as store from './store.js';
import type { Reservation } from './store.js';

export function depositFor(totalCents: number): number {
  return Math.round(totalCents * config.depositPercent / 100);
}

async function houseOf(r: Reservation): Promise<House | null> {
  const catalog = await getCatalog();
  return catalog.find(h => h.code === r.houseCode) ?? null;
}

/**
 * Mensagens pro atendente, ou disparadas pelo painel (às vezes dias depois),
 * podem cair fora da janela de 24h do WhatsApp: vão como aviso (template).
 * As demais respondem a um cliente que acabou de conversar e vão como texto.
 */
async function notify(to: string, text: string, opts: { outsideWindow?: boolean } = {}): Promise<void> {
  if (!to) return;
  try {
    if (opts.outsideWindow || to === config.supportPhone) await sendNotice(to, text);
    else await sendText(to, text);
  } catch (err) {
    console.error(`[notify] falhou pra ${to}:`, err);
  }
}

/**
 * Gera a cobrança Pix do sinal e envia ao cliente.
 * Retorna o valor cobrado, ou null se o Pix está desligado ou a Efí falhou
 * (aí o fluxo cai no pagamento combinado com o atendente).
 */
export async function sendPixForReservation(
  r: Reservation, house: House, payer: { name: string; cpf: string },
): Promise<number | null> {
  if (!pixProvider) return null;

  const depositCents = depositFor(r.totalCents);
  // A cobrança vence junto com a pré-reserva, pra ninguém pagar uma data já liberada
  const expiresInSec = Math.max(60, Math.floor(((r.expiresAt ?? Date.now()) - Date.now()) / 1000));

  let charge;
  try {
    charge = await pixProvider.createCharge({
      amountCents: depositCents,
      expiresInSec,
      payer,
      description: `Reserva #${r.id} - ${house.name}`,
    });
    store.setPixCharge(r.id, { txid: charge.txid, copyPaste: charge.copyPaste, depositCents });
  } catch (err) {
    console.error(`[pix] falha ao gerar cobrança da reserva #${r.id}:`, err);
    return null;
  }

  await sendText(r.clientPhone, msg.reservationAwaitingPix({
    id: r.id, house,
    checkIn: fromIsoDate(r.checkIn), checkOut: fromIsoDate(r.checkOut),
    nights: r.nights, totalCents: r.totalCents,
    depositCents, depositPercent: config.depositPercent,
  }));
  if (charge.qrImageBase64) {
    try {
      await sendImageBase64(r.clientPhone, charge.qrImageBase64, msg.PIX_QR_CAPTION);
    } catch {
      // O QR é conveniência; o copia e cola abaixo já basta pra pagar
    }
  }
  await sendText(r.clientPhone, msg.PIX_COPY_PASTE_INTRO);
  await sendText(r.clientPhone, charge.copyPaste);
  return depositCents;
}

/** Consulta a Efí e, se pago, confirma. Retorna o estado após a checagem. */
export async function checkPayment(r: Reservation): Promise<'paid' | 'pending'> {
  if (r.paidAt) return 'paid';
  if (!pixProvider || !r.pixTxid) return 'pending';
  const status = await pixProvider.getStatus(r.pixTxid);
  if (status !== 'CONCLUIDA') return 'pending';
  await finalizePayment(r);
  return 'paid';
}

async function finalizePayment(r: Reservation): Promise<void> {
  const house = await houseOf(r);
  if (!house) return;
  const paidCents = r.depositCents ?? r.totalCents;
  const checkIn = fromIsoDate(r.checkIn);
  const checkOut = fromIsoDate(r.checkOut);

  // Relê do banco: a reserva pode ter expirado enquanto consultávamos a Efí.
  // Daqui até gravar não há await: o SQLite é síncrono, então nenhuma outra
  // mensagem consegue reservar essas datas no meio.
  const current = store.getById(r.id);
  if (!current || current.paidAt) return;
  const conflict = current.status === 'cancelled'
    || (current.status === 'expired' && store.hasOverlap(r.houseCode, r.checkIn, r.checkOut, r.id));
  if (conflict) {
    if (!store.recordLatePayment(r.id)) return;
    await notify(r.clientPhone, msg.PAYMENT_CONFLICT_CLIENT);
    await notify(config.supportPhone, msg.supportPaymentConflict({
      id: r.id, house, clientPhone: r.clientPhone, checkIn, checkOut, paidCents,
    }));
    return;
  }
  if (!store.markPaid(r.id)) return; // outra checagem já confirmou

  await notify(r.clientPhone, msg.paymentConfirmed({
    id: r.id, house, checkIn, checkOut, totalCents: r.totalCents, paidCents,
  }));
  await notify(config.supportPhone, msg.supportPaymentReceived({
    id: r.id, house, clientPhone: r.clientPhone, checkIn, checkOut, paidCents, totalCents: r.totalCents,
  }));
}

/** Job periódico: confere todas as cobranças em aberto. */
export async function pollPayments(): Promise<void> {
  for (const r of store.listAwaitingPayment()) {
    try {
      await checkPayment(r);
    } catch (err) {
      console.error(`[pix] falha ao consultar reserva #${r.id}:`, err);
    }
  }
}

/** Job periódico: expira pré-reservas vencidas e avisa os clientes. */
export async function expireAndNotify(): Promise<number> {
  const expired = store.expirePending();
  for (const r of expired) {
    if (r.source !== 'whatsapp') continue;
    const house = await houseOf(r);
    if (house) await notify(r.clientPhone, msg.reservationExpired(r.id, house));
  }
  return expired.length;
}

// ============ Ações do painel ============

export type ActionResult = { ok: true; message: string } | { ok: false; message: string };

export async function confirmManually(id: number): Promise<ActionResult> {
  const r = store.getById(id);
  if (!r) return { ok: false, message: `Reserva #${id} não encontrada.` };
  if (r.status === 'confirmed') return { ok: true, message: `Reserva #${id} já estava confirmada.` };
  if (store.hasOverlap(r.houseCode, r.checkIn, r.checkOut, r.id)) {
    return { ok: false, message: `Não dá pra confirmar a #${id}: as datas já estão ocupadas por outra reserva.` };
  }
  store.markStatus(id, 'confirmed');

  const house = await houseOf(r);
  if (house && r.source === 'whatsapp') {
    await notify(r.clientPhone, msg.paymentConfirmed({
      id, house,
      checkIn: fromIsoDate(r.checkIn), checkOut: fromIsoDate(r.checkOut),
      totalCents: r.totalCents,
      paidCents: r.paidAt ? (r.depositCents ?? r.totalCents) : null,
    }), { outsideWindow: true });
  }
  return { ok: true, message: `Reserva #${id} confirmada e cliente avisado.` };
}

export async function cancelReservation(id: number): Promise<ActionResult> {
  const r = store.getById(id);
  if (!r) return { ok: false, message: `Reserva #${id} não encontrada.` };
  if (r.status === 'cancelled') return { ok: true, message: `Reserva #${id} já estava cancelada.` };
  store.markStatus(id, 'cancelled');

  const house = await houseOf(r);
  if (house && r.source === 'whatsapp') {
    await notify(r.clientPhone, msg.reservationCancelled(id, house), { outsideWindow: true });
  }
  const refund = r.paidAt ? ' Atenção: essa reserva tinha Pix pago — faça a devolução pelo app do banco.' : '';
  return { ok: true, message: `Reserva #${id} cancelada.${refund}` };
}

export async function blockDates(input: {
  houseCode: string; checkInIso: string; checkOutIso: string; note: string;
}): Promise<ActionResult> {
  const catalog = await getCatalog();
  const house = catalog.find(h => h.code === input.houseCode);
  if (!house) return { ok: false, message: 'Casa inválida.' };

  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (!iso.test(input.checkInIso) || !iso.test(input.checkOutIso)) {
    return { ok: false, message: 'Datas inválidas.' };
  }
  const nights = nightsBetween(fromIsoDate(input.checkInIso), fromIsoDate(input.checkOutIso));
  if (!(nights > 0)) return { ok: false, message: 'A saída precisa ser depois da entrada.' };
  if (store.hasOverlap(house.code, input.checkInIso, input.checkOutIso)) {
    return { ok: false, message: `${house.name} já tem reserva nesse período.` };
  }
  const block = store.createManualBlock({
    houseCode: house.code,
    checkIn: input.checkInIso,
    checkOut: input.checkOutIso,
    nights,
    note: input.note.trim().slice(0, 200) || 'Bloqueio manual',
  });
  return { ok: true, message: `Datas bloqueadas na ${house.name} (#${block.id}).` };
}
