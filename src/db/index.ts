import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from '../config.js';

// Cria diretório do banco se não existir (só quando é arquivo, não :memory:)
if (config.dbPath !== ':memory:') {
  const dir = dirname(config.dbPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Migração inline — idempotente
db.exec(`
  CREATE TABLE IF NOT EXISTS clients (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    phone       TEXT UNIQUE NOT NULL,
    name        TEXT,
    cpf         TEXT,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS reservations (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    house_code    TEXT NOT NULL,
    check_in      TEXT NOT NULL,           -- YYYY-MM-DD
    check_out     TEXT NOT NULL,           -- YYYY-MM-DD (exclusive)
    nights        INTEGER NOT NULL,
    total_cents   INTEGER NOT NULL,        -- centavos para evitar float
    client_id     INTEGER,
    client_phone  TEXT NOT NULL,
    status        TEXT NOT NULL,           -- 'pending' | 'confirmed' | 'cancelled' | 'expired'
    expires_at    INTEGER,                 -- ms unix; NULL para não-pending
    created_at    INTEGER NOT NULL,
    FOREIGN KEY (client_id) REFERENCES clients(id)
  );

  CREATE INDEX IF NOT EXISTS idx_res_house_status
    ON reservations(house_code, status);

  CREATE INDEX IF NOT EXISTS idx_res_expires
    ON reservations(expires_at) WHERE status = 'pending';
`);

/** Fecha o banco. Chamar em graceful shutdown. */
export function closeDb(): void {
  db.close();
}
