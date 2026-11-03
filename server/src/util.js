import { WebSocket } from 'ws';
import { lobbies, activePlayers, pendingInvites } from './state.js';
import { broadcastLobbyUpdate, broadcastLobbies } from './broadcasting.js';
import { MessageType } from './messageTypes.js';

export function toPlayerDTOs(players) {
  return players.map((p) => ({ id: p.id, name: p.name }));
}

export function toBotDTOs(bots) {
  return bots.map((b) => ({ id: b.id, name: b.name }));
}

export function toLobbyDTO(lobby) {
  return {
    id: lobby.id,
    name: lobby.name,
    maxPlayers: lobby.maxPlayers,
    isPrivate: lobby.isPrivate,
    players: toPlayerDTOs(lobby.players),
    bots: toBotDTOs(lobby.bots),
    gameStart: lobby.gameStart.map((s) => ({ ...s })),
  };
}

export function getLobbiesList() {
  return [...lobbies.values()].map(toLobbyDTO);
}

export function isLobbyFull(lobby) {
  return lobby.players.length + lobby.bots.length >= lobby.maxPlayers;
}

export function sendResponse(player, response) {
  if (!player || player.ws.readyState !== WebSocket.OPEN) return;
  player.ws.send(JSON.stringify(response));
}

export function sendErrorToPlayer(player, error) {
  sendResponse(player, { type: MessageType.ResponseError, error });
}

// Used before the connection is authenticated (no Player object yet)
export function sendErrorToConn(ws, error) {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: MessageType.ResponseError, error }));
}

export function disconnectPlayer(playerID) {
  const player = activePlayers.get(playerID);
  if (player) {
    activePlayers.delete(playerID);
    pendingInvites.delete(playerID);
    player.ws.close();
  }
  removePlayerFromLobbies(playerID);
}

export function removePlayerFromLobbies(playerID) {
  for (const lobby of lobbies.values()) {
    const index = lobby.players.findIndex((p) => p.id === playerID);
    if (index === -1) continue;

    lobby.players.splice(index, 1);
    lobby.gameStart = lobby.gameStart.filter((s) => s.playerID !== playerID);

    if (lobby.players.length === 0) {
      deleteLobby(lobby);
    } else {
      broadcastLobbyUpdate(lobby);
    }
    broadcastLobbies();
    return;
  }
}

// Removes the lobby and stops all of its bots
export function deleteLobby(lobby) {
  for (const bot of lobby.bots) {
    bot.stop();
  }
  lobbies.delete(lobby.id);
}
