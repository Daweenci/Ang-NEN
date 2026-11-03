// In-memory server state. Node runs handlers on a single thread,
// so unlike the Go version no locks are needed around these maps.

/**
 * @typedef {{ id: string, name: string, ws: import('ws').WebSocket }} Player
 * @typedef {{ playerID: string }} PlayerStarted
 * @typedef {{ senderID: string, senderName: string, content: string }} LobbyChatMessage
 * @typedef {{
 *   id: string, name: string, maxPlayers: number, isPrivate: boolean, password: string,
 *   players: Player[], gameStart: PlayerStarted[], chatHistory: LobbyChatMessage[]
 * }} Lobby
 */

/** @type {Map<string, Lobby>} lobbyID -> lobby */
export const lobbies = new Map();

/** @type {Map<string, Player>} playerID -> player */
export const activePlayers = new Map();

/** @type {Map<string, string[]>} playerID -> lobbyIDs they are invited to */
export const pendingInvites = new Map();

export function removePendingInvite(playerID, lobbyID) {
  const invites = pendingInvites.get(playerID);
  if (!invites) return;
  const remaining = invites.filter((id) => id !== lobbyID);
  if (remaining.length === 0) {
    pendingInvites.delete(playerID);
  } else {
    pendingInvites.set(playerID, remaining);
  }
}
