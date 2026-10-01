/* Server-authoritative transport. No client ever uploads positions or damage. */
class RoomClient {
  constructor(game, onChange) {
    this.game = game; this.onChange = onChange; this.room = null; this.socket = null; this.id = null; this.matchId = null; this.guest = false;
    this.message = location.protocol === 'file:' ? 'Комнаты: запустите npm start и откройте localhost:3000.' : 'Создайте комнату или введите код друга.';
    this.focusLost = false; this.retries = 0; this.intentional = false; this.pendingInputs = [];
    const inactive = () => { this.focusLost = true; game.input.clear(); this.releaseInput(); };
    window.addEventListener('blur', inactive); window.addEventListener('focus', () => { this.focusLost = false; });
    document.addEventListener('visibilitychange', () => { if (document.hidden) inactive(); else this.focusLost = false; });
    this.backgroundTimer = setInterval(() => { if (document.hidden && this.matchId) this.releaseInput(); }, 1000);
  }
  get isHost() { return !!this.room && this.room.hostId === this.id; }
  refresh(message) { if (message) this.message = message; this.onChange?.(this); }
  send(packet) { if (this.socket?.readyState !== WebSocket.OPEN || this.socket.bufferedAmount > 128 * 1024) return false; this.socket.send(JSON.stringify(packet)); return true; }
  async session() {
    if (window.PixelDiscordAuth) return window.PixelDiscordAuth;
    if (new URLSearchParams(location.search).has('frame_id')) {
      if (!window.PixelDiscordReady) throw new Error('Дождитесь авторизации Discord');
      const auth = await window.PixelDiscordReady; if (!auth?.token) throw new Error('Discord не подтвердил авторизацию'); return auth.token;
    }
    let token; try { token = sessionStorage.getItem('pixel-room-token'); } catch (_) {}
    if (token) return token;
    const response = await fetch('/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: loadLook().nickname }) });
    const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Ошибка авторизации');
    try { sessionStorage.setItem('pixel-room-token', data.token); } catch (_) {} return data.token;
  }
  async connect() {
    if (location.protocol === 'file:') throw new Error('Комнаты доступны через npm start → localhost:3000');
    this.intentional = false;
    if (this.socket?.readyState === WebSocket.OPEN && this.id) return;
    if (this.connecting) return this.connecting;
    this.intentional = false;
    this.connecting = (async () => {
      const token = await this.session();
      await new Promise((resolve, reject) => {
        const url = new URL('/rooms', location.href); url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'; url.searchParams.set('token', token); url.searchParams.set('v', CombatCore.VERSION);
        const ws = this.socket = new WebSocket(url); let settled = false;
        const timer = setTimeout(() => { ws.close(); reject(new Error('Сервер не отвечает')); }, 8000);
        ws.addEventListener('message', event => {
          if (ws !== this.socket) return; let packet; try { packet = JSON.parse(event.data); } catch (_) { return; }
          if (packet.type === 'hello') {
            if (packet.version !== CombatCore.VERSION) { ws.close(); reject(new Error('Версия игры изменилась. Обновите страницу.')); return; }
            this.id = packet.id; this.lastSeq = packet.lastSeq || 0; this.retries = 0; this.disconnectedAt = 0; settled = true; clearTimeout(timer); resolve();
          } else this.receive(packet);
        });
        ws.addEventListener('close', event => {
          clearTimeout(timer); if (!settled) reject(new Error('Подключение отклонено. Обновите страницу и проверьте сервер.'));
          if (ws !== this.socket || this.intentional || event.code === 4001) return;
          if (this.room) { this.disconnectedAt ||= Date.now(); this.refresh('Связь потеряна. Восстановление… Персонаж остаётся на арене.'); this.reconnect(); }
        });
        ws.addEventListener('error', () => { if (!settled) { clearTimeout(timer); reject(new Error('Сервер недоступен')); } });
      });
    })().finally(() => { this.connecting = null; }); return this.connecting;
  }
  reconnect() {
    clearTimeout(this.retryTimer);
    if (Date.now() - this.disconnectedAt > 30000) { this.room = null; this.matchId = null; this.showMenu(); this.refresh('Время восстановления истекло. Войдите в комнату снова.'); return; }
    this.retryTimer = setTimeout(() => this.connect().catch(() => this.reconnect()), Math.min(4000, 500 * 2 ** this.retries++));
  }
  async create(modeId) {
    if (modeId === 'campaign') return this.refresh('Кампания — одиночная. Выберите арену.');
    try { await this.connect(); this.send({ type: 'create', modeId, name: loadLook().nickname, capacity: Number(document.getElementById('modePlayersSetting').value) + 1, difficulty: document.getElementById('botDifficultySetting')?.value || 'normal' }); } catch (e) { this.refresh(e.message); }
  }
  async join(code) { try { await this.connect(); this.send({ type: 'join', code: String(code).trim(), name: loadLook().nickname, loadout: document.getElementById('loadoutSetting')?.value }); } catch (e) { this.refresh(e.message); } }
  ready(ready = true) { this.send({ type: 'ready', ready, loadout: document.getElementById('loadoutSetting')?.value || 'assault' }); }
  start() { if (!this.isHost) return this.refresh('Матч запускает создатель комнаты после общей готовности.'); this.send({ type: 'start' }); }
  leave() { this.intentional = true; clearTimeout(this.retryTimer); this.releaseInput(); this.send({ type: 'leave' }); this.room = null; this.matchId = null; this.guest = false; this.showMenu(); this.refresh('Вы вышли из комнаты.'); }
  returnToLobby() {
    this.releaseInput(); if (this.room?.phase === 'finished') this.send({ type: 'return' });
    if (!this.room || this.room.phase !== 'playing') this.matchId = null;
    this.showMenu(); this.refresh();
  }
  showMenu() {
    const g = this.game; g.leaveArena(); g.state = ST_MENU; g.input.clear(); sfx.flameStop(); sfx.spinup(false, 0);
    for (const id of ['pause', 'arenaResults', 'gameover', 'victory']) document.getElementById(id)?.classList.remove('show');
    document.getElementById('start').classList.add('show'); document.body.classList.remove('playing');
  }
  receive(packet) {
    if (packet.type === 'room') { this.room = packet; this.game.modeId = packet.modeId; this.refresh('КОМНАТА ' + packet.code + ' · ' + packet.participants.length + '/' + packet.capacity); }
    else if (packet.type === 'error') this.refresh(packet.message);
    else if (packet.type === 'left') { this.room = null; this.matchId = null; this.refresh(); }
    else if (packet.type === 'ended') { this.matchId = null; this.showMenu(); this.refresh(packet.message); }
    else if (packet.type === 'start') {
      const same = this.matchId === packet.matchId && this.game.arena;
      this.matchId = packet.matchId; this.guest = true;
      if (!same) this.game.startRun(packet.seed, packet.modeId, { online: true, localId: this.id, capacity: packet.capacity });
      this.game.arena.seq = Math.max(this.game.arena.seq, this.lastSeq || 0); this.pendingInputs.length = 0; this.refresh('Матч идёт · сервер 60 Гц');
    } else if (packet.type === 'snapshot' && packet.matchId === this.matchId) {
      this.lastSnapshotAt = performance.now(); this.game.arena?.applySnapshot(packet.snapshot);
    }
  }
  sendControls(input) { this.lastSeq = input.seq; return this.send({ type: 'input', matchId: this.matchId, input }); }
  releaseInput() { if (!this.matchId) return; const arena = this.game.arena; const seq = arena ? ++arena.seq : (this.lastSeq || 0) + 1; this.lastSeq = seq; this.send({ type: 'input', matchId: this.matchId, input: { seq } }); }
}
const GRAPHICS_PRESETS = {
  low: { ratio: 1, shadows: false, shadowSize: 512 },
  balanced: { ratio: 1.5, shadows: true, shadowSize: 1024 },
  high: { ratio: 2, shadows: true, shadowSize: 2048 }
};
function applyGraphicsPreset(game, id, customizer) {
  const preset = GRAPHICS_PRESETS[id] || GRAPHICS_PRESETS.balanced;
  game.qualityId = GRAPHICS_PRESETS[id] ? id : 'balanced'; game.qualityRatio = preset.ratio; game.pixelRatioScale = 1;
  game.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, preset.ratio)); game.renderer.shadowMap.enabled = preset.shadows;
  game.keyLight.shadow.mapSize.set(preset.shadowSize, preset.shadowSize);
  if (game.keyLight.shadow.map) { game.keyLight.shadow.map.dispose(); game.keyLight.shadow.map = null; }
  game.scene.traverse(object => { if (object.material) for (const m of Array.isArray(object.material) ? object.material : [object.material]) m.needsUpdate = true; });
  game.resize(); if (customizer) { customizer.renderer?.setPixelRatio(Math.min(window.devicePixelRatio || 1, preset.ratio)); customizer._resize(); }
}
