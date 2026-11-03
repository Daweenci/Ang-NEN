import jwt from 'jsonwebtoken';

function getSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is not set (see .env.example)');
  }
  return secret;
}

export function generateJWT(playerID) {
  return jwt.sign({ playerID }, getSecret(), { algorithm: 'HS256', expiresIn: '24h' });
}

// Returns the playerID or throws if the token is invalid/expired
export function parseJWT(token) {
  const claims = jwt.verify(token, getSecret(), { algorithms: ['HS256'] });
  if (typeof claims.playerID !== 'string') {
    throw new Error('invalid token claims');
  }
  return claims.playerID;
}
