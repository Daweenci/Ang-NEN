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
  broadcastBotJoined,
  broadcastBotLeft,
  broadcastLobbyChatMessage,
  broadcastToLobbyPlayers,
} from './broadcasting.js';
import {
  getPlayerIdByName,
  getPlayerByID,
} from './playerStore.js';
import {
  areFriends,
  createFriendRequest,
  FriendRequestExistsError,
  getPendingFriendRequests,
  handleFriendRequest,
  getFriendsList,
  removeFriend,
} from './friendsStore.js';
import {
  Bot,
  botArchetypes,
  generateBotName,
  pickBotPersonality,
  randomPersonality,
} from './botPlayer.js';

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
    bots: [],
    gameStart: [],
    chatHistory: [],
    botCreating: false,
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

export function sendFriendRequestHandler(player, msg) {
  const friendID = getPlayerIdByName(msg.friendName ?? '');
  if (!friendID) {
    sendFriendRequestResult(player, false, 'Player not found');
    return;
  }

  if (player.id === friendID) {
    sendFriendRequestResult(player, false, 'You cannot add yourself');
    return;
  }

  if (areFriends(player.id, friendID)) {
    sendFriendRequestResult(player, false, 'You are already friends');
    return;
  }

  try {
    createFriendRequest(player.id, friendID);
  } catch (err) {
    if (err instanceof FriendRequestExistsError) {
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

export function acceptFriendRequestHandler(player, msg) {
  const friendID = msg.friendID;
  const acceptRequest = Boolean(msg.acceptRequest);

  try {
    handleFriendRequest(friendID, player.id, acceptRequest);
  } catch (err) {
    sendErrorToPlayer(player, 'Error handling friend request');
    console.log(`acceptFriendRequestHandler: ${err.message}`);
    return;
  }

  sendResponse(player, {
    type: MessageType.ResponsePendingFriendRequests,
    pendingFriendRequests: getPendingFriendRequests(player.id),
  });
  if (acceptRequest) {
    sendResponse(player, {
      type: MessageType.ResponseFriendsList,
      friendsList: getFriendsWithOnlineStatus(player.id),
    });
  }

  const friend = activePlayers.get(friendID);
  if (!friend) {
    console.log('acceptFriendRequestHandler: Friend not online');
    return;
  }
  sendResponse(friend, {
    type: MessageType.ResponsePendingFriendRequests,
    pendingFriendRequests: getPendingFriendRequests(friendID),
  });

  if (acceptRequest) {
    sendResponse(friend, {
      type: MessageType.ResponseFriendRequestAccepted,
      friend: { id: player.id, name: player.name, isOnline: true },
    });
  }
}

export function removeFriendHandler(player, msg) {
  try {
    removeFriend(player.id, msg.friendID);
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
      friendsList: getFriendsWithOnlineStatus(msg.friendID),
    });
  }
}

export function getFriendsWithOnlineStatus(playerID) {
  return getFriendsList(playerID).map((f) => ({
    id: f.id,
    name: f.name,
    isOnline: activePlayers.has(f.id),
  }));
}

export function pingAllFriendsOnlineStatusHandler(playerID, isOnline) {
  const dbPlayer = getPlayerByID(playerID);
  if (!dbPlayer) {
    console.log('pingAllFriendsOnlineStatusHandler: Player not found');
    return;
  }

  const response = {
    type: MessageType.ResponseFriendOnlineStatus,
    friend: { id: dbPlayer.id, name: dbPlayer.username, isOnline },
  };
  for (const f of getFriendsList(playerID)) {
    sendResponse(activePlayers.get(f.id), response);
  }
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
    isBot: false,
    content: msg.content ?? '',
  };
  lobby.chatHistory.push(chatMsg);

  // Broadcast to all players in lobby
  broadcastLobbyChatMessage(lobby, chatMsg);

  stopTyping(player.id, lobby);

  // Wake the bots one after another in random order
  const bots = [...lobby.bots].sort(() => Math.random() - 0.5);
  bots.forEach((bot, i) => {
    setTimeout(() => bot.wake(), i * 2500); // WOW das hat alles so viel besser gemacht unglaublich
  });
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
  clearTimeout(typingTimers.get(playerID));
  typingTimers.delete(playerID);

  const player = activePlayers.get(playerID);
  if (!player) return;

  broadcastTyping(lobby, playerID, player.name, false);
}

// ---------- Bots ----------

function failBotCreation(lobby, message) {
  lobby.botCreating = false;
  broadcastToLobbyPlayers(lobby, { type: MessageType.ResponseBotCreationFailed, message });
}

// Shared by random and custom bot creation
function addBot(lobby, name, personality) {
  if (isLobbyFull(lobby)) {
    failBotCreation(lobby, 'Lobby is full');
    return null;
  }

  const bot = new Bot(name, personality, lobby);
  lobby.bots.push(bot);
  lobby.botCreating = false;

  broadcastBotJoined(lobby, bot);
  broadcastLobbyUpdate(lobby);
  broadcastLobbies();
  return bot;
}

function beginBotCreation(lobby) {
  if (isLobbyFull(lobby)) {
    broadcastToLobbyPlayers(lobby, { type: MessageType.ResponseBotCreationFailed, message: 'Lobby is full' });
    return false;
  }
  if (lobby.botCreating) {
    broadcastToLobbyPlayers(lobby, {
      type: MessageType.ResponseBotCreationFailed,
      message: 'A bot is already being created',
    });
    return false;
  }

  lobby.botCreating = true;
  broadcastToLobbyPlayers(lobby, { type: MessageType.ResponseBotCreating });
  return true;
}

export function addBotToLobbyHandler(player, msg) {
  const lobby = lobbies.get(msg.lobbyID);
  if (!lobby) {
    console.log('addBotToLobbyHandler: Lobby not found');
    return;
  }
  if (!beginBotCreation(lobby)) return;

  const { name, archetype } = pickBotPersonality(lobby);
  const bot = addBot(lobby, name, randomPersonality(archetype.id));
  if (bot) {
    console.log(`Random bot created: ${bot.name} (${archetype.displayName})`);
  }
}

export function createCustomBotHandler(player, msg) {
  const lobby = lobbies.get(msg.lobbyId);
  if (!lobby) {
    console.log('createCustomBotHandler: Lobby not found');
    return;
  }
  if (!beginBotCreation(lobby)) return;

  const archetype = botArchetypes.find((a) => a.id === msg.archetypeId);
  if (!archetype) {
    failBotCreation(lobby, 'Invalid archetype');
    return;
  }

  const personality = {
    archetypeID: archetype.id,
    energyLevel: msg.energy,
    tiltLevel: msg.tilt,
    chaosLevel: msg.chaos,
    humorLevel: msg.humor,
    usesEmojis: Boolean(msg.usesEmojis),
    usesGamingSlang: Boolean(msg.usesGamingSlang),
    usesMemes: Boolean(msg.usesMemes),
    asksQuestions: Boolean(msg.asksQuestions),
  };

  const bot = addBot(lobby, generateBotName(), personality);
  if (bot) {
    console.log(`Custom bot created: ${bot.name} (${archetype.displayName})`);
  }
}

export function removeBotFromLobbyHandler(player, msg) {
  const lobby = lobbies.get(msg.lobbyID);
  if (!lobby) {
    console.log('removeBotFromLobbyHandler: Lobby not found');
    return;
  }

  const bot = lobby.bots.find((b) => b.id === msg.botID);
  if (!bot) {
    console.log('removeBotFromLobbyHandler: Bot not found');
    return;
  }

  bot.stop();
  lobby.bots = lobby.bots.filter((b) => b.id !== bot.id);

  broadcastBotLeft(lobby, bot.id, bot.name);
  broadcastLobbyUpdate(lobby);
  broadcastLobbies();
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
