'use strict';
const { Worker } = require('node:worker_threads');
const { availableParallelism } = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
class SimulationPool extends EventEmitter {
  constructor(count = Math.min(4, Math.max(1, availableParallelism() - 1))) {
    super(); this.rooms = new Map(); this.pending = new Map(); this.serial = 0; this.closed = false;
    this.workers = Array.from({ length: Math.max(1, count) }, () => {
      const worker = new Worker(path.join(__dirname, 'worker.js')), entry = { worker, rooms: new Set() };
      worker.on('message', message => {
        if (message.reply) {
          const p = this.pending.get(message.reply); if (!p) return;
          clearTimeout(p.timer); this.pending.delete(message.reply);
          if (message.error) p.reject(new Error(message.error)); else p.resolve(message.data);
        } else this.emit(message.type, message);
      });
      worker.on('error', error => {
        for (const room of entry.rooms) this.emit('failure', { room, message: 'Симуляция остановлена. Вернитесь в лобби.' });
        for (const [id, p] of this.pending) if (p.entry === entry) { clearTimeout(p.timer); p.reject(error); this.pending.delete(id); }
      });
      return entry;
    });
  }
  request(room, op, data = {}) {
    let entry = this.rooms.get(room);
    if (!entry && op === 'create') { entry = this.workers.reduce((best, w) => w.rooms.size < best.rooms.size ? w : best); this.rooms.set(room, entry); entry.rooms.add(room); }
    if (!entry) return Promise.reject(new Error('Simulation room not found'));
    const id = ++this.serial;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Simulation timeout')); }, 10000);
      this.pending.set(id, { resolve, reject, timer, entry }); entry.worker.postMessage({ id, room, op, data });
    });
  }
  send(room, op, data) { this.rooms.get(room)?.worker.postMessage({ room, op, data }); }
  destroy(room) { const e = this.rooms.get(room); if (!e) return; e.worker.postMessage({ room, op: 'destroy' }); e.rooms.delete(room); this.rooms.delete(room); }
  async close() {
    if (this.closed) return; this.closed = true;
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('Server closed')); }
    this.pending.clear(); this.rooms.clear(); await Promise.all(this.workers.map(e => e.worker.terminate()));
  }
}
module.exports = { SimulationPool };
