import { Worker } from 'node:worker_threads';

// Runs the functions of a worker script in a fixed number of worker threads,
// so that slow synchronous work (database, bcrypt) never blocks the event loop
// of the main thread. Every call returns a Promise; calls wait in a queue until
// a worker is free.
export class WorkerPool {
  constructor(scriptURL, size) {
    this.scriptURL = scriptURL;
    this.queue = [];
    this.nextID = 0;
    this.workers = Array.from({ length: size }, () => this.spawn());
  }

  spawn() {
    const entry = { worker: new Worker(this.scriptURL), task: null };
    entry.worker.on('message', ({ id, result, error }) => {
      const task = entry.task;
      if (!task || task.id !== id) return;
      entry.task = null;
      if (error) {
        const err = new Error(error.message);
        err.name = error.name; // e.g. FriendRequestExistsError
        task.reject(err);
      } else {
        task.resolve(result);
      }
      this.dispatch();
    });
    entry.worker.on('error', (err) => {
      console.log(`Worker ${this.scriptURL.pathname} failed: ${err.message}`);
      entry.task?.reject(err);
      entry.task = null;
    });
    entry.worker.on('exit', (code) => {
      if (this.closing) return;
      // Replace a crashed worker so the pool keeps its size
      console.log(`Worker exited with code ${code}, restarting`);
      entry.task?.reject(new Error('worker exited'));
      const index = this.workers.indexOf(entry);
      if (index !== -1) this.workers[index] = this.spawn();
      this.dispatch();
    });
    return entry;
  }

  call(method, ...args) {
    return new Promise((resolve, reject) => {
      this.queue.push({ id: this.nextID++, method, args, resolve, reject });
      this.dispatch();
    });
  }

  dispatch() {
    for (const entry of this.workers) {
      if (entry.task || this.queue.length === 0) continue;
      const task = this.queue.shift();
      entry.task = task;
      entry.worker.postMessage({ id: task.id, method: task.method, args: task.args });
    }
  }

  async close() {
    this.closing = true;
    await Promise.all(this.workers.map((entry) => entry.worker.terminate()));
  }
}
