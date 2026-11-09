// bcrypt is deliberately slow (about 70 ms per call at cost 10). Hashing in a
// worker thread keeps the event loop free for WebSocket messages meanwhile.
import bcrypt from 'bcryptjs';
import { serveCalls } from './serveCalls.js';

const BCRYPT_COST = 10;

serveCalls({
  hash: (password) => bcrypt.hashSync(password, BCRYPT_COST),
  compare: (password, hash) => bcrypt.compareSync(password, hash),
});
