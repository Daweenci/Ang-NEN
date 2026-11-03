import bcrypt from 'bcryptjs';
import { db } from './db.js';

export function createPlayer(username, password) {
  const hash = bcrypt.hashSync(password, 10);
  try {
    const row = db
      .prepare('INSERT INTO players (username, password_hash) VALUES (?, ?) RETURNING id')
      .get(username, hash);
    return row.id;
  } catch (err) {
    throw new Error(`failed to create player: ${err.message}`);
  }
}

// Returns the playerID, or null if the credentials are wrong
export function verifyPlayerCredentials(username, password) {
  const row = db.prepare('SELECT id, password_hash FROM players WHERE username = ?').get(username);
  if (!row || !bcrypt.compareSync(password, row.password_hash)) {
    return null;
  }

  try {
    db.prepare('UPDATE players SET last_login = CURRENT_TIMESTAMP WHERE id = ?').run(row.id);
  } catch (err) {
    console.log(`Failed to update last login for player ${row.id}: ${err.message}`);
  }

  return row.id;
}

export function getPlayerByID(playerID) {
  return (
    db
      .prepare('SELECT id, username, password_hash, created_at, last_login FROM players WHERE id = ?')
      .get(playerID) ?? null
  );
}

export function getPlayerIdByName(username) {
  const row = db.prepare('SELECT id FROM players WHERE username = ?').get(username);
  return row ? row.id : null;
}
