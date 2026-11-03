import { db } from './db.js';

export class FriendRequestExistsError extends Error {
  constructor() {
    super('friend request already exists');
  }
}

// friend_lists stores every pair once, with the smaller ID first
function orderedPair(a, b) {
  return a < b ? [a, b] : [b, a];
}

export function createFriendRequest(playerID, friendID) {
  try {
    db.prepare('INSERT INTO friend_requests (sender_id, receiver_id) VALUES (?, ?)').run(playerID, friendID);
  } catch (err) {
    if (err.message.includes('UNIQUE constraint failed')) {
      throw new FriendRequestExistsError();
    }
    console.log(`Error creating friend request: ${err.message}`);
    throw err;
  }
}

export function getPendingFriendRequests(playerID) {
  try {
    return db
      .prepare(
        `SELECT fr.sender_id AS id, p.username AS name
         FROM friend_requests fr
         JOIN players p ON fr.sender_id = p.id
         WHERE fr.receiver_id = ? AND fr.status = 'pending'`
      )
      .all(playerID);
  } catch (err) {
    console.log(`Error fetching friend requests: ${err.message}`);
    return [];
  }
}

export function handleFriendRequest(senderID, receiverID, acceptRequest) {
  const result = db
    .prepare(`DELETE FROM friend_requests WHERE sender_id = ? AND receiver_id = ? AND status = 'pending'`)
    .run(senderID, receiverID);

  if (result.changes === 0) {
    throw new Error('friend request not found');
  }

  if (!acceptRequest) {
    return;
  }

  const [firstID, secondID] = orderedPair(senderID, receiverID);
  try {
    db.prepare('INSERT INTO friend_lists (first_player_id, second_player_id) VALUES (?, ?)').run(firstID, secondID);
  } catch (err) {
    if (err.message.includes('UNIQUE constraint failed')) {
      return;
    }
    console.log(`Error creating friendship: ${err.message}`);
    throw err;
  }
}

export function getFriendsList(playerID) {
  try {
    return db
      .prepare(
        `SELECT fl.second_player_id AS id, p.username AS name
         FROM friend_lists fl
         JOIN players p ON p.id = fl.second_player_id
         WHERE fl.first_player_id = ?

         UNION

         SELECT fl.first_player_id AS id, p.username AS name
         FROM friend_lists fl
         JOIN players p ON p.id = fl.first_player_id
         WHERE fl.second_player_id = ?`
      )
      .all(playerID, playerID);
  } catch (err) {
    console.log(`Error fetching friends list: ${err.message}`);
    return [];
  }
}

export function areFriends(playerID, otherPlayerID) {
  const [firstID, secondID] = orderedPair(playerID, otherPlayerID);
  const row = db
    .prepare('SELECT 1 FROM friend_lists WHERE first_player_id = ? AND second_player_id = ?')
    .get(firstID, secondID);
  return Boolean(row);
}

export function removeFriend(playerID, friendID) {
  const [firstID, secondID] = orderedPair(playerID, friendID);
  const result = db
    .prepare('DELETE FROM friend_lists WHERE first_player_id = ? AND second_player_id = ?')
    .run(firstID, secondID);

  if (result.changes === 0) {
    throw new Error('friendship not found');
  }
}
