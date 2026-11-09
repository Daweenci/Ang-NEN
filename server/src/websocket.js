import { WebSocketServer, WebSocket } from 'ws';
import { activePlayers } from './state.js';
import { MessageType } from './messageTypes.js';
import { parseJWT } from './jwt.js';
import { getPlayerByID, getPendingFriendRequests } from './database.js';
import { broadcastLobbies } from './broadcasting.js';
import { sendResponse, sendErrorToPlayer, disconnectPlayer, getLobbiesList } from './util.js';
import { getAccessToken, getAllowedOrigins } from './session.js';
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
    handleUpgrade(wss, allowedOrigins, req, socket, head).catch((err) => {
      console.log(`Upgrade failed: ${err.message}`);
      rejectUpgrade(socket, 500, 'Internal Server Error');
    });
  });

  wss.on('connection', (ws, req, session) => {
    console.log(`NEW WEBSOCKET CONNECTION from ${req.socket.remoteAddress}`);

    // Handlers may wait for the database. So that the messages of one client
    // are still handled strictly in the order they were sent, every step of
    // this connection is chained onto one queue. Other connections are not
    // affected and keep being served meanwhile.
    let player = null;
    let queue = registerConnection(ws, session).then((registered) => {
      player = registered;
    });
    const enqueue = (step) => {
      queue = queue.then(step).catch((err) => console.log(`Connection step failed: ${err.stack}`));
    };

    ws.on('message', (data) => enqueue(() => handleMessage(player, data)));
    ws.on('close', () => enqueue(() => handleClose(ws, player)));
    ws.on('error', (err) => {
      console.log(`WebSocket error: ${err.message}`);
    });
  });

  return wss;
}

async function handleUpgrade(wss, allowedOrigins, req, socket, head) {
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

  const session = await authenticateRequest(req);
  if (socket.destroyed) return; // client gave up while we checked
  if (!session) {
    // Also for an expired access token: the client then calls /auth/refresh
    rejectUpgrade(socket, 401, 'Unauthorized');
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req, session);
  });
}

async function handleMessage(player, data) {
  if (!player) return; // connection closed before it was registered

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
    await handler(player, msg);
  } catch (err) {
    console.log(`Error handling ${msg.type}: ${err.stack}`);
    sendErrorToPlayer(player, `Invalid ${msg.type} message`);
  }
}

async function handleClose(ws, player) {
  if (!player) return;

  // Only clean up if this connection is still the active one
  // (it may have been replaced by a newer login of the same player)
  if (activePlayers.get(player.id)?.ws === ws) {
    disconnectPlayer(player.id);
    broadcastLobbies();
    await handlers.pingAllFriendsOnlineStatusHandler(player.id, false);
  }
}

function rejectUpgrade(socket, status, reason) {
  if (socket.destroyed) return;
  socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

// Checks the access token cookie of a handshake request.
// Returns { dbPlayer, sessionID } or null.
async function authenticateRequest(req) {
  const token = getAccessToken(req);
  if (!token) return null;

  let claims;
  try {
    claims = parseJWT(token); // also rejects expired tokens
  } catch {
    return null;
  }
  const dbPlayer = await getPlayerByID(claims.playerID);
  return dbPlayer ? { dbPlayer, sessionID: claims.sessionID } : null;
}

// Returns the registered player, or null if the connection closed meanwhile
async function registerConnection(ws, { dbPlayer, sessionID }) {
  // Load everything from the database first ...
  const [pendingFriendRequests, friendsList] = await Promise.all([
    getPendingFriendRequests(dbPlayer.id),
    handlers.getFriendsWithOnlineStatus(dbPlayer.id),
  ]);
  if (ws.readyState !== WebSocket.OPEN) return null;

  // ... then update the in-memory state without any await in between, so no
  // other handler can run in the middle of it.
  // The access token is only checked at the handshake. The connection stays open after
  // it expires; logout closes it via the sessionID (closeSessionConnection).
  const player = { id: dbPlayer.id, name: dbPlayer.username, sessionID, ws };

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
    pendingFriendRequests,
    friendsList,
  });
  console.log(`Player ${player.id} connected and authenticated`);
  await handlers.pingAllFriendsOnlineStatusHandler(player.id, true);

  return player;
}
