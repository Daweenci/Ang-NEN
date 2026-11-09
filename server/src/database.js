import { WorkerPool } from './workers/workerPool.js';

// Asynchronous access to the database. Every call is executed in the database
// worker (workers/dbWorker.js) and returns a Promise.
let pool = null;

export async function initDatabase() {
  pool = new WorkerPool(new URL('./workers/dbWorker.js', import.meta.url), 1);
  await pool.call('ping'); // resolves once the schema is loaded
}

export async function closeDatabase() {
  if (!pool) return;
  await pool.call('closeDB');
  await pool.close();
  pool = null;
}

const call = (method) => (...args) => pool.call(method, ...args);

// players
export const createPlayer = call('createPlayer');
export const getLoginData = call('getLoginData');
export const updateLastLogin = call('updateLastLogin');
export const getPlayerByID = call('getPlayerByID');
export const getPlayerIdByName = call('getPlayerIdByName');

// friends and private messages
export const areFriends = call('areFriends');
export const createFriendRequest = call('createFriendRequest');
export const getPendingFriendRequests = call('getPendingFriendRequests');
export const handleFriendRequest = call('handleFriendRequest');
export const getFriendsList = call('getFriendsList');
export const removeFriend = call('removeFriend');
export const createPrivateMessage = call('createPrivateMessage');
export const getPrivateMessages = call('getPrivateMessages');

// sessions (refresh tokens)
export const createSession = call('createSession');
export const rotateRefreshToken = call('rotateRefreshToken');
export const revokeSessionByToken = call('revokeSessionByToken');
export const deleteExpiredRefreshTokens = call('deleteExpiredRefreshTokens');
