import crypto from 'node:crypto';
import { db } from './db.js';
import { REFRESH_TOKEN_TTL_DAYS } from './session.js';

// Runs inside the database worker.
// Sliding lifetime: every successful refresh issues a new token valid for
// another 14 days, so active players stay logged in.
const REFRESH_TTL_SQL = `+${REFRESH_TOKEN_TTL_DAYS} days`;

// Two tabs may refresh with the same token at nearly the same time. A token
// that was rotated less than this many seconds ago is not treated as stolen.
const ROTATION_GRACE_SECONDS = 30;

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function insertToken(playerID, familyID) {
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare(
    `INSERT INTO refresh_tokens (player_id, family_id, token_hash, expires_at)
     VALUES (?, ?, ?, datetime('now', ?))`
  ).run(playerID, familyID, hashToken(token), REFRESH_TTL_SQL);
  return token;
}

function revokeFamily(familyID, reason) {
  db.prepare(
    `UPDATE refresh_tokens SET revoked_at = CURRENT_TIMESTAMP, revoke_reason = ?
     WHERE family_id = ? AND revoked_at IS NULL`
  ).run(reason, familyID);
}

// New login: starts a new token family (= one session)
export function createSession(playerID) {
  const familyID = crypto.randomUUID();
  const token = insertToken(playerID, familyID);
  return { familyID, token };
}

// Exchanges a refresh token for a new one of the same family.
// Returns { status: 'ok', playerID, familyID, token }
//      or { status: 'grace' }   (rotated just now by a parallel request)
//      or { status: 'invalid' } (unknown, expired, revoked or reused)
function rotate(token) {
  const row = db
    .prepare(
      `SELECT id, player_id, family_id, revoke_reason,
              expires_at <= datetime('now') AS expired,
              revoked_at > datetime('now', ?) AS recently_revoked
       FROM refresh_tokens WHERE token_hash = ?`
    )
    .get(`-${ROTATION_GRACE_SECONDS} seconds`, hashToken(token));

  if (!row || row.expired) return { status: 'invalid' };

  if (row.revoke_reason) {
    if (row.revoke_reason === 'rotated' && row.recently_revoked) {
      return { status: 'grace' };
    }
    // A token that was already replaced is used again: someone has a copy.
    // End the whole session for both the attacker and the real user.
    if (row.revoke_reason === 'rotated') {
      console.log(`Refresh token reuse detected for player ${row.player_id}, revoking session`);
      revokeFamily(row.family_id, 'reuse');
    }
    return { status: 'invalid' };
  }

  db.prepare(
    `UPDATE refresh_tokens SET revoked_at = CURRENT_TIMESTAMP, revoke_reason = 'rotated' WHERE id = ?`
  ).run(row.id);
  const newToken = insertToken(row.player_id, row.family_id);
  return { status: 'ok', playerID: row.player_id, familyID: row.family_id, token: newToken };
}

// Runs as one transaction, so a token can't be rotated twice
export function rotateRefreshToken(token) {
  return db.transaction(rotate)(token);
}

// Logout: revokes every token of the session the given token belongs to.
// Returns the family ID, or null if the token is unknown.
export function revokeSessionByToken(token) {
  const row = db.prepare('SELECT family_id FROM refresh_tokens WHERE token_hash = ?').get(hashToken(token));
  if (!row) return null;
  revokeFamily(row.family_id, 'logout');
  return row.family_id;
}

// Expired rows are useless (also for reuse detection), so they can go.
export function deleteExpiredRefreshTokens() {
  return db.prepare(`DELETE FROM refresh_tokens WHERE expires_at <= datetime('now')`).run().changes;
}
