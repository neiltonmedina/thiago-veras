import { db } from '../db/index.js';

export type ReservationStatus = 'pending' | 'confirmed' | 'cancelled' | 'expired';

export type Reservation = {
  id: number;
  houseCode: string;
  checkIn: string;      // YYYY-MM-DD
  checkOut: string;     // YYYY-MM-DD (exclusive)
  nights: number;
  totalCents: number;
  depositCents: number | null;
  clientId: number | null;
  clientPhone: string;
  status: ReservationStatus;
  source: 'whatsapp' | 'manual' | 'site';
  note: string | null;
  pixTxid: string | null;
  pixCopyPaste: string | null;
  paidAt: number | null;
  expiresAt: number | null;
  createdAt: number;
  guestName: string | null;
  guests: number | null;
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
  deposit_cents: number | null;
  client_id: number | null;
  client_phone: string;
  status: ReservationStatus;
  source: Reservation['source'];
  note: string | null;
  pix_txid: string | null;
  pix_copy_paste: string | null;
  paid_at: number | null;
  expires_at: number | null;
  created_at: number;
  guest_name: string | null;
  guests: number | null;
};

type ClientRow = {
  id: number;
  phone: string;
  name: string | null;
  cpf: string | null;
  created_at: number;
  updated_at: number;
};

function fromRow(r: ReservationRow): Reservation {
  return {
    id: r.id,
    houseCode: r.house_code,
    checkIn: r.check_in,
    checkOut: r.check_out,
    nights: r.nights,
    totalCents: r.total_cents,
    depositCents: r.deposit_cents,
    clientId: r.client_id,
    clientPhone: r.client_phone,
    status: r.status,
    source: r.source,
    note: r.note,
    pixTxid: r.pix_txid,
    pixCopyPaste: r.pix_copy_paste,
    paidAt: r.paid_at,
    expiresAt: r.expires_at,
    createdAt: r.created_at,
    guestName: r.guest_name,
    guests: r.guests,
  };
}

function clientFromRow(r: ClientRow): Client {
  return { id: r.id, phone: r.phone, name: r.name, cpf: r.cpf, createdAt: r.created_at, updatedAt: r.updated_at };
}

/**
 * Conflito com reservas ativas (pending ou confirmed) da casa.
 * Faixas [aIn, aOut) e [bIn, bOut) se sobrepõem sse aIn < bOut && bIn < aOut.
 * `ignoreId` exclui a própria reserva (útil ao confirmar um pagamento atrasado).
 */
export function hasOverlap(houseCode: string, checkIn: string, checkOut: string, ignoreId?: number): boolean {
  const row = db.prepare(`
    SELECT 1 FROM reservations
    WHERE house_code = ?
      AND status IN ('pending', 'confirmed')
      AND check_in < ?
      AND check_out > ?
      AND id != ?
    LIMIT 1
  `).get(houseCode, checkOut, checkIn, ignoreId ?? -1);
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
  source?: 'whatsapp' | 'site';
  guestName?: string | null;
  guests?: number | null;
}): Reservation {
  const now = Date.now();
  const result = db.prepare(`
    INSERT INTO reservations (
      house_code, check_in, check_out, nights, total_cents,
      client_phone, status, source, expires_at, created_at, guest_name, guests
    ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)
  `).run(
    input.houseCode, input.checkIn, input.checkOut,
    input.nights, input.totalCents, input.clientPhone, input.source ?? 'whatsapp',
    now + input.ttlMs, now, input.guestName ?? null, input.guests ?? null,
  );
  return getById(Number(result.lastInsertRowid))!;
}

/** Bloqueio manual de datas pelo painel (reserva feita por telefone, Airbnb, uso próprio...). */
export function createManualBlock(input: {
  houseCode: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  note: string;
}): Reservation {
  const result = db.prepare(`
    INSERT INTO reservations (
      house_code, check_in, check_out, nights, total_cents,
      client_phone, status, source, note, created_at
    ) VALUES (?, ?, ?, ?, 0, '', 'confirmed', 'manual', ?, ?)
  `).run(input.houseCode, input.checkIn, input.checkOut, input.nights, input.note, Date.now());
  return getById(Number(result.lastInsertRowid))!;
}

export function attachClient(reservationId: number, clientId: number): void {
  db.prepare(`UPDATE reservations SET client_id = ? WHERE id = ?`).run(clientId, reservationId);
}

export function markStatus(id: number, status: ReservationStatus): void {
  db.prepare(`UPDATE reservations SET status = ?, expires_at = NULL WHERE id = ?`).run(status, id);
}

export function setPixCharge(id: number, input: { txid: string; copyPaste: string; depositCents: number }): void {
  db.prepare(`
    UPDATE reservations SET pix_txid = ?, pix_copy_paste = ?, deposit_cents = ? WHERE id = ?
  `).run(input.txid, input.copyPaste, input.depositCents, id);
}

/**
 * Marca como paga e confirmada. Atômico: só altera se ainda não estava paga,
 * então webhook, polling e "paguei" podem disparar juntos sem confirmar duas vezes.
 * Retorna true se esta chamada foi a que confirmou.
 */
export function markPaid(id: number): boolean {
  const result = db.prepare(`
    UPDATE reservations
    SET status = 'confirmed', paid_at = ?, expires_at = NULL
    WHERE id = ? AND paid_at IS NULL
  `).run(Date.now(), id);
  return result.changes > 0;
}

/** Registra pagamento sem confirmar (pago depois de expirar, com a data já ocupada). */
export function recordLatePayment(id: number): boolean {
  const result = db.prepare(`
    UPDATE reservations SET paid_at = ?, note = 'Pago após expirar; datas já ocupadas — devolver ou remarcar'
    WHERE id = ? AND paid_at IS NULL
  `).run(Date.now(), id);
  return result.changes > 0;
}

export function getById(id: number): Reservation | null {
  const row = db.prepare(`SELECT * FROM reservations WHERE id = ?`).get(id) as ReservationRow | undefined;
  return row ? fromRow(row) : null;
}

export function getByTxid(txid: string): Reservation | null {
  const row = db.prepare(`SELECT * FROM reservations WHERE pix_txid = ?`).get(txid) as ReservationRow | undefined;
  return row ? fromRow(row) : null;
}

/**
 * Reservas com Pix gerado e ainda não pago — alvo do polling de pagamento.
 * Inclui as expiradas nas últimas 2h pra pegar pagamento feito no último minuto.
 */
export function listAwaitingPayment(now: number = Date.now()): Reservation[] {
  const rows = db.prepare(`
    SELECT * FROM reservations
    WHERE pix_txid IS NOT NULL AND paid_at IS NULL
      AND (status = 'pending' OR (status = 'expired' AND expires_at > ?))
  `).all(now - 2 * 60 * 60 * 1000) as ReservationRow[];
  return rows.map(fromRow);
}

/** Reservas que ainda não terminaram (checkout hoje ou depois), mais as recentes. */
export function listForAdmin(todayIso: string): Reservation[] {
  const rows = db.prepare(`
    SELECT * FROM reservations
    WHERE check_out >= ? OR created_at > ?
    ORDER BY check_in ASC, id ASC
  `).all(todayIso, Date.now() - 7 * 24 * 60 * 60 * 1000) as ReservationRow[];
  return rows.map(fromRow);
}

export function expirePending(now: number = Date.now()): Reservation[] {
  const rows = db.prepare(`
    UPDATE reservations SET status = 'expired'
    WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at < ?
    RETURNING *
  `).all(now) as ReservationRow[];
  return rows.map(fromRow);
}

/**
 * Períodos ocupados (reservas pendentes e confirmadas, bloqueios manuais) que
 * ainda não terminaram. Alimenta o calendário do site; não expõe dados de cliente.
 */
export function listOccupied(todayIso: string, houseCode?: string): { houseCode: string; checkIn: string; checkOut: string }[] {
  const rows = db.prepare(`
    SELECT house_code, check_in, check_out FROM reservations
    WHERE status IN ('pending', 'confirmed')
      AND check_out > ?
      AND (? IS NULL OR house_code = ?)
    ORDER BY house_code, check_in
  `).all(todayIso, houseCode ?? null, houseCode ?? null) as { house_code: string; check_in: string; check_out: string }[];
  return rows.map(r => ({ houseCode: r.house_code, checkIn: r.check_in, checkOut: r.check_out }));
}

/** Pré-reservas em aberto vindas do site para um mesmo IP-chave (limite anti-abuso). */
export function countActiveSiteHolds(phone: string): number {
  if (!phone) return 0;
  const row = db.prepare(`
    SELECT COUNT(*) AS n FROM reservations
    WHERE source = 'site' AND status = 'pending' AND client_phone = ?
  `).get(phone) as { n: number };
  return row.n;
}

// ============ Clients ============

export function upsertClient(input: { phone: string; name?: string; cpf?: string }): Client {
  const now = Date.now();
  db.prepare(`
    INSERT INTO clients (phone, name, cpf, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(phone) DO UPDATE SET
      name = COALESCE(excluded.name, clients.name),
      cpf = COALESCE(excluded.cpf, clients.cpf),
      updated_at = excluded.updated_at
  `).run(input.phone, input.name ?? null, input.cpf ?? null, now, now);
  return getClientByPhone(input.phone)!;
}

export function getClientByPhone(phone: string): Client | null {
  const row = db.prepare(`SELECT * FROM clients WHERE phone = ?`).get(phone) as ClientRow | undefined;
  return row ? clientFromRow(row) : null;
}

export function getClientById(id: number): Client | null {
  const row = db.prepare(`SELECT * FROM clients WHERE id = ?`).get(id) as ClientRow | undefined;
  return row ? clientFromRow(row) : null;
}
