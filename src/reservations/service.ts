import type { House } from '../types.js';
import type { DateRange } from '../dates/parser.js';
import { toIsoDate, nightsBetween } from '../dates/parser.js';
import * as store from './store.js';

export const PENDING_TTL_MS = 30 * 60 * 1000; // 30 minutos

export type Availability =
  | { available: true; nights: number; totalCents: number }
  | { available: false; reason: 'overlap' | 'invalid' };

/** Verifica disponibilidade e calcula preço em uma passada. */
export function checkAvailability(house: House, range: DateRange): Availability {
  const nights = nightsBetween(range.checkIn, range.checkOut);
  if (nights <= 0) return { available: false, reason: 'invalid' };

  const overlap = store.hasOverlap(
    house.code, toIsoDate(range.checkIn), toIsoDate(range.checkOut),
  );
  if (overlap) return { available: false, reason: 'overlap' };

  const totalCents = calcTotalCents(house, nights);
  return { available: true, nights, totalCents };
}

/** Preço: sempre nights × dailyPrice (weekendPrice é só display). */
function calcTotalCents(house: House, nights: number): number {
  return nights * house.dailyPrice * 100;
}

export function createPendingReservation(input: {
  house: House;
  range: DateRange;
  clientPhone: string;
}): { reservation: store.Reservation; totalCents: number } {
  const { nights, totalCents } = {
    nights: nightsBetween(input.range.checkIn, input.range.checkOut),
    totalCents: calcTotalCents(input.house, nightsBetween(input.range.checkIn, input.range.checkOut)),
  };

  const reservation = store.createPending({
    houseCode: input.house.code,
    checkIn: toIsoDate(input.range.checkIn),
    checkOut: toIsoDate(input.range.checkOut),
    nights,
    totalCents,
    clientPhone: input.clientPhone,
    ttlMs: PENDING_TTL_MS,
  });

  return { reservation, totalCents };
}

/** Grava/atualiza cliente e liga à reserva. */
export function attachClientData(input: {
  reservationId: number;
  phone: string;
  name: string;
  cpf: string;
}): store.Client {
  const client = store.upsertClient({ phone: input.phone, name: input.name, cpf: input.cpf });
  store.attachClient(input.reservationId, client.id);
  return client;
}

/** Job periódico: marca pending vencidas como expired. Retorna quantas. */
export function expireOldPending(): number {
  return store.expirePending();
}
