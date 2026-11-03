import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = path.resolve(__dirname, '..');

export let db = null;

export function initDB() {
  const dbPath = path.join(SERVER_ROOT, 'game.db');
  db = new Database(dbPath);

  const { version } = db.prepare('SELECT sqlite_version() AS version').get();
  console.log('SQLite version:', version);

  // Recommended SQLite settings for servers
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  loadSchema();

  console.log('Database connection established successfully');
}

function loadSchema() {
  const schema = fs.readFileSync(path.join(SERVER_ROOT, 'schema.sql'), 'utf8');
  db.exec(schema);
}

export function closeDB() {
  if (db) {
    db.close();
    db = null;
  }
}
