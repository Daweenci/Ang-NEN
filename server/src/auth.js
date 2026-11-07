import { Router } from 'express';
import { MessageType } from './messageTypes.js';
import { createPlayer, verifyPlayerCredentials } from './playerStore.js';
import { generateJWT } from './jwt.js';
import { setSessionCookie, clearSessionCookie } from './session.js';

export const authRouter = Router();

function readCredentials(req) {
  const { name, password } = req.body ?? {};
  if (typeof name !== 'string' || typeof password !== 'string' || !name || !password) {
    return null;
  }
  return { name, password };
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

  let token;
  try {
    token = generateJWT(playerID);
  } catch {
    return res.status(500).json({ type: MessageType.ResponseLoginFailed, message: 'Failed to generate token' });
  }

  // The token goes into an HttpOnly cookie only, never into the response body
  setSessionCookie(res, token);
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

  let token;
  try {
    token = generateJWT(playerID);
  } catch {
    return res
      .status(500)
      .json({ type: MessageType.ResponseRegisterFailed, message: 'Failed to generate token' });
  }

  setSessionCookie(res, token);
  res.status(201).json({ type: MessageType.ResponseRegisterSuccessful, message: 'Registration successful' });
});

authRouter.post('/logout', (req, res) => {
  clearSessionCookie(res);
  res.status(204).end();
});
