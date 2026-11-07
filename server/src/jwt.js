import jwt from 'jsonwebtoken';

// Short-lived access token; the refresh token (refreshTokenStore.js) renews it.
// A function, because .env is loaded after the modules are imported.
export function getAccessTokenTTL() {
  return Number(process.env.ACCESS_TOKEN_TTL_SECONDS) || 15 * 60;
}

function getSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is not set (see .env.example)');
  }
  return secret;
}

// sessionID is the refresh token family, so a connection knows which login it belongs to
export function generateJWT(playerID, sessionID) {
  return jwt.sign({ playerID, sessionID }, getSecret(), {
    algorithm: 'HS256',
    expiresIn: getAccessTokenTTL(),
  });
}

// Returns { playerID, sessionID } or throws if the token is invalid/expired
export function parseJWT(token) {
  const claims = jwt.verify(token, getSecret(), { algorithms: ['HS256'] });
  if (typeof claims.playerID !== 'string' || typeof claims.sessionID !== 'string') {
    throw new Error('invalid token claims');
  }
  return { playerID: claims.playerID, sessionID: claims.sessionID };
}
