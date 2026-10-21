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

// Colunas adicionadas depois da Fase 2. SQLite não tem ADD COLUMN IF NOT EXISTS,
// então checamos antes pra a migração rodar em bancos já existentes.
function addColumnIfMissing(table: string, column: string, definition: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some(c => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

addColumnIfMissing('reservations', 'source', `TEXT NOT NULL DEFAULT 'whatsapp'`); // 'whatsapp' | 'manual'
addColumnIfMissing('reservations', 'note', 'TEXT');
addColumnIfMissing('reservations', 'deposit_cents', 'INTEGER');
addColumnIfMissing('reservations', 'pix_txid', 'TEXT');
addColumnIfMissing('reservations', 'pix_copy_paste', 'TEXT');
addColumnIfMissing('reservations', 'paid_at', 'INTEGER');
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_res_pix_txid ON reservations(pix_txid) WHERE pix_txid IS NOT NULL`);

/** Fecha o banco. Chamar em graceful shutdown. */
export function closeDb(): void {
  db.close();
}
