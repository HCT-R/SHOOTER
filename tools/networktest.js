/* The browser room client against a real loopback server, without a browser:
   invite links, a session token left over from a restarted server, and the
   live-server duel check. Run: node tools/networktest.js */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { WebSocket } = require('ws');
const { createGameServer } = require('../server/index.js');
const { checkServer } = require('./duelcheck.js');
const CombatCore = require('../src/62-combat-core.js');

const noop = () => {};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let checks = 0;
function check(value, message) { assert(value, message); checks++; }
async function until(read, message, timeout = 4000) {
  for (const end = Date.now() + timeout; Date.now() < end; await sleep(20)) { const value = read(); if (value) return value; }
  throw new Error('Timed out: ' + message);
}

// One page: 96-network.js with just enough of window/document around it.
function page(base, search = '') {
  const storage = new Map(), element = () => ({ value: '', hidden: false, classList: { add: noop, remove: noop } });
  class PageSocket extends WebSocket { constructor(url) { super(url, { origin: base }); } }
  const context = vm.createContext({
    console, URL, URLSearchParams, setTimeout, clearTimeout, setInterval, clearInterval, performance,
    location: { href: base + '/' + search, protocol: 'http:', search },
    window: { addEventListener: noop },
    document: { hidden: false, addEventListener: noop, body: { classList: { add: noop, remove: noop } }, getElementById: element },
    sessionStorage: { getItem: key => storage.has(key) ? storage.get(key) : null, setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key) },
    fetch: (url, options = {}) => fetch(new URL(url, base), { ...options, headers: { ...options.headers, Origin: base } }),
    WebSocket: PageSocket, CombatCore, ST_MENU: 'menu', loadLook: () => ({ nickname: 'TESTER' }), sfx: new Proxy({}, { get: () => noop })
  });
  const source = fs.readFileSync(path.join(__dirname, '../src/96-network.js'), 'utf8');
  const api = vm.runInContext(source + '\n;({ RoomClient, inviteCode, inviteLink })', context);
  const game = { input: { clear: noop }, leaveArena: noop };
  return { ...api, storage, client: () => new api.RoomClient(game, noop) };
}

async function main() {
  const { inviteCode, inviteLink } = page('http://127.0.0.1:1');
  check(inviteCode('?room=ab12cd34') === 'AB12CD34' && inviteCode('?x=1&room=%20AB12CD34%20') === 'AB12CD34', 'invite code is read and normalised');
  check(['', '?room=', '?room=../../x', '?room=AB<script>', '?room=ABCDEFGHIJKLMN'].every(search => inviteCode(search) === ''), 'malformed or missing invite codes are ignored');
  check(inviteLink('AB12CD34', 'https://game.example.com/?frame_id=1&room=OLD#lobby') === 'https://game.example.com/?room=AB12CD34', 'invite link keeps origin and path, drops other parameters');

  const game = createGameServer({ workers: 1, capacity: 8 });
  await new Promise(resolve => game.server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + game.server.address().port, clients = [];
  try {
    // After a redeploy the tab still holds a token the new process never issued.
    const fresh = page(base);
    fresh.storage.set('pixel-room-token', 'issued-by-the-previous-server');
    const host = fresh.client(); clients.push(host);
    await host.create('duel');
    const room = await until(() => host.room, 'room after a stale token: ' + host.message);
    check(room.modeId === 'duel' && room.participants.length === 1 && room.participants[0].id === host.id, 'stale token outside a room is replaced and the room is created');
    const token = fresh.storage.get('pixel-room-token');
    check(token !== 'issued-by-the-previous-server' && game.sessions.get(token)?.id === host.id, 'the fresh session token is stored for reloads');
    check(host.invite === base + '/?room=' + room.code, 'room invite link points at this server');

    // The friend opens the invite link and joins with the code from it.
    const invited = page(base, '?room=' + room.code.toLowerCase()), friend = invited.client(); clients.push(friend);
    await friend.join(invited.inviteCode('?room=' + room.code.toLowerCase()));
    check(await until(() => host.room?.participants.length === 2 && friend.room?.code === room.code, 'friend in the room'), 'invite code joins the friend to the room');

    // During recovery inside a room the token is what resumes the player: keep it.
    const resuming = page(base); resuming.storage.set('pixel-room-token', 'mid-match-token');
    const stranded = resuming.client(); clients.push(stranded);
    stranded.room = { code: room.code, participants: [] };
    await assert.rejects(stranded.connect());
    stranded.leave(); // stops the 30-second recovery loop the failed socket started
    check(resuming.storage.get('pixel-room-token') === 'mid-match-token', 'token is kept while a room is being recovered');
    check(game.sessions.size === 2, 'recovery does not create sessions');

    const result = await checkServer(base, { seconds: 1 });
    check(result.rtt >= 0 && result.rates.every(rate => rate >= 10), 'duel check passes against the server');
    check(await until(() => !game.rooms.has(result.code), 'duel check room removed'), 'duel check leaves no room behind');
  } finally {
    for (const client of clients) { client.leave(); clearInterval(client.backgroundTimer); }
    for (const ws of game.wss.clients) ws.terminate();
    await new Promise(resolve => game.server.close(resolve)); await game.pool.close();
  }
  console.log('NETWORK_OK', checks, 'checks; invite links, stale session recovery, live duel check');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
