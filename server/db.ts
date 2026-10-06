import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const file = resolve(process.env.DB_FILE ?? 'data/mgc.db');
mkdirSync(dirname(file), { recursive: true });

/** Storage photos live as files next to the database (the /data volume in Docker). */
export const PHOTO_DIR = resolve(dirname(file), 'photos');
mkdirSync(PHOTO_DIR, { recursive: true });

export const db = new DatabaseSync(file);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS caddies (
  id INTEGER PRIMARY KEY,
  emp_no TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS carts (
  id INTEGER PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS members (
  id INTEGER PRIMARY KEY,
  member_no TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  designated_caddie_id INTEGER REFERENCES caddies(id)
);
-- One duty shift per caddie per day: which cart they drive and where they are in the queue.
CREATE TABLE IF NOT EXISTS shifts (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,
  caddie_id INTEGER NOT NULL REFERENCES caddies(id),
  cart_id INTEGER NOT NULL REFERENCES carts(id),
  check_in_at INTEGER NOT NULL,
  check_out_at INTEGER,
  status TEXT NOT NULL,
  queue_seq REAL NOT NULL,
  UNIQUE (date, caddie_id)
);
CREATE TABLE IF NOT EXISTS dispatches (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,
  party_id INTEGER NOT NULL,
  status TEXT NOT NULL,
  reason TEXT NOT NULL,
  requested_caddie_id INTEGER REFERENCES caddies(id),
  shift_id INTEGER REFERENCES shifts(id),
  caddie_id INTEGER REFERENCES caddies(id),
  cart_id INTEGER REFERENCES carts(id),
  holes INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  called_at INTEGER,
  recalled_at INTEGER,
  ready_at INTEGER,
  arrived_at INTEGER,
  ended_at INTEGER,
  cancelled_at INTEGER
);
CREATE TABLE IF NOT EXISTS dispatch_members (
  id INTEGER PRIMARY KEY,
  dispatch_id INTEGER NOT NULL REFERENCES dispatches(id),
  member_id INTEGER NOT NULL REFERENCES members(id),
  equipment TEXT NOT NULL,
  storage_item_id INTEGER REFERENCES storage_items(id),
  returned_to TEXT
);
CREATE TABLE IF NOT EXISTS storage_items (
  id INTEGER PRIMARY KEY,
  tag TEXT NOT NULL UNIQUE,
  member_id INTEGER NOT NULL REFERENCES members(id),
  description TEXT NOT NULL,
  status TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dispatch_date ON dispatches(date, status);
-- Photo proof of a stored bag's condition: on deposit, on return to storage, or a later check.
CREATE TABLE IF NOT EXISTS storage_photos (
  id INTEGER PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES storage_items(id),
  kind TEXT NOT NULL,
  taken_at INTEGER NOT NULL,
  file TEXT NOT NULL,
  dispatch_id INTEGER REFERENCES dispatches(id)
);
CREATE INDEX IF NOT EXISTS idx_shift_date ON shifts(date, status);
CREATE INDEX IF NOT EXISTS idx_photo_item ON storage_photos(item_id, taken_at);
`);

// Migrations for databases created by earlier builds.
const dispatchCols = db.prepare(`PRAGMA table_info(dispatches)`).all() as { name: string }[];
if (!dispatchCols.some((c) => c.name === 'ready_at')) db.exec(`ALTER TABLE dispatches ADD COLUMN ready_at INTEGER`);

export type Row = Record<string, any>;

export const all = (sql: string, ...p: any[]) => db.prepare(sql).all(...p) as Row[];
export const get = (sql: string, ...p: any[]) => db.prepare(sql).get(...p) as Row | undefined;
export const run = (sql: string, ...p: any[]) => db.prepare(sql).run(...p);

export function tx<T>(fn: () => T): T {
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
