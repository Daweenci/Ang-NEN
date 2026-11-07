import { parse as parseCookies } from 'cookie';

// The session JWT lives in an HttpOnly cookie: page scripts can't read it, and
// the browser sends it along with every request to this origin, including the
// WebSocket handshake.
export const SESSION_COOKIE = 'session';
const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000; // same lifetime as the JWT

function cookieOptions() {
  return {
    httpOnly: true,
    // Secure cookies need HTTPS, so only require it in production
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
  };
}

export function setSessionCookie(res, token) {
  res.cookie(SESSION_COOKIE, token, { ...cookieOptions(), maxAge: SESSION_MAX_AGE_MS });
}

export function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE, cookieOptions());
}

// Reads the session token from a raw Node request (Express or WebSocket upgrade)
export function getSessionToken(req) {
  const header = req.headers.cookie;
  if (!header) return null;
  return parseCookies(header)[SESSION_COOKIE] ?? null;
}

// Origins that may open a WebSocket connection (checked during the handshake)
export function getAllowedOrigins() {
  return (process.env.ALLOWED_ORIGINS || 'http://localhost:4000,http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}
