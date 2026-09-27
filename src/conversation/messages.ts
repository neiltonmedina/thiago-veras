import type { House } from '../types.js';
import { formatBR } from '../dates/parser.js';
import { formatCpf } from '../reservations/clientData.js';

const brl = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const brlCents = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function money(v: number): string { return `R$ ${brl.format(v)}`; }
function moneyCents(cents: number): string { return `R$ ${brlCents.format(cents / 100)}`; }

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
  `Exemplo: _João Silva, 12345678900_`,
].join('\n');

export const INVALID_CLIENT_DATA =
  `Não consegui ler seus dados. 🤔\n\n` +
  `Preciso do *nome completo* e do *CPF* (11 dígitos).\n` +
  `Exemplo: _João Silva, 12345678900_`;

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
    `⏰ Segurei essa data por *30 minutos*. Um atendente vai te chamar pra combinar o pagamento e confirmar.`,
    ``,
    `_(Em breve o pagamento via Pix será automático 🚀)_`,
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
}): string {
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
    `⏰ Expira em 30 min se não for confirmada.`,
  ].join('\n');
}
