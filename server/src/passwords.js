import os from 'node:os';
import { WorkerPool } from './workers/workerPool.js';

// bcrypt runs in a small pool of worker threads (one per spare CPU core, at most 4)
let pool = null;

function getPool() {
  if (!pool) {
    const size = Math.max(1, Math.min(4, os.availableParallelism() - 1));
    pool = new WorkerPool(new URL('./workers/passwordWorker.js', import.meta.url), size);
  }
  return pool;
}

export const hashPassword = (password) => getPool().call('hash', password);
export const verifyPassword = (password, hash) => getPool().call('compare', password, hash);

export async function closePasswordWorkers() {
  if (pool) await pool.close();
  pool = null;
}
