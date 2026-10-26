import type { House } from '../types.js';
import { formatBR } from '../dates/parser.js';
import { formatCpf } from '../reservations/clientData.js';
import { config } from '../config.js';

const brl = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const brlCents = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function money(v: number): string { return `R$ ${brl.format(v)}`; }
function moneyCents(cents: number): string { return `R$ ${brlCents.format(cents / 100)}`; }

/** Prazo da pré-reserva em texto: "30 minutos", "3 horas", "1h30". */
function holdLabel(): string {
  const m = config.holdMinutes;
  if (m < 60) return `${m} minutos`;
  const h = Math.floor(m / 60), r = m % 60;
  if (r) return `${h}h${String(r).padStart(2, '0')}`;
  return h === 1 ? '1 hora' : `${h} horas`;
}

export function greeting(catalog: House[]): string {
  const list = catalog.slice(0, 5).map(h =>
    `*${h.code}* — ${h.name}\n_${h.city} · ${h.bedrooms}q · até ${h.capacity} pessoas_`
  ).join('\n\n');

  return [
    `Olá! 👋 Bem-vindo(a) às *Casas do Litoral PI*.`,
    ``,
    `Temos as seguintes casas disponíveis:`,
    ``,
    list,
    ``,
    `Digite o *código* ou *nome* da casa que quer conhecer.`,
  ].join('\n');
}

export function houseCaption(h: House): string {
  const priceLine = h.weekendPrice
    ? `💰 *${money(h.dailyPrice)}/diária* · ${money(h.weekendPrice)}/fim de semana`
    : `💰 *${money(h.dailyPrice)}/diária*`;

  const amen = h.amenities.length ? h.amenities.map(a => `• ${a}`).join('\n') + '\n\n' : '';
  const desc = h.description ? `${h.description}\n\n` : '';
  const maps = h.mapsUrl ? `📍 ${h.mapsUrl}\n\n` : '';

  return [
    `*${h.name}* 🏖️  — ${h.city}`,
    ``,
    `🛏️ ${h.bedrooms} quartos · 👥 até ${h.capacity} pessoas`,
    priceLine,
    ``,
    amen + desc + maps + `Quer *reservar*? Me diga o período de check-in e check-out.\nEx: _15/12 a 18/12_`,
  ].join('\n');
}

export const NOT_FOUND =
  `Hmm, não achei essa casa. 🤔\n\n` +
  `Você pode digitar *lista* pra ver todas, ou o código (ex: *C01*), ` +
  `ou o nome da casa/praia.`;

export const HANDOFF =
  `Sem problema! Já avisei nosso atendente. 🙂\n` +
  `Ele te chama por aqui em instantes.`;

// ============ Fase 2 — Reserva ============

export function askDates(h: House): string {
  return [
    `Pra reservar a *${h.name}*, me diga as datas de *check-in* e *check-out*.`,
    ``,
    `Exemplos que eu entendo:`,
    `• _15/12 a 18/12_`,
    `• _15 a 18 de dezembro_`,
    `• _sexta a domingo_`,
    `• _próximo fim de semana_`,
  ].join('\n');
}

export const INVALID_DATES =
  `Hmm, não consegui entender essas datas. 🤔\n\n` +
  `Tente assim: _15/12 a 18/12_ (ou _15 a 18 de dezembro_).\n` +
  `A data de check-in precisa ser hoje ou depois.`;

export function priceConfirmation(
  h: House, nights: number, totalCents: number, checkIn: Date, checkOut: Date,
): string {
  const diarias = nights === 1 ? '1 diária' : `${nights} diárias`;
  return [
    `✅ *Disponível!*`,
    ``,
    `🏠 *${h.name}*`,
    `📅 ${formatBR(checkIn)} → ${formatBR(checkOut)}  (${diarias})`,
    `💰 Total: *${moneyCents(totalCents)}*`,
    ``,
    `Posso registrar a pré-reserva? Responda *sim* ou *não*.`,
  ].join('\n');
}

export function notAvailable(h: House, checkIn: Date, checkOut: Date): string {
  return [
    `Ops! 😕 A *${h.name}* já está reservada de ${formatBR(checkIn)} a ${formatBR(checkOut)}.`,
    ``,
    `Quer tentar *outras datas*, ou prefere ver *outra casa*?`,
  ].join('\n');
}

export const ASK_CLIENT_DATA = [
  `Boa! 🎉 Pra fechar a pré-reserva, me passe seus dados:`,
  ``,
  `• *Nome completo*`,
  `• *CPF* (só os números ou com pontuação)`,
  ``,
  `Exemplo: _João Silva, 123.456.789-09_`,
].join('\n');

export const INVALID_CLIENT_DATA =
  `Não consegui ler seus dados. 🤔\n\n` +
  `Preciso do *nome completo* e do *CPF* (11 dígitos).\n` +
  `Exemplo: _João Silva, 123.456.789-09_`;

export const INVALID_CPF =
  `Esse CPF não parece válido. 🤔 Confere os números e me manda de novo, junto com o nome completo.`;

export function reservationConfirmed(input: {
  id: number;
  house: House;
  clientName: string;
  clientCpf: string;
  checkIn: Date;
  checkOut: Date;
  nights: number;
  totalCents: number;
}): string {
  const diarias = input.nights === 1 ? '1 diária' : `${input.nights} diárias`;
  return [
    `✅ *Pré-reserva #${input.id} criada!*`,
    ``,
    `🏠 ${input.house.name}`,
    `📅 ${formatBR(input.checkIn)} → ${formatBR(input.checkOut)}  (${diarias})`,
    `👤 ${input.clientName}`,
    `📄 CPF ${formatCpf(input.clientCpf)}`,
    `💰 Total: *${moneyCents(input.totalCents)}*`,
    ``,
    `⏰ Segurei essa data por *${holdLabel()}*. O Thiago vai te chamar aqui mesmo, em instantes, pra enviar o Pix e os detalhes da reserva.`,
  ].join('\n');
}

export function reservationNotifySupport(input: {
  id: number;
  house: House;
  clientPhone: string;
  clientName: string;
  clientCpf: string;
  checkIn: Date;
  checkOut: Date;
  nights: number;
  totalCents: number;
  depositCents?: number;
}): string {
  const payment = input.depositCents
    ? `⏰ Pix do sinal (${moneyCents(input.depositCents)}) enviado. Confirmo sozinho quando cair; expira em ${holdLabel()}.`
    : `⏰ Chame o cliente, envie o Pix e os detalhes. Depois confirme no painel. Sem confirmação, a data é liberada em ${holdLabel()}.`;
  return [
    `📩 *Nova pré-reserva #${input.id}*`,
    ``,
    `🏠 ${input.house.code} — ${input.house.name}`,
    `📅 ${formatBR(input.checkIn)} → ${formatBR(input.checkOut)} (${input.nights} diárias)`,
    `💰 ${moneyCents(input.totalCents)}`,
    ``,
    `👤 ${input.clientName}`,
    `📄 CPF ${formatCpf(input.clientCpf)}`,
    `📱 ${input.clientPhone}`,
    ``,
    payment,
  ].join('\n');
}

// ============ Fase 3 — Pix ============

export function reservationAwaitingPix(input: {
  id: number;
  house: House;
  checkIn: Date;
  checkOut: Date;
  nights: number;
  totalCents: number;
  depositCents: number;
  depositPercent: number;
}): string {
  const diarias = input.nights === 1 ? '1 diária' : `${input.nights} diárias`;
  const isFull = input.depositCents >= input.totalCents;
  return [
    `✅ *Pré-reserva #${input.id} criada!*`,
    ``,
    `🏠 ${input.house.name}`,
    `📅 ${formatBR(input.checkIn)} → ${formatBR(input.checkOut)}  (${diarias})`,
    `💰 Total: ${moneyCents(input.totalCents)}`,
    isFull
      ? `💳 Pagamento via Pix: *${moneyCents(input.depositCents)}*`
      : `💳 Sinal (${input.depositPercent}%) via Pix: *${moneyCents(input.depositCents)}*`,
    ``,
    `⏰ Segurei a data por *${holdLabel()}*. Pague pelo QR Code ou pelo código *copia e cola* abaixo.`,
    `Assim que o Pix cair, confirmo sua reserva automaticamente. 🙌`,
  ].join('\n');
}

export const PIX_QR_CAPTION = `QR Code do Pix 👆 Abra o app do seu banco e escaneie.`;

export const PIX_COPY_PASTE_INTRO = `👇 *Pix copia e cola* (toque e segure pra copiar):`;

export function paymentConfirmed(input: {
  id: number;
  house: House;
  checkIn: Date;
  checkOut: Date;
  totalCents: number;
  paidCents: number | null;
}): string {
  const remaining = input.paidCents != null ? input.totalCents - input.paidCents : 0;
  return [
    `🎉 *Reserva #${input.id} confirmada!*`,
    ``,
    `🏠 ${input.house.name}`,
    `📅 Check-in ${formatBR(input.checkIn)} · Check-out ${formatBR(input.checkOut)}`,
    input.paidCents != null ? `✅ Recebemos ${moneyCents(input.paidCents)}` : null,
    remaining > 0 ? `💰 Restante: ${moneyCents(remaining)} (combinamos com você antes do check-in)` : null,
    ``,
    `Nosso atendente vai te chamar com as orientações de chegada. Boa viagem! 🏖️`,
  ].filter(l => l !== null).join('\n');
}

export const PAYMENT_NOT_FOUND_YET =
  `Ainda não identifiquei o pagamento. ⏳ O Pix pode levar alguns minutos pra aparecer.\n\n` +
  `Eu confiro sozinho a cada minuto e te aviso assim que cair. Se precisar, digite *atendente*.`;

export function reservationExpired(id: number, house: House): string {
  return [
    `⏰ A pré-reserva #${id} da *${house.name}* expirou porque o pagamento não foi identificado em ${holdLabel()}.`,
    ``,
    `Se ainda quiser, me mande as datas de novo que eu verifico a disponibilidade. Se você *já pagou*, digite *atendente*.`,
  ].join('\n');
}

export function reservationCancelled(id: number, house: House): string {
  return `A reserva #${id} da *${house.name}* foi cancelada. Qualquer dúvida, digite *atendente*.`;
}

export function supportPaymentReceived(input: {
  id: number; house: House; clientPhone: string; checkIn: Date; checkOut: Date; paidCents: number; totalCents: number;
}): string {
  return [
    `💰 *Pix recebido — reserva #${input.id} confirmada*`,
    ``,
    `🏠 ${input.house.code} — ${input.house.name}`,
    `📅 ${formatBR(input.checkIn)} → ${formatBR(input.checkOut)}`,
    `✅ Pago: ${moneyCents(input.paidCents)} de ${moneyCents(input.totalCents)}`,
    `📱 ${input.clientPhone}`,
  ].join('\n');
}

export function supportPaymentConflict(input: {
  id: number; house: House; clientPhone: string; checkIn: Date; checkOut: Date; paidCents: number;
}): string {
  return [
    `⚠️ *Pix recebido, mas a data já foi ocupada — reserva #${input.id}*`,
    ``,
    `O cliente pagou depois que a pré-reserva expirou e outra reserva pegou as datas.`,
    `🏠 ${input.house.code} — ${input.house.name}`,
    `📅 ${formatBR(input.checkIn)} → ${formatBR(input.checkOut)}`,
    `💰 Pago: ${moneyCents(input.paidCents)}`,
    `📱 ${input.clientPhone}`,
    ``,
    `👉 Fale com o cliente: oferecer outras datas ou devolver o valor.`,
  ].join('\n');
}

export const PAYMENT_CONFLICT_CLIENT =
  `Recebemos seu Pix, mas a pré-reserva tinha expirado e as datas foram ocupadas nesse meio-tempo. 😕\n\n` +
  `Já avisei nosso atendente: ele vai te chamar pra oferecer outras datas ou devolver o valor.`;
