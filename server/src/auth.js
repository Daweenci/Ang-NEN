import { Router } from 'express';
import { MessageType } from './messageTypes.js';
import { createPlayer, verifyPlayerCredentials } from './playerStore.js';
import { generateJWT } from './jwt.js';
import { createSession, rotateRefreshToken, revokeSessionByToken } from './refreshTokenStore.js';
import { setSessionCookies, clearSessionCookies, getRefreshToken } from './session.js';
import { closeSessionConnection } from './util.js';

export const authRouter = Router();

function readCredentials(req) {
  const { name, password } = req.body ?? {};
  if (typeof name !== 'string' || typeof password !== 'string' || !name || !password) {
    return null;
  }
  return { name, password };
}

// Starts a new session: refresh token family + access token, both as cookies.
// The tokens never appear in a response body.
function startSession(res, playerID) {
  const { familyID, token: refreshToken } = createSession(playerID);
  setSessionCookies(res, generateJWT(playerID, familyID), refreshToken);
}

authRouter.post('/login', (req, res) => {
  const creds = readCredentials(req);
  if (!creds) {
    return res
      .status(400)
      .json({ type: MessageType.ResponseLoginFailed, message: 'Username and password required' });
  }

  const playerID = verifyPlayerCredentials(creds.name, creds.password);
  if (!playerID) {
    return res
      .status(401)
      .json({ type: MessageType.ResponseLoginFailed, message: 'Invalid username or password' });
  }

  try {
    startSession(res, playerID);
  } catch (err) {
    console.log(`Login failed for player ${playerID}: ${err.message}`);
    return res.status(500).json({ type: MessageType.ResponseLoginFailed, message: 'Failed to start session' });
  }
  res.status(200).json({ type: MessageType.ResponseLoginSuccessful, message: 'Login successful' });
});

authRouter.post('/register', (req, res) => {
  const creds = readCredentials(req);
  if (!creds) {
    return res
      .status(400)
      .json({ type: MessageType.ResponseRegisterFailed, message: 'Username and password required' });
  }

  let playerID;
  try {
    playerID = createPlayer(creds.name, creds.password);
  } catch (err) {
    return res.status(400).json({ type: MessageType.ResponseRegisterFailed, message: err.message });
  }

  try {
    startSession(res, playerID);
  } catch (err) {
    console.log(`Registration session failed for player ${playerID}: ${err.message}`);
    return res
      .status(500)
      .json({ type: MessageType.ResponseRegisterFailed, message: 'Failed to start session' });
  }
  res.status(201).json({ type: MessageType.ResponseRegisterSuccessful, message: 'Registration successful' });
});

// Issues a new access token and rotates the refresh token
authRouter.post('/auth/refresh', (req, res) => {
  const refreshToken = getRefreshToken(req);
  const result = refreshToken ? rotateRefreshToken(refreshToken) : { status: 'invalid' };

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
});

// Ends the session on the server: revokes the refresh tokens and closes the
// WebSocket connection that belongs to this session
authRouter.post('/auth/logout', (req, res) => {
  const refreshToken = getRefreshToken(req);
  const sessionID = refreshToken ? revokeSessionByToken(refreshToken) : null;
  if (sessionID) closeSessionConnection(sessionID);
  clearSessionCookies(res);
  res.status(204).end();
});
