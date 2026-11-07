import { WebSocket } from 'ws';
import { lobbies, activePlayers, pendingInvites } from './state.js';
import { broadcastLobbyUpdate, broadcastLobbies } from './broadcasting.js';
import { MessageType } from './messageTypes.js';

export function toPlayerDTOs(players) {
  return players.map((p) => ({ id: p.id, name: p.name }));
}

export function toLobbyDTO(lobby) {
  return {
    id: lobby.id,
    name: lobby.name,
    maxPlayers: lobby.maxPlayers,
    isPrivate: lobby.isPrivate,
    players: toPlayerDTOs(lobby.players),
    gameStart: lobby.gameStart.map((s) => ({ ...s })),
  };
}

export function getLobbiesList() {
  return [...lobbies.values()].map(toLobbyDTO);
}

export function isLobbyFull(lobby) {
  return lobby.players.length >= lobby.maxPlayers;
}

export function sendResponse(player, response) {
  if (!player || player.ws.readyState !== WebSocket.OPEN) return;
  player.ws.send(JSON.stringify(response));
}

export function sendErrorToPlayer(player, error) {
  sendResponse(player, { type: MessageType.ResponseError, error });
}

// Logout: closes the connection opened with this session (refresh token family)
export function closeSessionConnection(sessionID) {
  for (const player of activePlayers.values()) {
    if (player.sessionID === sessionID) {
      player.ws.close(4000, 'Logged out');
    }
  }
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

export function deleteLobby(lobby) {
  lobbies.delete(lobby.id);
}
