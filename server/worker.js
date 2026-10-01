'use strict';
const { parentPort } = require('node:worker_threads');
const { performance } = require('node:perf_hooks');
const Core = require('../src/62-combat-core.js');
const rooms = new Map();
parentPort.on('message', ({ id, room, op, data = {} }) => {
  try {
    let entry = rooms.get(room), result = true;
    if (op === 'create') {
      const world = new Core.World({ ...data, botCount: 0 });
      entry = { world, matchId: data.matchId || null, humans: new Set(), accumulator: 0, snapshots: 0, samples: [], steps: 0, lastReport: 0, finished: false };
      for (const player of data.players || []) { world.addPlayer({ ...player, loadout: data.modeId === 'duel' ? undefined : player.loadout }); entry.humans.add(player.id); }
      for (let i = 0; i < Math.max(0, data.capacity - entry.humans.size); i++) world.addPlayer({ id: 'bot-' + i, name: ['VEX', 'KIRA', 'ECHO', 'ION', 'ONYX', 'NOVA'][i % 6] + '-' + (i + 1), bot: true });
      world.start(); rooms.set(room, entry);
    } else if (op === 'destroy') rooms.delete(room);
    else if (!entry) throw new Error('Room is not running');
    else if (op === 'add') { result = entry.world.addPlayer(data); if (!result) throw new Error('Room capacity reached'); entry.humans.add(data.id); result = true; }
    else if (op === 'remove') { entry.world.removePlayer(data.id); entry.humans.delete(data.id); }
    else if (op === 'input') result = entry.world.setInput(data.id, data.input);
    else if (op === 'snapshot') result = entry.world.snapshot(data.id);
    else if (op === 'inspect') result = { rooms: rooms.size, actors: entry.world.members.size, steps: entry.steps, snapshot: entry.world.snapshot(null) };
    if (id) parentPort.postMessage({ reply: id, data: result === undefined ? true : result });
  } catch (error) { if (id) parentPort.postMessage({ reply: id, error: error.message }); }
});
let last = performance.now();
setInterval(() => {
  const now = performance.now(), elapsed = Math.min(.25, (now - last) / 1000); last = now;
  for (const [room, entry] of rooms) {
    entry.accumulator += elapsed;
    while (entry.accumulator + 1e-9 >= 1 / 60) {
      entry.accumulator -= 1 / 60;
      const start = performance.now(); entry.world.step(1 / 60);
      entry.samples.push(performance.now() - start); if (entry.samples.length > 3600) entry.samples.shift(); entry.steps++;
      if (++entry.snapshots % 3 === 0) {
        const snapshots = []; for (const id of entry.humans) snapshots.push({ id, snapshot: entry.world.snapshot(id) });
        parentPort.postMessage({ type: 'snapshots', room, matchId: entry.matchId, snapshots });
        if (entry.world.phase === 'finished' && !entry.finished) { entry.finished = true; parentPort.postMessage({ type: 'finished', room, matchId: entry.matchId }); }
      }
    }
    if (now - entry.lastReport > 5000) { entry.lastReport = now; const sorted = entry.samples.slice().sort((a, b) => a - b); parentPort.postMessage({ type: 'metrics', room, matchId: entry.matchId, steps: entry.steps, p95: sorted[Math.floor(sorted.length * .95)] || 0, actors: entry.world.members.size }); }
  }
}, 4);
