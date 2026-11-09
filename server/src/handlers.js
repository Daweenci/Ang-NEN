import crypto from 'node:crypto';
import { lobbies, activePlayers, pendingInvites, removePendingInvite } from './state.js';
import { MessageType } from './messageTypes.js';
import {
  sendResponse,
  sendErrorToPlayer,
  toLobbyDTO,
  isLobbyFull,
  deleteLobby,
} from './util.js';
import {
  broadcastLobbyUpdate,
  broadcastLobbies,
  broadcastTyping,
  broadcastLobbyChatMessage,
} from './broadcasting.js';
// Database calls run in the database worker and return Promises (database.js).
// Handlers that use them are async; websocket.js still runs the messages of one
// connection strictly one after another.
import {
  getPlayerIdByName,
  getPlayerByID,
  areFriends,
  createFriendRequest,
  getPendingFriendRequests,
  handleFriendRequest,
  getFriendsList,
  removeFriend,
  createPrivateMessage,
  getPrivateMessages,
} from './database.js';

// ---------- Lobbies ----------

export function joinLobbyHandler(player, msg) {
  const lobby = lobbies.get(msg.lobbyID);
  if (!lobby) {
    console.log('joinLobbyHandler: Lobby not found');
    return;
  }

  if (lobby.players.some((p) => p.id === player.id)) {
    return;
  }

  // Leave current lobby if in one
  for (const other of lobbies.values()) {
    if (other.id === lobby.id) continue;
    const index = other.players.findIndex((p) => p.id === player.id);
    if (index === -1) continue;

    other.players.splice(index, 1);
    other.gameStart = other.gameStart.filter((s) => s.playerID !== player.id);
    if (other.players.length === 0) {
      deleteLobby(other);
    } else {
      broadcastLobbyUpdate(other);
    }
    broadcastLobbies();
    break;
  }

  // Only check password if no valid invite
  const hasInvite = (pendingInvites.get(player.id) ?? []).includes(lobby.id);
  if (!hasInvite && lobby.password !== (msg.password ?? '')) {
    sendResponse(player, { type: MessageType.ResponseJoinLobbyFailed, message: 'Incorrect password' });
    return;
  }

  if (isLobbyFull(lobby)) {
    sendResponse(player, { type: MessageType.ResponseJoinLobbyFailed, message: 'Lobby is full' });
    return;
  }

  lobby.players.push(player);

  // Always clean up any pending invite for this lobby
  removePendingInvite(player.id, lobby.id);

  sendResponse(player, {
    type: MessageType.ResponseJoinLobbySuccessful,
    lobby: toLobbyDTO(lobby),
    chatHistory: lobby.chatHistory,
  });
  broadcastLobbyUpdate(lobby);
  broadcastLobbies();
}

export function leaveLobbyHandler(player, msg) {
  const lobby = lobbies.get(msg.lobbyID);
  if (!lobby) {
    console.log('leaveLobbyHandler: Lobby not found');
    return;
  }

  lobby.gameStart = lobby.gameStart.filter((s) => s.playerID !== player.id);
  lobby.players = lobby.players.filter((p) => p.id !== player.id);

  if (lobby.players.length === 0) {
    deleteLobby(lobby);
  } else {
    broadcastLobbyUpdate(lobby);
  }

  sendResponse(player, { type: MessageType.ResponseLobbyLeft });
  broadcastLobbies();
}

export function createLobbyHandler(player, msg) {
  const lobby = {
    id: crypto.randomUUID(),
    name: msg.lobbyName ?? '',
    maxPlayers: Number(msg.maxPlayers) || 0,
    isPrivate: Boolean(msg.isPrivate),
    password: msg.password ?? '',
    players: [player],
    gameStart: [],
    chatHistory: [],
  };
  lobbies.set(lobby.id, lobby);

  sendResponse(player, { type: MessageType.ResponseLobbyCreated, lobby: toLobbyDTO(lobby) });
  broadcastLobbies();
}

export function startGameHandler(player, msg) {
  const lobby = lobbies.get(msg.lobbyID);
  if (!lobby) {
    console.log('startGameHandler: Lobby not found');
    return;
  }

  if (!lobby.gameStart.some((s) => s.playerID === player.id)) {
    lobby.gameStart.push({ playerID: player.id });
  }
  broadcastLobbyUpdate(lobby);
}

export function cancelGameHandler(player, msg) {
  const lobby = lobbies.get(msg.lobbyID);
  if (!lobby) {
    console.log('cancelGameHandler: Lobby not found');
    return;
  }

  lobby.gameStart = lobby.gameStart.filter((s) => s.playerID !== player.id);
  broadcastLobbyUpdate(lobby);
}

// ---------- Friends ----------

function sendFriendRequestResult(player, success, message) {
  sendResponse(player, { type: MessageType.ResponseFriendRequestSent, success, message });
}

export async function sendFriendRequestHandler(player, msg) {
  const friendID = await getPlayerIdByName(msg.friendName ?? '');
  if (!friendID) {
    sendFriendRequestResult(player, false, 'Player not found');
    return;
  }

  if (player.id === friendID) {
    sendFriendRequestResult(player, false, 'You cannot add yourself');
    return;
  }

  if (await areFriends(player.id, friendID)) {
    sendFriendRequestResult(player, false, 'You are already friends');
    return;
  }

  try {
    await createFriendRequest(player.id, friendID);
  } catch (err) {
    if (err.name === 'FriendRequestExistsError') {
      sendFriendRequestResult(player, false, 'Friend request already sent');
      return;
    }
    console.log(`sendFriendRequestHandler: ${err.message}`);
    sendFriendRequestResult(player, false, 'Error creating friend request');
    return;
  }

  sendFriendRequestResult(player, true, 'Friend request sent');

  // Live notification for the receiver, if online
  const friend = activePlayers.get(friendID);
  if (!friend) {
    console.log('sendFriendRequestHandler: Friend not online');
    return;
  }
  sendResponse(friend, {
    type: MessageType.ResponseFriendRequestReceived,
    player: { id: player.id, name: player.name },
  });
}

export async function acceptFriendRequestHandler(player, msg) {
  const friendID = msg.friendID;
  const acceptRequest = Boolean(msg.acceptRequest);

  try {
    await handleFriendRequest(friendID, player.id, acceptRequest);
  } catch (err) {
    sendErrorToPlayer(player, 'Error handling friend request');
    console.log(`acceptFriendRequestHandler: ${err.message}`);
    return;
  }

  sendResponse(player, {
    type: MessageType.ResponsePendingFriendRequests,
    pendingFriendRequests: await getPendingFriendRequests(player.id),
  });
  if (acceptRequest) {
    sendResponse(player, {
      type: MessageType.ResponseFriendsList,
      friendsList: await getFriendsWithOnlineStatus(player.id),
    });
  }

  const friend = activePlayers.get(friendID);
  if (!friend) {
    console.log('acceptFriendRequestHandler: Friend not online');
    return;
  }
  sendResponse(friend, {
    type: MessageType.ResponsePendingFriendRequests,
    pendingFriendRequests: await getPendingFriendRequests(friendID),
  });

  if (acceptRequest) {
    sendResponse(friend, {
      type: MessageType.ResponseFriendRequestAccepted,
      friend: { id: player.id, name: player.name, isOnline: true },
    });
  }
}

export async function removeFriendHandler(player, msg) {
  try {
    await removeFriend(player.id, msg.friendID);
  } catch (err) {
    console.log(`removeFriendHandler: ${err.message}`);
    sendErrorToPlayer(player, 'Error removing friend');
    return;
  }

  sendResponse(player, { type: MessageType.ResponseFriendRemoved, friendID: msg.friendID });

  const friend = activePlayers.get(msg.friendID);
  if (friend) {
    sendResponse(friend, {
      type: MessageType.ResponseFriendsList,
      friendsList: await getFriendsWithOnlineStatus(msg.friendID),
    });
  }
}

export async function getFriendsWithOnlineStatus(playerID) {
  return (await getFriendsList(playerID)).map((f) => ({
    id: f.id,
    name: f.name,
    isOnline: activePlayers.has(f.id),
  }));
}

export async function pingAllFriendsOnlineStatusHandler(playerID, isOnline) {
  const dbPlayer = await getPlayerByID(playerID);
  if (!dbPlayer) {
    console.log('pingAllFriendsOnlineStatusHandler: Player not found');
    return;
  }

  const response = {
    type: MessageType.ResponseFriendOnlineStatus,
    friend: { id: dbPlayer.id, name: dbPlayer.username, isOnline },
  };
  for (const f of await getFriendsList(playerID)) {
    sendResponse(activePlayers.get(f.id), response);
  }
}

// ---------- Private chat ----------

const MAX_PRIVATE_MESSAGE_LENGTH = 2000;

export async function sendPrivateMessageHandler(player, msg) {
  const content = typeof msg.content === 'string' ? msg.content.trim() : '';
  if (!content || content.length > MAX_PRIVATE_MESSAGE_LENGTH) {
    sendErrorToPlayer(player, 'Invalid message');
    return;
  }
  if (!(await areFriends(player.id, msg.friendID))) {
    sendErrorToPlayer(player, 'You can only message friends');
    return;
  }

  const message = await createPrivateMessage(player.id, msg.friendID, content);
  stopPrivateTyping(player.id, msg.friendID);

  // Echo to the sender (confirms the stored message) and push live to the friend.
  // friendID is always "the other person" from the receiver's point of view.
  sendResponse(player, { type: MessageType.ResponsePrivateMessage, friendID: msg.friendID, message });
  sendResponse(activePlayers.get(msg.friendID), {
    type: MessageType.ResponsePrivateMessage,
    friendID: player.id,
    message,
  });
}

export async function getPrivateMessagesHandler(player, msg) {
  if (!(await areFriends(player.id, msg.friendID))) {
    sendErrorToPlayer(player, 'You can only message friends');
    return;
  }
  sendResponse(player, {
    type: MessageType.ResponsePrivateMessages,
    friendID: msg.friendID,
    messages: await getPrivateMessages(player.id, msg.friendID),
  });
}

const privateTypingTimers = new Map(); // "playerID:friendID" -> timeout

export async function privateTypingHandler(player, msg) {
  if (!msg.isTyping) {
    stopPrivateTyping(player.id, msg.friendID);
    return;
  }
  if (!(await areFriends(player.id, msg.friendID))) return;

  sendResponse(activePlayers.get(msg.friendID), {
    type: MessageType.ResponsePrivateTyping,
    friendID: player.id,
    isTyping: true,
  });

  const key = `${player.id}:${msg.friendID}`;
  clearTimeout(privateTypingTimers.get(key));
  privateTypingTimers.set(
    key,
    setTimeout(() => stopPrivateTyping(player.id, msg.friendID), 5000)
  );
}

function stopPrivateTyping(playerID, friendID) {
  const key = `${playerID}:${friendID}`;
  if (!privateTypingTimers.has(key)) return;
  clearTimeout(privateTypingTimers.get(key));
  privateTypingTimers.delete(key);

  sendResponse(activePlayers.get(friendID), {
    type: MessageType.ResponsePrivateTyping,
    friendID: playerID,
    isTyping: false,
  });
}

// ---------- Lobby chat & typing ----------

export function sendLobbyChatMessageHandler(player, msg) {
  const lobby = lobbies.get(msg.lobbyID);
  if (!lobby) {
    console.log('sendLobbyChatMessageHandler: Lobby not found');
    return;
  }

  if (!lobby.players.some((p) => p.id === player.id)) {
    sendErrorToPlayer(player, 'You are not in this lobby');
    return;
  }

  const chatMsg = {
    senderID: player.id,
    senderName: player.name,
    content: msg.content ?? '',
  };
  lobby.chatHistory.push(chatMsg);

  // Broadcast to all players in lobby
  broadcastLobbyChatMessage(lobby, chatMsg);

  stopTyping(player.id, lobby);
}

const typingTimers = new Map(); // playerID -> timeout

export function typingHandler(player, msg) {
  const lobby = lobbies.get(msg.lobbyID);
  if (!lobby) return;

  if (!msg.isTyping) {
    stopTyping(player.id, lobby);
    return;
  }

  broadcastTyping(lobby, player.id, player.name, true);

  clearTimeout(typingTimers.get(player.id));
  // Fallback falls Frontend nicht selbst ein Signal zum Stoppen schickt
  typingTimers.set(
    player.id,
    setTimeout(() => stopTyping(player.id, lobby), 5000)
  );
}

function stopTyping(playerID, lobby) {
  // Only announce "stopped typing" once: the chat message and the client's
  // own stop signal both end up here.
  if (!typingTimers.has(playerID)) return;
  clearTimeout(typingTimers.get(playerID));
  typingTimers.delete(playerID);

  const player = activePlayers.get(playerID);
  if (!player) return;

  broadcastTyping(lobby, playerID, player.name, false);
}

// ---------- Invites ----------

function sendInviteResult(player, success, message) {
  sendResponse(player, { type: MessageType.ResponseInviteSent, success, message });
}

export function inviteToLobbyHandler(player, msg) {
  const lobby = lobbies.get(msg.lobbyID);
  if (!lobby) {
    console.log('inviteToLobbyHandler: Lobby not found');
    return;
  }

  if (isLobbyFull(lobby)) {
    sendInviteResult(player, false, 'Lobby is full');
    return;
  }

  const friend = activePlayers.get(msg.friendID);
  if (!friend) {
    sendInviteResult(player, false, 'Player is not online');
    return;
  }

  if (lobby.players.some((p) => p.id === msg.friendID)) {
    sendInviteResult(player, false, 'Player is already in this lobby');
    return;
  }

  const invites = pendingInvites.get(msg.friendID) ?? [];
  if (invites.includes(lobby.id)) {
    sendInviteResult(player, false, 'Invite already sent');
    return;
  }

  pendingInvites.set(msg.friendID, [...invites, lobby.id]);

  sendInviteResult(player, true, 'Invite sent');

  // Live notification for the invitee
  sendResponse(friend, {
    type: MessageType.ResponseInviteReceived,
    lobbyID: lobby.id,
    lobbyName: lobby.name,
    inviterID: player.id,
    inviterName: player.name,
  });
}

export function declineInviteHandler(player, msg) {
  removePendingInvite(player.id, msg.lobbyID);
  sendResponse(player, { type: MessageType.ResponseInviteDeclined, lobbyID: msg.lobbyID });
}
