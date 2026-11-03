import { WebSocketServer } from 'ws';
import { activePlayers } from './state.js';
import { MessageType } from './messageTypes.js';
import { parseJWT } from './jwt.js';
import { getPlayerByID } from './playerStore.js';
import { getPendingFriendRequests } from './friendsStore.js';
import { broadcastLobbies } from './broadcasting.js';
import { sendResponse, sendErrorToConn, sendErrorToPlayer, disconnectPlayer, getLobbiesList } from './util.js';
import * as handlers from './handlers.js';

// Message type -> handler(player, msg). The player is always taken from the
// authenticated connection, never from the message body.
const routes = {
  [MessageType.RequestJoinLobby]: handlers.joinLobbyHandler,
  [MessageType.RequestLeaveLobby]: handlers.leaveLobbyHandler,
  [MessageType.RequestCreateLobby]: handlers.createLobbyHandler,
  [MessageType.RequestStartGame]: handlers.startGameHandler,
  [MessageType.RequestCancelGame]: handlers.cancelGameHandler,
  [MessageType.RequestAddFriend]: handlers.sendFriendRequestHandler,
  [MessageType.RequestAcceptFriendRequest]: handlers.acceptFriendRequestHandler,
  [MessageType.RequestRemoveFriend]: handlers.removeFriendHandler,
  [MessageType.RequestSendLobbyChatMessage]: handlers.sendLobbyChatMessageHandler,
  [MessageType.RequestStartedTyping]: handlers.typingHandler,
  [MessageType.RequestInviteToLobby]: handlers.inviteToLobbyHandler,
  [MessageType.RequestDeclineInvite]: handlers.declineInviteHandler,
  [MessageType.RequestSendPrivateMessage]: handlers.sendPrivateMessageHandler,
  [MessageType.RequestGetPrivateMessages]: handlers.getPrivateMessagesHandler,
  [MessageType.RequestPrivateTyping]: handlers.privateTypingHandler,
};

export function attachWebSocketServer(httpServer) {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  wss.on('connection', (ws, req) => {
    console.log(`NEW WEBSOCKET CONNECTION from ${req.socket.remoteAddress}`);

    // Set once the client sent a valid "authenticate" message
    let player = null;

    ws.on('message', (data) => {
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        sendErrorToConn(ws, 'Invalid message format');
        return;
      }
      if (!msg || typeof msg !== 'object') {
        sendErrorToConn(ws, 'Invalid message format');
        return;
      }

      // If not authenticated yet, only accept authenticate messages
      if (!player) {
        player = authenticate(ws, msg);
        return;
      }

      const handler = routes[msg.type];
      if (!handler) {
        sendErrorToPlayer(player, 'Unknown message type');
        return;
      }

      try {
        handler(player, msg);
      } catch (err) {
        console.log(`Error handling ${msg.type}: ${err.stack}`);
        sendErrorToPlayer(player, `Invalid ${msg.type} message`);
      }
    });

    ws.on('close', () => {
      if (!player) return;

      // Only clean up if this connection is still the active one
      // (it may have been replaced by a newer login of the same player)
      if (activePlayers.get(player.id)?.ws === ws) {
        disconnectPlayer(player.id);
        broadcastLobbies();
        handlers.pingAllFriendsOnlineStatusHandler(player.id, false);
      }
    });

    ws.on('error', (err) => {
      console.log(`WebSocket error: ${err.message}`);
    });
  });

  return wss;
}

function authenticate(ws, msg) {
  if (msg.type !== MessageType.RequestAuthentication || !msg.token) {
    sendErrorToConn(ws, 'Authentication required');
    return null;
  }

  let playerID;
  try {
    playerID = parseJWT(msg.token);
  } catch {
    sendErrorToConn(ws, 'Invalid or expired token');
    return null;
  }

  const dbPlayer = getPlayerByID(playerID);
  if (!dbPlayer) {
    sendErrorToConn(ws, 'Player not found');
    return null;
  }

  const player = { id: dbPlayer.id, name: dbPlayer.username, ws };

  const oldPlayer = activePlayers.get(player.id);
  if (oldPlayer) {
    console.log(`Player ${player.id} already connected, disconnecting old connection`);
    oldPlayer.ws.close(1008, 'Duplicate login');
    disconnectPlayer(oldPlayer.id);
  }
  activePlayers.set(player.id, player);

  sendResponse(player, {
    type: MessageType.ResponseWelcome,
    player: { id: player.id, name: player.name },
    message: `Welcome back, ${player.name}!`,
    lobbies: getLobbiesList(),
    pendingFriendRequests: getPendingFriendRequests(player.id),
    friendsList: handlers.getFriendsWithOnlineStatus(player.id),
  });
  console.log(`Player ${player.id} authenticated successfully`);
  handlers.pingAllFriendsOnlineStatusHandler(player.id, true);

  return player;
}
