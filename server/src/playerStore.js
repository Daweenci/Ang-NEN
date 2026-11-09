import { db } from './db.js';

// Runs inside the database worker. Passwords are hashed in the password worker
// (passwords.js); this module only stores and returns the hash.

export function createPlayer(username, passwordHash) {
  try {
    const row = db
      .prepare('INSERT INTO players (username, password_hash) VALUES (?, ?) RETURNING id')
      .get(username, passwordHash);
    return row.id;
  } catch (err) {
    throw new Error(`failed to create player: ${err.message}`);
  }
}

// Returns { id, password_hash } for the login check, or null if the name is unknown
export function getLoginData(username) {
  return db.prepare('SELECT id, password_hash FROM players WHERE username = ?').get(username) ?? null;
}

export function updateLastLogin(playerID) {
  db.prepare('UPDATE players SET last_login = CURRENT_TIMESTAMP WHERE id = ?').run(playerID);
}

export function getPlayerByID(playerID) {
  return (
    db
      .prepare('SELECT id, username, created_at, last_login FROM players WHERE id = ?')
      .get(playerID) ?? null
  );
}

export function getPlayerIdByName(username) {
  const row = db.prepare('SELECT id FROM players WHERE username = ?').get(username);
  return row ? row.id : null;
}
