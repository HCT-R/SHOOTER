/* Real HTTP + WebSocket + worker authority checks on an ephemeral loopback
   server. No Discord credentials, public deployment, or browser is needed. */
'use strict';
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { WebSocket } = require('ws');
const { createGameServer, VERSION } = require('../server/index.js');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let checks = 0;
function check(value, message) { assert(value, message); checks++; }
async function main() {
  const oauthCalls = [];
  const oauthFetch = async (url, options) => {
    oauthCalls.push({ url, options });
    if (url.endsWith('/oauth2/token')) {
      const code = new URLSearchParams(options.body).get('code');
      if (code === 'limited') return Response.json({ retry_after: 2.5 }, { status: 429 });
      if (code === 'rejected') return Response.json({ error: 'invalid_grant' }, { status: 401 });
      return Response.json({ access_token: code === 'bad-user' ? 'bad-user-token' : 'verified-access-token' });
    }
    if (url.endsWith('/users/@me')) return Response.json({ id: options.headers.Authorization.includes('bad-user') ? 'not-an-id' : '123456789012345678', username: 'verified', global_name: 'Verified Pilot' });
    throw new Error('Unexpected OAuth request: ' + url);
  };
  const game = createGameServer({ workers: 1, capacity: 8, reconnectMs: 650, clientId: 'test-app', clientSecret: 'server-only-secret', oauthFetch });
  await new Promise(resolve => game.server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + game.server.address().port, wsBase = base.replace('http:', 'ws:');
  const peers = [];
  async function session(name = 'TEST') {
    const response = await fetch(base + '/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify({ name }) });
    assert.equal(response.status, 200); return response.json();
  }
  async function connect(auth) {
    auth ||= await session();
    const ws = new WebSocket(wsBase + '/rooms?token=' + encodeURIComponent(auth.token) + '&v=' + VERSION, { origin: base });
    const queued = [], waiting = [];
    const peer = { ws, auth, id: auth.id, queued, send: data => ws.send(JSON.stringify(data.type === 'input' ? { matchId: peer.matchId, ...data } : data)),
      next(type, predicate = () => true, timeout = 3500) {
        const index = queued.findIndex(p => p.type === type && predicate(p));
        if (index >= 0) return Promise.resolve(queued.splice(index, 1)[0]);
        return new Promise((resolve, reject) => {
          const waiter = { type, predicate, resolve, reject };
          waiter.timer = setTimeout(() => { waiting.splice(waiting.indexOf(waiter), 1); reject(new Error('Timed out waiting for ' + type + '; queued=' + queued.map(p => p.type).join(','))); }, timeout);
          waiting.push(waiter);
        });
      },
      async close() { if (ws.readyState >= WebSocket.CLOSING) return; const closed = once(ws, 'close'); ws.close(); await closed; }
    };
    ws.on('message', raw => {
      const packet = JSON.parse(raw.toString()), index = waiting.findIndex(w => w.type === packet.type && w.predicate(packet));
      if (packet.type === 'start') peer.matchId = packet.matchId;
      if (index >= 0) { const waiter = waiting.splice(index, 1)[0]; clearTimeout(waiter.timer); waiter.resolve(packet); }
      else { queued.push(packet); if (queued.length > 500) queued.shift(); }
    });
    ws.on('error', () => {}); peers.push(peer);
    const hello = await peer.next('hello'); check(hello.id === auth.id && hello.version === VERSION, 'session identity and protocol version');
    peer.lastSeq = hello.lastSeq; return peer;
  }
  async function rejectSocket(query, expected, origin = base) {
    await new Promise((resolve, reject) => {
      const ws = new WebSocket(wsBase + '/rooms?' + query, { origin });
      const timer = setTimeout(() => { ws.terminate(); reject(new Error('Upgrade rejection timed out')); }, 2000);
      ws.on('unexpected-response', (_, response) => { clearTimeout(timer); check(response.statusCode === expected, 'upgrade rejects with ' + expected); response.resume(); resolve(); });
      ws.on('open', () => { clearTimeout(timer); ws.close(); reject(new Error('Unexpected accepted upgrade')); }); ws.on('error', () => {});
    });
  }
  async function makeRoom(peer, modeId, capacity = 4) { peer.send({ type: 'create', modeId, name: modeId + '-host', capacity, difficulty: 'normal' }); return peer.next('room', p => p.modeId === modeId && p.phase === 'lobby' && p.hostId === peer.id); }
  async function join(peer, code) { peer.send({ type: 'join', code, name: 'JOINED' }); return peer.next('room', p => p.code === code); }
  async function ready(peer, loadout = 'assault') { peer.send({ type: 'ready', ready: true, loadout }); return peer.next('room', p => p.participants.some(a => a.id === peer.id && a.ready)); }
  async function start(host, members) { await Promise.all(members.map(p => ready(p))); host.send({ type: 'start' }); const packets = await Promise.all(members.map(p => p.next('start'))); return packets[0]; }
  async function inspect(code) { return game.pool.request(code, 'inspect'); }
  try {
    const health = await (await fetch(base + '/health')).json(); check(health.ok && health.version === VERSION && health.capacity === 8, 'health advertises authoritative protocol');
    const foreign = await fetch(base + '/api/session', { method: 'POST', headers: { Origin: 'https://foreign.invalid', 'Content-Type': 'application/json' }, body: '{}' }); check(foreign.status === 403, 'cross-origin session rejected');
    const auth = await session('VERSION'); await rejectSocket('token=bad&v=1', 401); await rejectSocket('token=' + auth.token + '&v=999', 426); await rejectSocket('token=' + auth.token + '&v=1', 401, 'https://foreign.invalid');
    const oauth = data => fetch(base + '/api/auth/discord', { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    check((await oauth({ code: '', discordId: '999' })).status === 400, 'empty code and client identity claim rejected');
    check(oauthCalls.length === 0, 'empty code does not reach OAuth provider');
    const verifiedResponse = await oauth({ code: 'one-time-code', discordId: '999', username: 'SPOOFED' }), verifiedAuth = await verifiedResponse.json();
    check(verifiedResponse.status === 200 && verifiedAuth.token, 'OAuth code exchanges for verified server session');
    check(new URLSearchParams(oauthCalls[0].options.body).get('client_secret') === 'server-only-secret' && new URLSearchParams(oauthCalls[0].options.body).get('code') === 'one-time-code', 'server exchanges code with configured secret');
    const verified = await connect(verifiedAuth); const verifiedRoom = await makeRoom(verified, 'ffa');
    check(verifiedRoom.participants[0].verified && verifiedRoom.participants[0].name === 'Verified Pilot', 'Discord verified identity ignores client-supplied name');
    check(game.sessions.get(verifiedAuth.token).discordId === '123456789012345678', 'verified provider user id is retained server-side');
    verified.send({ type: 'leave' }); await verified.next('left');
    const limited = await oauth({ code: 'limited' }), limitedData = await limited.json(); check(limited.status === 429 && limitedData.retry_after === 2.5, 'OAuth rate limit preserves retry delay');
    check((await oauth({ code: 'rejected' })).status === 401, 'invalid OAuth grant rejected');
    check((await oauth({ code: 'bad-user' })).status === 401, 'unverified provider user identity rejected');

    const host = await connect(), guest = await connect(); const lobby = await makeRoom(host, 'duel', 8);
    check(lobby.capacity === 2, 'duel capacity fixed at two'); await join(guest, lobby.code);
    host.send({ type: 'start' }); await host.next('error'); check(game.rooms.get(lobby.code).phase === 'lobby', 'ready checks gate match start');
    const duelStart = await start(host, [host, guest]); check(duelStart.modeId === 'duel', 'both clients receive same authoritative start');
    const initial = await host.next('snapshot', p => p.snapshot.self?.id === host.id); const remote = await guest.next('snapshot', p => p.snapshot.self?.id === guest.id);
    check(initial.snapshot.version === VERSION && remote.snapshot.version === VERSION, 'worker sends versioned personal snapshots');
    check(initial.snapshot.self.owned && remote.snapshot.self.owned, 'each viewer gets own inventory');
    const seededDuel = new (require('../src/62-combat-core.js').World)({ modeId: 'duel', seed: duelStart.seed });
    check(JSON.stringify(initial.snapshot.self.weaponSlots) === JSON.stringify(seededDuel.duelRoundLoadout(1)), 'network duel uses seed-selected equipment from its first round');
    check(initial.snapshot.roster.every(a => a.x === undefined && a.ammo === undefined), 'public roster has no coordinates or inventories');
    check(initial.snapshot.actors.every(a => a.id === host.id || a.ammo === undefined), 'remote inventory stays private');
    host.send({ type: 'damage', targetId: guest.id, damage: 999999 }); await host.next('error');
    host.send({ type: 'snapshot', snapshot: { result: { winnerIds: [host.id] } } }); await host.next('error');
    host.send({ type: 'pose', x: 900, z: 900 }); await host.next('error');
    const trusted = await inspect(lobby.code); check(!trusted.snapshot.result && trusted.snapshot.actors.every(a => Math.abs(a.x) < 100 && a.hp === 100), 'clients cannot declare damage, poses or winners');
    guest.send({ type: 'leave' }); await guest.next('left');
    const result = await host.next('snapshot', p => !!p.snapshot.result); check(result.snapshot.result.winnerId === host.id, 'duel disconnect is resolved by authority');
    await host.next('room', p => p.phase === 'finished'); await join(guest, lobby.code);
    const rematch = await start(host, [host, guest]); check(rematch.matchId !== duelStart.matchId, 'rematch has fresh match id');
    game.pool.emit('finished', { room: lobby.code, matchId: duelStart.matchId });
    game.pool.emit('snapshots', { room: lobby.code, matchId: duelStart.matchId, snapshots: [{ id: host.id, snapshot: { staleProbe: true } }] });
    game.pool.emit('metrics', { room: lobby.code, matchId: duelStart.matchId, p95: 99999 });
    check(game.rooms.get(lobby.code).phase === 'playing' && game.metrics.get(lobby.code)?.p95 !== 99999, 'stale worker events cannot finish a rematch or replace its metrics');
    host.send({ type: 'input', matchId: duelStart.matchId, input: { seq: 99999, fire: true } });
    host.send({ type: 'input', input: { seq: 1 } });
    await host.next('snapshot', p => p.matchId === rematch.matchId && p.snapshot.self?.inputSeq === 1);
    check(game.sessions.get(host.auth.token).seq === 1, 'commands from previous match do not consume new command sequence');
    check(!host.queued.some(p => p.snapshot?.staleProbe), 'stale snapshots are not forwarded with new match id');
    guest.send({ type: 'leave' }); await guest.next('left'); await host.next('snapshot', p => p.matchId === rematch.matchId && !!p.snapshot.result); await host.next('room', p => p.phase === 'finished');
    host.send({ type: 'return' }); await host.next('ended'); await host.next('room', p => p.phase === 'lobby'); check(!game.pool.rooms.has(lobby.code), 'return disposes old simulation');

    const ffa = await makeRoom(host, 'ffa', 4); await join(guest, ffa.code); const third = await connect(); await join(third, ffa.code);
    const ffaStart = await start(host, [host, guest, third]); const filled = await inspect(ffa.code); check(filled.actors === 4 && filled.snapshot.roster.filter(a => a.bot).length === 1, 'worker fills vacant slots with bots');
    await guest.next('snapshot', p => p.matchId === ffaStart.matchId && p.snapshot.phase === 'active', 5000);
    // Delayed real controls cover authority at common latencies. Exact client
    // prediction and reconciliation are checked separately by coretest.
    let seq = 100;
    for (const latency of [50, 100, 200]) {
      const current = ++seq, begin = Date.now();
      await sleep(latency); guest.send({ type: 'input', input: { seq: current, moveX: .7, moveZ: .2, aimX: 0, aimZ: 0 } });
      const ack = await guest.next('snapshot', p => p.snapshot.self?.inputSeq === current);
      check(Date.now() - begin >= latency && Number.isFinite(ack.snapshot.self.x), latency + ' ms delayed controls acknowledged');
    }
    guest.send({ type: 'input', input: { seq: seq - 1, moveX: -1, fire: true } });
    await sleep(70); const afterReplay = await inspect(ffa.code); check(afterReplay.snapshot.actors.find(a => a.id === guest.id).inputSeq === seq, 'replayed sequence ignored');
    guest.send({ type: 'input', input: { seq: ++seq, moveX: 0, moveZ: 0 } });
    host.send({ type: 'leave' }); await host.next('left');
    const promoted = await guest.next('room', p => p.code === ffa.code && p.hostId === guest.id && p.phase === 'playing');
    check(promoted.hostId === guest.id, 'lobby leadership moves without stopping authority');
    const ongoing = await guest.next('snapshot', p => p.matchId === ffaStart.matchId && p.snapshot.time > 4);
    check(!ongoing.snapshot.result, 'host leaving does not end FFA');

    const reconnectAuth = third.auth; await third.close();
    await guest.next('room', p => p.participants.some(a => a.id === third.id && !a.connected));
    await sleep(100); const reconnected = await connect(reconnectAuth); const resume = await reconnected.next('start');
    check(resume.matchId === ffaStart.matchId && reconnected.id === third.id, 'reconnect retains identity and match');
    const recovered = await reconnected.next('snapshot', p => p.snapshot.self?.id === third.id); check(recovered.snapshot.self, 'reconnect restores personal state');
    for (let i = guest.queued.length - 1; i >= 0; i--) if (guest.queued[i].type === 'room') guest.queued.splice(i, 1);
    await reconnected.close(); await guest.next('room', p => p.code === ffa.code && !p.participants.some(a => a.id === third.id), 2500);
    check(!game.rooms.get(ffa.code).members.has(third.id), 'reconnect expiry removes abandoned member');

    const late = await connect(); await join(late, ffa.code); await late.next('start');
    const lateView = await late.next('snapshot', p => p.snapshot.self?.id === late.id);
    check(lateView.snapshot.self.alive || lateView.snapshot.self.spectator, 'late FFA join enters authority or waits for bot handoff');
    const canceledJoin = await connect(), originalAddRequest = game.pool.request.bind(game.pool);
    let releaseAdd, addedResolve;
    const addGate = new Promise(resolve => { releaseAdd = resolve; }), added = new Promise(resolve => { addedResolve = resolve; });
    game.pool.request = async (code, op, data) => {
      const result = await originalAddRequest(code, op, data);
      if (code === ffa.code && op === 'add' && data.id === canceledJoin.id) { addedResolve(); await addGate; }
      return result;
    };
    try {
      canceledJoin.send({ type: 'join', code: ffa.code }); await added;
      canceledJoin.send({ type: 'leave' }); await canceledJoin.next('left'); releaseAdd(); await sleep(70);
      check(!canceledJoin.queued.some(p => p.type === 'start'), 'canceled join cannot start an old match after leaving');
      check(!(await inspect(ffa.code)).snapshot.roster.some(a => a.id === canceledJoin.id), 'canceled join leaves no ghost actor');
    } finally { releaseAdd(); game.pool.request = originalAddRequest; }
    const brHost = await connect(); const br = await makeRoom(brHost, 'royale', 4); await start(brHost, [brHost]);
    const brLate = await connect(); await join(brLate, br.code); await brLate.next('start'); const spectate = await brLate.next('snapshot', p => !!p.snapshot.self);
    check(spectate.snapshot.self.spectator && !spectate.snapshot.self.alive, 'late royale joins as spectator');
    check(spectate.snapshot.spectating && spectate.snapshot.roster.filter(a => a.alive).length === 4, 'spectator follows living participant without consuming a life');
    await brLate.next('snapshot', p => p.snapshot.phase === 'active', 5000);
    const camera = (await game.pool.request(br.code, 'snapshot', { id: brLate.id })).spectating;
    brLate.send({ type: 'input', input: { seq: 2, spectate: 1 } });
    const changed = await brLate.next('snapshot', p => p.snapshot.self?.inputSeq === 2); check(changed.snapshot.spectating !== camera, 'spectator can cycle target with server input');
    // Delay only the create acknowledgement, after the worker has accepted
    // the request. Departures must still remove the actor during startup.
    const raceHost = await connect(), raceGuest = await connect(), raceLate = await connect();
    const race = await makeRoom(raceHost, 'duel'); await join(raceGuest, race.code);
    await ready(raceHost); await ready(raceGuest);
    const originalRequest = game.pool.request.bind(game.pool);
    let releaseCreate, createdResolve;
    const createGate = new Promise(resolve => { releaseCreate = resolve; });
    const created = new Promise(resolve => { createdResolve = resolve; });
    game.pool.request = async (code, op, data) => {
      const result = await originalRequest(code, op, data);
      if (code === race.code && op === 'create') { createdResolve(); await createGate; }
      return result;
    };
    try {
      raceHost.send({ type: 'start' }); await created;
      check(game.rooms.get(race.code).phase === 'starting', 'room remains starting before worker acknowledgement');
      raceLate.send({ type: 'join', code: race.code }); await raceLate.next('error');
      check(!game.rooms.get(race.code).members.has(raceLate.id), 'join during startup cannot create a member without an actor');
      raceHost.send({ type: 'leave' }); await raceHost.next('left');
      await raceGuest.next('room', p => p.phase === 'finished');
      releaseCreate(); await raceGuest.next('start');
      const departed = await inspect(race.code);
      check(!departed.snapshot.roster.some(a => a.id === raceHost.id), 'startup departure removes actor from worker');
      check(game.rooms.get(race.code).phase === 'finished' && departed.snapshot.result.winnerId === raceGuest.id, 'create completion does not overwrite finished duel after departure');
    } finally { releaseCreate(); game.pool.request = originalRequest; }
    const finalHealth = await (await fetch(base + '/health')).json(); check(finalHealth.simulations.some(m => Number.isFinite(m.p95)), 'worker CPU metrics are exposed');
    console.log('ROOMS_OK', checks, 'checks; authoritative workers, private views, 50/100/200ms controls, reconnect, late joins');
  } finally {
    for (const peer of peers) if (peer.ws.readyState < WebSocket.CLOSING) peer.ws.terminate();
    await new Promise(resolve => game.server.close(resolve)); await game.pool.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
