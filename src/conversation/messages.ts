import type { House } from '../types.js';

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
    ? `💰 *R$ ${h.dailyPrice}/diária* · R$ ${h.weekendPrice}/fim de semana`
    : `💰 *R$ ${h.dailyPrice}/diária*`;

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

export const RESERVE_SOON =
  `Boa! 🎉 A reserva com Pix automático ainda está sendo finalizada nesta versão.\n\n` +
  `Vou passar a conversa pra um atendente humano fechar sua reserva agora. ⏳`;
