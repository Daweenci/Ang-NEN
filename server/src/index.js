import dotenv from 'dotenv';
import express from 'express';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDB, closeDB } from './db.js';
import { authRouter } from './auth.js';
import { attachWebSocketServer } from './websocket.js';
import { deleteExpiredRefreshTokens } from './refreshTokenStore.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// server/.env (never committed, see .env.example)
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const CLIENT_DIST = path.resolve(__dirname, '../../client/dist');

initDB();

// Expired refresh tokens are of no use anymore; remove them now and hourly
function cleanUpRefreshTokens() {
  const removed = deleteExpiredRefreshTokens();
  if (removed) console.log(`Removed ${removed} expired refresh tokens`);
}
cleanUpRefreshTokens();
setInterval(cleanUpRefreshTokens, 60 * 60 * 1000).unref();

const app = express();
// No CORS: client and API share one origin (in development via the Vite proxy),
// which is also what lets the session cookie stay SameSite=Strict.
app.use(express.json());

app.use(authRouter);

// Serve the built React app (after `npm run build` in client/)
if (fs.existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST));
  app.get('*', (req, res) => res.sendFile(path.join(CLIENT_DIST, 'index.html')));
}

// Invalid JSON body etc.
app.use((err, req, res, next) => {
  res.status(400).json({ message: 'Invalid request' });
});

const server = http.createServer(app);
attachWebSocketServer(server);

const port = process.env.PORT || 4000;
server.listen(port, () => {
  console.log(`Server started on :${port}`);
});

function shutdown() {
  console.log('Shutting down ...');
  closeDB();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
