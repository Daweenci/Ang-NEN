import { WebSocketServer } from 'ws';
import { activePlayers } from './state.js';
import { MessageType } from './messageTypes.js';
import { parseJWT } from './jwt.js';
import { getPlayerByID } from './playerStore.js';
import { getPendingFriendRequests } from './friendsStore.js';
import { broadcastLobbies } from './broadcasting.js';
import { sendResponse, sendErrorToPlayer, disconnectPlayer, getLobbiesList } from './util.js';
import { getSessionToken, getAllowedOrigins } from './session.js';
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
  // noServer: the handshake is checked in the 'upgrade' handler below first,
  // so unauthenticated clients never get a WebSocket connection at all.
  const wss = new WebSocketServer({ noServer: true });
  const allowedOrigins = getAllowedOrigins();

  httpServer.on('upgrade', (req, socket, head) => {
    socket.on('error', (err) => console.log(`Upgrade socket error: ${err.message}`));

    const { pathname } = new URL(req.url, 'http://localhost');
    if (pathname !== '/ws') {
      socket.destroy();
      return;
    }

    // The browser sends the session cookie automatically, also from foreign
    // pages. Checking the Origin header prevents cross-site WebSocket hijacking.
    if (!allowedOrigins.includes(req.headers.origin)) {
      rejectUpgrade(socket, 403, 'Forbidden');
      return;
    }

    const dbPlayer = authenticateRequest(req);
    if (!dbPlayer) {
      rejectUpgrade(socket, 401, 'Unauthorized');
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req, dbPlayer);
    });
  });

  wss.on('connection', (ws, req, dbPlayer) => {
    console.log(`NEW WEBSOCKET CONNECTION from ${req.socket.remoteAddress}`);

    const player = registerConnection(ws, dbPlayer);

    ws.on('message', (data) => {
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        sendErrorToPlayer(player, 'Invalid message format');
        return;
      }
      if (!msg || typeof msg !== 'object') {
        sendErrorToPlayer(player, 'Invalid message format');
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

function rejectUpgrade(socket, status, reason) {
  socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

// Returns the player for the session cookie of a handshake request, or null
function authenticateRequest(req) {
  const token = getSessionToken(req);
  if (!token) return null;

  let playerID;
  try {
    playerID = parseJWT(token);
  } catch {
    return null;
  }
  return getPlayerByID(playerID);
}

function registerConnection(ws, dbPlayer) {
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
  console.log(`Player ${player.id} connected and authenticated`);
  handlers.pingAllFriendsOnlineStatusHandler(player.id, true);

  return player;
}
