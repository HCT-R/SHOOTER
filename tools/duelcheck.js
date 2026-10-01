/* Two guest players run a short duel against a live server: TLS, the reverse
   proxy, the WebSocket upgrade, the origin check and the simulation in one
   pass. Run: npm run check:server -- https://game.example.com */
'use strict';
const { WebSocket } = require('ws');
const { VERSION } = require('../server/index.js');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function guest(base, name) {
  const response = await fetch(base + '/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base },
    body: JSON.stringify({ name }), signal: AbortSignal.timeout(10000) });
  const auth = await response.json().catch(() => ({}));
  if (!response.ok || !auth.token) throw new Error('гостевая сессия отклонена: ' + (auth.error || 'HTTP ' + response.status));
  const url = new URL('/rooms', base); url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('token', auth.token); url.searchParams.set('v', VERSION);
  const ws = new WebSocket(url, { origin: base, handshakeTimeout: 10000 }), queued = [], waiting = [];
  const peer = { ws, matchId: null, latest: null, snapshots: 0, failure: null,
    send: packet => ws.send(JSON.stringify(packet)),
    // Snapshots are counted rather than queued; a waiter can still ask for one.
    next(type, test = () => true, timeout = 10000) {
      if (peer.failure) return Promise.reject(peer.failure);
      const index = queued.findIndex(p => p.type === type && test(p));
      if (index >= 0) return Promise.resolve(queued.splice(index, 1)[0]);
      return new Promise((resolve, reject) => {
        const waiter = { type, test, resolve, reject };
        waiter.timer = setTimeout(() => { waiting.splice(waiting.indexOf(waiter), 1); reject(new Error(name + ': сервер не прислал «' + type + '» за ' + timeout / 1000 + ' с')); }, timeout);
        waiting.push(waiter);
      });
    } };
  const failAll = error => { peer.failure ||= error; for (const w of waiting.splice(0)) { clearTimeout(w.timer); w.reject(peer.failure); } };
  ws.on('message', raw => {
    let packet; try { packet = JSON.parse(raw); } catch (_) { return; }
    if (packet.type === 'error') return failAll(new Error(name + ': ' + packet.message));
    if (packet.type === 'start') peer.matchId = packet.matchId;
    if (packet.type === 'snapshot') { if (packet.matchId !== peer.matchId) return; peer.snapshots++; peer.latest = packet.snapshot; }
    const index = waiting.findIndex(w => w.type === packet.type && w.test(packet));
    if (index >= 0) { const w = waiting.splice(index, 1)[0]; clearTimeout(w.timer); w.resolve(packet); }
    else if (packet.type !== 'snapshot') { queued.push(packet); if (queued.length > 100) queued.shift(); }
  });
  ws.on('close', () => failAll(new Error(name + ': сервер закрыл соединение')));
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.on('error', error => reject(new Error(name + ': WebSocket — ' + error.message))); });
  await peer.next('hello');
  return peer;
}

async function checkServer(target, { seconds = 2 } = {}) {
  const base = new URL(target).origin;
  let health;
  try {
    const response = await fetch(base + '/health', { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    health = await response.json();
  } catch (e) { throw new Error(base + ' не отвечает: ' + (e.cause?.code || e.cause?.message || e.message)); }
  if (health.version !== VERSION) throw new Error('на сервере протокол ' + health.version + ', в этой копии ' + VERSION + '. Задеплойте текущую версию');
  const peers = [];
  try {
    const host = await guest(base, 'CHECK-A'); peers.push(host);
    const friend = await guest(base, 'CHECK-B'); peers.push(friend);
    host.send({ type: 'create', modeId: 'duel', name: 'CHECK-A' });
    const { code } = await host.next('room');
    friend.send({ type: 'join', code, name: 'CHECK-B' });
    await host.next('room', r => r.participants.length === 2);
    for (const p of peers) p.send({ type: 'ready', ready: true });
    await host.next('room', r => r.participants.length === 2 && r.participants.every(p => p.ready));
    host.send({ type: 'start' });
    await Promise.all(peers.map(p => p.next('start')));
    // a command has to come back acknowledged in the personal snapshot
    friend.send({ type: 'input', matchId: friend.matchId, input: { seq: 1, moveX: 1 } });
    if (!(friend.latest?.self?.inputSeq >= 1)) await friend.next('snapshot', p => p.snapshot.self?.inputSeq >= 1);
    const rtt = [];
    for (let i = 0; i < 5; i++) { const sent = performance.now(); host.send({ type: 'ping', sent }); await host.next('pong', p => p.sent === sent); rtt.push(performance.now() - sent); }
    const counted = peers.map(p => p.snapshots); await sleep(seconds * 1000);
    const rates = peers.map((p, i) => (p.snapshots - counted[i]) / seconds);
    if (rates.some(rate => rate < 10)) throw new Error('снимки приходят слишком редко: ' + rates.map(Math.round).join(' и ') + ' в секунду, ожидается 20');
    return { base, code, rtt: rtt.sort((a, b) => a - b)[2], rates };
  } finally {
    for (const p of peers) { if (p.ws.readyState === WebSocket.OPEN) p.send({ type: 'leave' }); p.ws.close(); }
  }
}

if (require.main === module) {
  const target = process.argv[2];
  if (!target) { console.error('Использование: npm run check:server -- https://game.example.com'); process.exit(2); }
  checkServer(target).then(result => {
    console.log('✓ ' + result.base + ' · дуэль 1×1: вход по коду, старт, снимки и команды');
    console.log('  задержка ' + Math.round(result.rtt) + ' мс · снимки ' + result.rates.map(Math.round).join(' и ') + ' в секунду');
    process.exit(0);
  }, error => { console.error('✗ ' + error.message); process.exit(1); });
}
module.exports = { checkServer };
