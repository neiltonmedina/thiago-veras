import { db } from '../db/index.js';

export type Reservation = {
  id: number;
  houseCode: string;
  checkIn: string;      // YYYY-MM-DD
  checkOut: string;     // YYYY-MM-DD
  nights: number;
  totalCents: number;
  clientId: number | null;
  clientPhone: string;
  status: 'pending' | 'confirmed' | 'cancelled' | 'expired';
  expiresAt: number | null;
  createdAt: number;
};

export type Client = {
  id: number;
  phone: string;
  name: string | null;
  cpf: string | null;
  createdAt: number;
  updatedAt: number;
};

type ReservationRow = {
  id: number;
  house_code: string;
  check_in: string;
  check_out: string;
  nights: number;
  total_cents: number;
  client_id: number | null;
  client_phone: string;
  status: Reservation['status'];
  expires_at: number | null;
  created_at: number;
};

function fromRow(r: ReservationRow): Reservation {
  return {
    id: r.id,
    houseCode: r.house_code,
    checkIn: r.check_in,
    checkOut: r.check_out,
    nights: r.nights,
    totalCents: r.total_cents,
    clientId: r.client_id,
    clientPhone: r.client_phone,
    status: r.status,
    expiresAt: r.expires_at,
    createdAt: r.created_at,
  };
}

/** Verifica conflito de datas com reservas ativas (pending ou confirmed) daquela casa. */
export function hasOverlap(houseCode: string, checkIn: string, checkOut: string): boolean {
  // Duas faixas [aIn, aOut) e [bIn, bOut) se sobrepõem sse aIn < bOut && bIn < aOut
  const row = db.prepare(`
    SELECT 1 FROM reservations
    WHERE house_code = ?
      AND status IN ('pending', 'confirmed')
      AND check_in < ?
      AND check_out > ?
    LIMIT 1
  `).get(houseCode, checkOut, checkIn);
  return !!row;
}

export function createPending(input: {
  houseCode: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  totalCents: number;
  clientPhone: string;
  ttlMs: number;
}): Reservation {
  const now = Date.now();
  const expiresAt = now + input.ttlMs;
  const result = db.prepare(`
    INSERT INTO reservations (
      house_code, check_in, check_out, nights, total_cents,
      client_phone, status, expires_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)
  `).run(
    input.houseCode, input.checkIn, input.checkOut,
    input.nights, input.totalCents, input.clientPhone, expiresAt, now,
  );
  return getById(Number(result.lastInsertRowid))!;
}

export function attachClient(reservationId: number, clientId: number): void {
  db.prepare(`UPDATE reservations SET client_id = ? WHERE id = ?`).run(clientId, reservationId);
}

export function markStatus(id: number, status: Reservation['status']): void {
  db.prepare(`UPDATE reservations SET status = ?, expires_at = NULL WHERE id = ?`).run(status, id);
}

export function getById(id: number): Reservation | null {
  const row = db.prepare(`SELECT * FROM reservations WHERE id = ?`).get(id) as ReservationRow | undefined;
  return row ? fromRow(row) : null;
}

export function expirePending(now: number = Date.now()): number {
  const result = db.prepare(`
    UPDATE reservations SET status = 'expired'
    WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at < ?
  `).run(now);
  return result.changes;
}

// ============ Clients ============

export function upsertClient(input: { phone: string; name?: string; cpf?: string }): Client {
  const now = Date.now();
  const existing = db.prepare(`SELECT * FROM clients WHERE phone = ?`).get(input.phone) as Client | undefined;
  if (existing) {
    const name = input.name ?? existing.name;
    const cpf = input.cpf ?? existing.cpf;
    db.prepare(`UPDATE clients SET name = ?, cpf = ?, updated_at = ? WHERE phone = ?`)
      .run(name, cpf, now, input.phone);
    return getClientByPhone(input.phone)!;
  }
  const result = db.prepare(`
    INSERT INTO clients (phone, name, cpf, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(input.phone, input.name ?? null, input.cpf ?? null, now, now);
  return getClientById(Number(result.lastInsertRowid))!;
}

export function getClientByPhone(phone: string): Client | null {
  const row = db.prepare(`SELECT * FROM clients WHERE phone = ?`).get(phone) as any;
  return row ? { ...row, createdAt: row.created_at, updatedAt: row.updated_at } : null;
}

export function getClientById(id: number): Client | null {
  const row = db.prepare(`SELECT * FROM clients WHERE id = ?`).get(id) as any;
  return row ? { ...row, createdAt: row.created_at, updatedAt: row.updated_at } : null;
}

/** Reserva pendente mais recente de um cliente, se houver. */
export function getLatestPendingByPhone(phone: string): Reservation | null {
  const row = db.prepare(`
    SELECT * FROM reservations
    WHERE client_phone = ? AND status = 'pending'
    ORDER BY created_at DESC LIMIT 1
  `).get(phone) as ReservationRow | undefined;
  return row ? fromRow(row) : null;
}
