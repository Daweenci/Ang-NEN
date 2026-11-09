// Owns the SQLite connection. better-sqlite3 only offers synchronous calls;
// running them here keeps the main thread free. A single worker processes the
// calls one after another, so transactions never overlap.
import { initDB, closeDB } from '../db.js';
import * as players from '../playerStore.js';
import * as friends from '../friendsStore.js';
import * as refreshTokens from '../refreshTokenStore.js';
import { serveCalls } from './serveCalls.js';

initDB();

serveCalls({
  ping: () => true,
  closeDB,
  createPlayer: players.createPlayer,
  getLoginData: players.getLoginData,
  updateLastLogin: players.updateLastLogin,
  getPlayerByID: players.getPlayerByID,
  getPlayerIdByName: players.getPlayerIdByName,
  areFriends: friends.areFriends,
  createFriendRequest: friends.createFriendRequest,
  getPendingFriendRequests: friends.getPendingFriendRequests,
  handleFriendRequest: friends.handleFriendRequest,
  getFriendsList: friends.getFriendsList,
  removeFriend: friends.removeFriend,
  createPrivateMessage: friends.createPrivateMessage,
  getPrivateMessages: friends.getPrivateMessages,
  createSession: refreshTokens.createSession,
  rotateRefreshToken: refreshTokens.rotateRefreshToken,
  revokeSessionByToken: refreshTokens.revokeSessionByToken,
  deleteExpiredRefreshTokens: refreshTokens.deleteExpiredRefreshTokens,
});
