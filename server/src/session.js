import { parse as parseCookies } from 'cookie';
import { getAccessTokenTTL } from './jwt.js';

// Both tokens live in HttpOnly cookies: page scripts can't read them.
//  - access token (JWT, 15 min): sent with every request, including the
//    WebSocket handshake
//  - refresh token (random, 14 days, sliding): only sent to /auth/*
export const ACCESS_COOKIE = 'session';
export const REFRESH_COOKIE = 'refresh';
const REFRESH_COOKIE_PATH = '/auth';
export const REFRESH_TOKEN_TTL_DAYS = 14;

function baseOptions() {
  return {
    httpOnly: true,
    // Secure cookies need HTTPS, so only require it in production
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
  };
}

export function setSessionCookies(res, accessToken, refreshToken) {
  res.cookie(ACCESS_COOKIE, accessToken, {
    ...baseOptions(),
    path: '/',
    maxAge: getAccessTokenTTL() * 1000,
  });
  res.cookie(REFRESH_COOKIE, refreshToken, {
    ...baseOptions(),
    path: REFRESH_COOKIE_PATH,
    maxAge: REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
  });
}

export function clearSessionCookies(res) {
  res.clearCookie(ACCESS_COOKIE, { ...baseOptions(), path: '/' });
  res.clearCookie(REFRESH_COOKIE, { ...baseOptions(), path: REFRESH_COOKIE_PATH });
}

function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  return parseCookies(header)[name] ?? null;
}

// Work on raw Node requests, so they also work for the WebSocket upgrade
export const getAccessToken = (req) => readCookie(req, ACCESS_COOKIE);
export const getRefreshToken = (req) => readCookie(req, REFRESH_COOKIE);

// Origins that may open a WebSocket connection (checked during the handshake)
export function getAllowedOrigins() {
  return (process.env.ALLOWED_ORIGINS || 'http://localhost:4000,http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}
