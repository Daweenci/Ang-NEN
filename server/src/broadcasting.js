import { activePlayers } from './state.js';
import { MessageType } from './messageTypes.js';
import { sendResponse, toLobbyDTO, getLobbiesList } from './util.js';

export function broadcastToLobbyPlayers(lobby, response) {
  for (const player of [...lobby.players]) {
    sendResponse(player, response);
  }
}

export function broadcastLobbyUpdate(lobby) {
  broadcastToLobbyPlayers(lobby, {
    type: MessageType.ResponseLobbyUpdated,
    lobby: toLobbyDTO(lobby),
  });
}

// Sends the full lobby list to every connected player (main menu live update)
export function broadcastLobbies() {
  const response = {
    type: MessageType.ResponseLobbyList,
    lobbies: getLobbiesList(),
  };
  for (const player of activePlayers.values()) {
    sendResponse(player, response);
  }
}

export function broadcastTyping(lobby, playerID, playerName, isTyping) {
  const response = {
    type: MessageType.ResponsePlayerTyping,
    playerID,
    playerName,
    isTyping,
  };
  for (const player of [...lobby.players]) {
    // Don't send to the player who is typing
    if (player.id === playerID) continue;
    sendResponse(player, response);
  }
}

export function broadcastLobbyChatMessage(lobby, msg) {
  broadcastToLobbyPlayers(lobby, {
    type: MessageType.ResponseLobbyChatMessage,
    lobbyID: lobby.id,
    senderName: msg.senderName,
    senderID: msg.senderID,
    content: msg.content,
  });
}
