import { parentPort } from 'node:worker_threads';

// Worker side of WorkerPool: answers { id, method, args } messages by calling
// the matching function and posting back { id, result } or { id, error }.
export function serveCalls(methods) {
  parentPort.on('message', ({ id, method, args }) => {
    try {
      const fn = methods[method];
      if (!fn) throw new Error(`unknown method ${method}`);
      parentPort.postMessage({ id, result: fn(...args) });
    } catch (err) {
      parentPort.postMessage({ id, error: { name: err.name, message: err.message } });
    }
  });
}
