import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDB, closeDB } from './db.js';
import { authRouter } from './auth.js';
import { attachWebSocketServer } from './websocket.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_DIST = path.resolve(__dirname, '../../client/dist');

initDB();

const app = express();
app.use(cors()); // allow all origins, like the Go version
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
  console.log(`Server started on :${port} with CORS enabled`);
});

function shutdown() {
  console.log('Shutting down ...');
  closeDB();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
