import { Router } from 'express';
import { MessageType } from './messageTypes.js';
import {
  createPlayer,
  getLoginData,
  updateLastLogin,
  createSession,
  rotateRefreshToken,
  revokeSessionByToken,
} from './database.js';
import { hashPassword, verifyPassword } from './passwords.js';
import { generateJWT } from './jwt.js';
import { setSessionCookies, clearSessionCookies, getRefreshToken } from './session.js';
import { closeSessionConnection } from './util.js';

export const authRouter = Router();

// Express 4 does not catch errors of async handlers: answer them with 500 here
const handle = (fn) => (req, res) =>
  fn(req, res).catch((err) => {
    console.log(`${req.method} ${req.path} failed: ${err.message}`);
    if (!res.headersSent) res.status(500).json({ message: 'Internal server error' });
  });

function readCredentials(req) {
  const { name, password } = req.body ?? {};
  if (typeof name !== 'string' || typeof password !== 'string' || !name || !password) {
    return null;
  }
  return { name, password };
}

// Starts a new session: refresh token family + access token, both as cookies.
// The tokens never appear in a response body.
async function startSession(res, playerID) {
  const { familyID, token: refreshToken } = await createSession(playerID);
  setSessionCookies(res, generateJWT(playerID, familyID), refreshToken);
}

authRouter.post('/login', handle(async (req, res) => {
  const creds = readCredentials(req);
  if (!creds) {
    return res
      .status(400)
      .json({ type: MessageType.ResponseLoginFailed, message: 'Username and password required' });
  }

  // database worker + password worker: the event loop stays free meanwhile
  const login = await getLoginData(creds.name);
  if (!login || !(await verifyPassword(creds.password, login.password_hash))) {
    return res
      .status(401)
      .json({ type: MessageType.ResponseLoginFailed, message: 'Invalid username or password' });
  }

  updateLastLogin(login.id).catch((err) =>
    console.log(`Failed to update last login for player ${login.id}: ${err.message}`)
  );
  await startSession(res, login.id);
  res.status(200).json({ type: MessageType.ResponseLoginSuccessful, message: 'Login successful' });
}));

authRouter.post('/register', handle(async (req, res) => {
  const creds = readCredentials(req);
  if (!creds) {
    return res
      .status(400)
      .json({ type: MessageType.ResponseRegisterFailed, message: 'Username and password required' });
  }

  const passwordHash = await hashPassword(creds.password);
  let playerID;
  try {
    playerID = await createPlayer(creds.name, passwordHash);
  } catch (err) {
    return res.status(400).json({ type: MessageType.ResponseRegisterFailed, message: err.message });
  }

  await startSession(res, playerID);
  res.status(201).json({ type: MessageType.ResponseRegisterSuccessful, message: 'Registration successful' });
}));

// Issues a new access token and rotates the refresh token
authRouter.post('/auth/refresh', handle(async (req, res) => {
  const refreshToken = getRefreshToken(req);
  const result = refreshToken ? await rotateRefreshToken(refreshToken) : { status: 'invalid' };

  if (result.status === 'ok') {
    setSessionCookies(res, generateJWT(result.playerID, result.familyID), result.token);
    return res.status(200).json({ message: 'Session refreshed' });
  }
  if (result.status === 'grace') {
    // A parallel request (other tab) just rotated this token and its response
    // already carries the new cookies; nothing to do here.
    return res.status(200).json({ message: 'Session already refreshed' });
  }
  clearSessionCookies(res);
  res.status(401).json({ message: 'Session expired' });
}));

// Ends the session on the server: revokes the refresh tokens and closes the
// WebSocket connection that belongs to this session
authRouter.post('/auth/logout', handle(async (req, res) => {
  const refreshToken = getRefreshToken(req);
  const sessionID = refreshToken ? await revokeSessionByToken(refreshToken) : null;
  if (sessionID) closeSessionConnection(sessionID);
  clearSessionCookies(res);
  res.status(204).end();
}));
