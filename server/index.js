'use strict';
const http = require('node:http'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { WebSocketServer, WebSocket } = require('ws');
const { SimulationPool } = require('./pool');
const VERSION = 1, MODES = new Set(['duel', 'ffa', 'royale']);
const safeName = value => String(value || 'NOMAD').replace(/[^\p{L}\p{N} _.-]/gu, '').slice(0, 18) || 'NOMAD';
const finite = (value, lo, hi) => Number.isFinite(value) ? Math.min(hi, Math.max(lo, value)) : 0;
function controls(v = {}) {
  if (!v || typeof v !== 'object') v = {};
  return { seq: Number.isSafeInteger(v.seq) && v.seq >= 0 ? v.seq : -1, moveX: finite(v.moveX, -1, 1), moveZ: finite(v.moveZ, -1, 1), aimX: finite(v.aimX, -500, 500), aimZ: finite(v.aimZ, -500, 500),
    fire: v.fire === true, altFire: v.altFire === true, reload: v.reload === true, dash: v.dash === true, sprint: v.sprint === true, aim: v.aim === true, slot: Number.isInteger(v.slot) ? Math.max(-1, Math.min(4, v.slot)) : -1,
    interact: v.interact === true, heal: v.heal === true, spectate: v.spectate === -1 ? -1 : v.spectate === 1 ? 1 : 0,
    loadout: typeof v.loadout === 'string' && v.loadout.length < 48 ? v.loadout : undefined };
}
function createGameServer(options = {}) {
  const root = path.resolve(__dirname, '..'), capacity = Math.max(2, Math.min(128, Number(options.capacity || process.env.ROOM_CAPACITY) || 32));
  const maxRooms = Math.max(1, Number(options.maxRooms || process.env.MAX_ROOMS) || 100), reconnectMs = options.reconnectMs ?? 30000;
  const clientId = options.clientId || process.env.DISCORD_CLIENT_ID || '', clientSecret = options.clientSecret || process.env.DISCORD_CLIENT_SECRET || '';
  const oauthFetch = options.oauthFetch || fetch;
  const rooms = new Map(), sessions = new Map(), metrics = new Map(), pool = new SimulationPool(options.workers);
  const send = (ws, packet) => { if (ws?.readyState === WebSocket.OPEN && ws.bufferedAmount < 1024 * 1024) ws.send(JSON.stringify(packet)); };
  const error = (ws, message) => send(ws, { type: 'error', message });
  const roster = room => [...room.members.values()].map(p => ({ id: p.id, name: p.name, ready: p.ready, connected: !!p.ws, verified: p.verified }));
  const broadcast = (room, packet) => { for (const p of room.members.values()) send(p.ws, packet); };
  const roomState = room => broadcast(room, { type: 'room', code: room.code, hostId: room.hostId, modeId: room.modeId, phase: room.phase, capacity: room.capacity, participants: roster(room) });
  const startPacket = room => ({ type: 'start', version: VERSION, seed: room.seed, modeId: room.modeId, matchId: room.matchId, capacity: room.capacity, participants: roster(room), hostId: room.hostId });
  function leave(p) {
    const room = p.room; if (!room) return; p.room = null; p.ready = false; room.members.delete(p.id);
    if (['playing', 'starting', 'finished'].includes(room.phase)) pool.send(room.code, 'remove', { id: p.id });
    if (!room.members.size) { rooms.delete(room.code); metrics.delete(room.code); pool.destroy(room.code); return; }
    if (room.hostId === p.id) room.hostId = [...room.members.values()].find(m => m.ws)?.id || room.members.keys().next().value;
    roomState(room);
  }
  function makeSession(name, verified = false, discordId = null) {
    const token = crypto.randomBytes(32).toString('base64url'), p = { id: crypto.randomUUID(), token, name: safeName(name), verified, discordId, expires: Date.now() + 86400000, ws: null, room: null, ready: false, seq: -1 };
    sessions.set(token, p); return p;
  }
  function sameOrigin(req) {
    if (!req.headers.origin) return true;
    try { const u = new URL(req.headers.origin); return u.host === req.headers.host || (!!clientId && u.hostname === clientId + '.discordsays.com'); } catch (_) { return false; }
  }
  async function readBody(req) { let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 8192) throw new Error('Request too large'); } return JSON.parse(body || '{}'); }
  const json = (res, code, data) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
  const server = http.createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname; res.setHeader('X-Content-Type-Options', 'nosniff');
    if (pathname === '/health') return json(res, 200, { ok: true, version: VERSION, rooms: rooms.size, capacity, discordConfigured: !!(clientId && clientSecret), simulations: [...metrics.values()] });
    if (req.method === 'POST' && (pathname === '/api/session' || pathname === '/api/auth/discord')) {
      if (!sameOrigin(req)) return json(res, 403, { error: 'Origin rejected' });
      try {
        const data = await readBody(req);
        if (pathname === '/api/session') { if (process.env.REQUIRE_DISCORD_AUTH === '1') return json(res, 403, { error: 'Войдите через Discord Activity' }); const p = makeSession(data.name); return json(res, 200, { token: p.token, id: p.id, version: VERSION }); }
        if (!clientId || !clientSecret) return json(res, 503, { error: 'Discord OAuth не настроен на сервере' });
        if (typeof data.code !== 'string' || !data.code.trim() || data.code.length > 1024) return json(res, 400, { error: 'Authorization code required' });
        const response = await oauthFetch('https://discord.com/api/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: 'authorization_code', code: data.code }), signal: AbortSignal.timeout(10000) });
        const auth = await response.json(); if (!response.ok || !auth.access_token) return json(res, response.status === 429 ? 429 : 401, { error: 'Discord authorization failed', retry_after: auth.retry_after });
        const identity = await oauthFetch('https://discord.com/api/v10/users/@me', { headers: { Authorization: 'Bearer ' + auth.access_token }, signal: AbortSignal.timeout(10000) });
        const user = await identity.json(); if (!identity.ok || !/^\d+$/.test(user.id)) return json(res, 401, { error: 'Discord identity verification failed' });
        const p = makeSession(user.global_name || user.username, true, user.id); return json(res, 200, { token: p.token, id: p.id, access_token: auth.access_token, version: VERSION });
      } catch (_) { return json(res, 400, { error: 'Не удалось выполнить авторизацию' }); }
    }
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); return res.end(); }
    let body, type;
    if (pathname === '/' || pathname === '/index.html') {
      body = fs.readFileSync(path.join(root, 'index.html'), 'utf8'); const config = JSON.stringify({ clientId, version: VERSION }).replace(/</g, '\\u003c');
      const bundle = path.join(root, 'dist', 'discord.js'), hash = fs.existsSync(bundle) ? crypto.createHash('sha256').update(fs.readFileSync(bundle)).digest('hex').slice(0, 12) : 'dev';
      body = body.replace('</body>', `<script>window.PIXEL_SERVER_CONFIG=${config};</script><script src="/discord.js?v=${hash}"></script></body>`); type = 'text/html; charset=utf-8';
    } else if (pathname === '/discord.js') { const file = path.join(root, 'dist', 'discord.js'); if (!fs.existsSync(file)) { res.writeHead(404); return res.end('Run npm run build:activity'); } body = fs.readFileSync(file); type = 'text/javascript; charset=utf-8'; }
    else { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' }); res.end(req.method === 'HEAD' ? undefined : body);
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 8192, perMessageDeflate: false });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost'), p = sessions.get(url.searchParams.get('token'));
    if (url.pathname !== '/rooms' || !sameOrigin(req) || !p || p.expires < Date.now()) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); return socket.destroy(); }
    if (Number(url.searchParams.get('v')) !== VERSION) { socket.write('HTTP/1.1 426 Upgrade Required\r\n\r\n'); return socket.destroy(); }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req, p));
  });
  wss.on('connection', (ws, req, p) => {
    if (p.ws) p.ws.close(4001, 'Session replaced'); clearTimeout(p.disconnectTimer); p.ws = ws; ws.alive = true; ws.windowAt = Date.now(); ws.messages = 0;
    send(ws, { type: 'hello', id: p.id, version: VERSION, lastSeq: p.seq });
    if (p.room) {
      roomState(p.room);
      if (p.room.matchId && ['playing', 'finished'].includes(p.room.phase)) {
        const resumedRoom = p.room, matchId = resumedRoom.matchId;
        send(ws, startPacket(resumedRoom));
        pool.request(resumedRoom.code, 'snapshot', { id: p.id }).then(snapshot => {
          if (p.ws === ws && p.room === resumedRoom && resumedRoom.matchId === matchId) send(ws, { type: 'snapshot', matchId, snapshot });
        }).catch(() => {});
      }
    }
    ws.on('pong', () => { ws.alive = true; });
    ws.on('message', async raw => {
      if (p.ws !== ws) return; if (Date.now() - ws.windowAt >= 1000) { ws.windowAt = Date.now(); ws.messages = 0; } if (++ws.messages > 100) return ws.close(1008, 'Rate limit');
      let msg; try { msg = JSON.parse(raw.toString()); } catch (_) { return error(ws, 'Некорректное сообщение'); } if (!msg || typeof msg !== 'object') return;
      const room = p.room;
      try {
        if (msg.type === 'create') {
          if (!MODES.has(msg.modeId)) return error(ws, 'Выберите режим арены'); if (rooms.size >= maxRooms) return error(ws, 'Сервер занят');
          leave(p); const code = crypto.randomBytes(4).toString('hex').toUpperCase();
          const created = { code, modeId: msg.modeId, hostId: p.id, phase: 'lobby', capacity: msg.modeId === 'duel' ? 2 : Math.max(2, Math.min(capacity, Math.floor(Number(msg.capacity) || 8))), difficulty: ['easy', 'normal', 'hard'].includes(msg.difficulty) ? msg.difficulty : 'normal', members: new Map([[p.id, p]]) };
          if (!p.verified) p.name = safeName(msg.name); p.ready = false; p.room = created; rooms.set(code, created); roomState(created);
        } else if (msg.type === 'join') {
          const target = rooms.get(String(msg.code || '').trim().toUpperCase()); if (!target) return error(ws, 'Комната не найдена'); if (target === room) return roomState(room);
          if (target.phase === 'starting') return error(ws, 'Матч запускается. Подключитесь через несколько секунд.');
          if (target.members.size >= target.capacity) return error(ws, 'Комната заполнена'); if (target.modeId === 'duel' && target.phase === 'playing') return error(ws, 'Дождитесь завершения дуэли');
          leave(p); if (!p.verified) p.name = safeName(msg.name); p.room = target; p.ready = false; target.members.set(p.id, p);
          if (target.phase === 'playing') {
            try { await pool.request(target.code, 'add', { id: p.id, name: p.name, loadout: msg.loadout }); }
            catch (e) { if (p.room === target) { target.members.delete(p.id); p.room = null; roomState(target); } throw e; }
            if (p.room !== target || p.ws !== ws || rooms.get(target.code) !== target) return;
            send(ws, startPacket(target));
          } roomState(target);
        } else if (msg.type === 'leave') { leave(p); send(ws, { type: 'left' }); }
        else if (msg.type === 'ready' && room && ['lobby', 'finished'].includes(room.phase)) { p.ready = msg.ready === true; p.loadout = msg.loadout; roomState(room); }
        else if (msg.type === 'start' && room && room.hostId === p.id) {
          if (room.phase === 'playing' || room.phase === 'starting') return error(ws, 'Матч уже запущен');
          if ([...room.members.values()].some(m => !m.ready || !m.ws)) return error(ws, 'Все участники должны подтвердить готовность');
          room.phase = 'starting'; room.seed = crypto.randomBytes(4).readUInt32LE(); room.matchId = crypto.randomUUID();
          const players = [...room.members.values()].map(m => { m.seq = -1; return { id: m.id, name: m.name, loadout: m.loadout }; });
          await pool.request(room.code, 'create', { matchId: room.matchId, modeId: room.modeId, capacity: room.capacity, seed: room.seed, difficulty: room.difficulty, players });
          if (rooms.get(room.code) !== room) return;
          if (room.phase === 'starting') room.phase = 'playing';
          broadcast(room, startPacket(room)); roomState(room);
        } else if (msg.type === 'input' && room && room.phase === 'playing' && msg.matchId === room.matchId) { const input = controls(msg.input); if (input.seq <= p.seq) return; p.seq = input.seq; pool.send(room.code, 'input', { id: p.id, input }); }
        else if (msg.type === 'return' && room && room.phase === 'finished') { room.phase = 'lobby'; pool.destroy(room.code); broadcast(room, { type: 'ended', message: 'Готовность к следующему матчу' }); roomState(room); }
        else if (msg.type === 'ping') send(ws, { type: 'pong', sent: msg.sent });
        else if (['snapshot', 'damage', 'pose'].includes(msg.type)) error(ws, 'Состояние боя рассчитывает сервер');
      } catch (_) { error(ws, 'Не удалось выполнить команду комнаты'); if (room?.phase === 'starting') { room.phase = 'lobby'; roomState(room); } }
    });
    ws.on('error', () => {});
    ws.on('close', () => { if (p.ws !== ws) return; p.ws = null; if (p.room) { pool.send(p.room.code, 'input', { id: p.id, input: controls({ seq: ++p.seq }) }); roomState(p.room); } p.disconnectTimer = setTimeout(() => { if (!p.ws) leave(p); }, reconnectMs); p.disconnectTimer.unref(); });
  });
  pool.on('snapshots', ({ room: code, matchId, snapshots }) => { const room = rooms.get(code); if (!room || room.matchId !== matchId || !['playing', 'finished'].includes(room.phase)) return; for (const { id, snapshot } of snapshots) send(room.members.get(id)?.ws, { type: 'snapshot', matchId, snapshot }); });
  pool.on('finished', ({ room: code, matchId }) => { const room = rooms.get(code); if (room && room.matchId === matchId && ['playing', 'starting'].includes(room.phase)) { room.phase = 'finished'; for (const p of room.members.values()) p.ready = false; roomState(room); } });
  pool.on('metrics', ({ room, matchId, ...data }) => { if (rooms.get(room)?.matchId === matchId) metrics.set(room, data); });
  pool.on('failure', ({ room: code, message }) => { const room = rooms.get(code); if (room) { room.phase = 'lobby'; broadcast(room, { type: 'ended', message }); roomState(room); } });
  const heartbeat = setInterval(() => { for (const ws of wss.clients) { if (!ws.alive) ws.terminate(); else { ws.alive = false; ws.ping(); } } for (const [token, p] of sessions) if (!p.ws && !p.room && p.expires < Date.now()) sessions.delete(token); }, 15000); heartbeat.unref();
  server.on('close', () => { clearInterval(heartbeat); for (const p of sessions.values()) clearTimeout(p.disconnectTimer); for (const ws of wss.clients) ws.terminate(); wss.close(); pool.close(); });
  return { server, wss, rooms, capacity, pool, sessions, metrics };
}
if (require.main === module) { try { process.loadEnvFile(); } catch (e) { if (e.code !== 'ENOENT') throw e; } const { server } = createGameServer(), port = Number(process.env.PORT) || 3000; server.listen(port, process.env.HOST || '0.0.0.0', () => console.log(`Pixel Protocol: http://localhost:${port}`)); }
module.exports = { createGameServer, controls, safeName, VERSION };
