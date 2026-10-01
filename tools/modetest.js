/* Presentation contract: the adapter displays the shared authority and has no
   second client damage implementation. Core rules are in coretest.js. */
'use strict';
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), assert = require('node:assert/strict');
const CombatCore = require('../src/62-combat-core.js'), { WEAPONS, WEAPON_BY_ID } = require('../src/60-weapons.js');
const noop = () => {};
class LevelMap {
  constructor(w, h) { this.w = w; this.h = h; this.grid = new Uint8Array(w * h); }
  _initNavRouting() {}
}
const context = vm.createContext({ CombatCore, WEAPONS, WEAPON_BY_ID, LevelMap, performance, console, S_CHASE: 1, S_DYING: 2 });
vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/94-modes.js'), 'utf8'), context);
const { ArenaMatch, createArenaLevel, MODE_DEFS } = vm.runInContext('({ArenaMatch,createArenaLevel,MODE_DEFS})', context);
let count = 0;
function test(name, fn) { fn(); count++; console.log('OK', name); }
function fixture(mode = 'ffa', options = {}) {
  const player = { hp: 100, callsign: 'TEST', weaponIndex: 2, weapon: WEAPON_BY_ID.smg, setWeapon(index) { this.weaponIndex = index; this.weapon = WEAPONS[index]; } };
  const game = { player, stats: { kills: 0, shots: 0 }, runSeed: 77, score: 0, scene: { remove: noop } };
  game.arena = new ArenaMatch(game, mode, { headless: true, botCount: 3, ...options }); return game;
}
function tick(game, count = 1) { for (let i = 0; i < count; i++) game.arena.world.step(); game.arena.applySnapshot(game.arena.world.snapshot(game.arena.localId)); }
test('visual map wrapper uses exact authority collision and metadata', () => {
  for (const mode of ['duel', 'ffa', 'royale']) {
    const level = createArenaLevel(99, mode), authority = CombatCore.createArenaMap(mode, 99);
    assert.deepEqual(Array.from(level.grid), Array.from(authority.grid)); assert.equal(level.arenaCode, authority.arenaCode); assert.equal(level.arenaName, authority.arenaName);
    assert.equal(level.spawnPoints.length, authority.spawns.length); assert(level.arenaLayout.blocks.length > 0);
  }
});
test('all offline modes instantiate one shared World and display the player state', () => {
  for (const mode of ['duel', 'ffa', 'royale']) {
    const game = fixture(mode); assert(game.arena.world instanceof CombatCore.World); assert.equal(game.arena.localId, 'local'); tick(game, 190);
    const authority = game.arena.world.actors.get('local'); assert.equal(game.player.x, authority.x); assert.equal(game.player.hp, authority.hp); assert.equal(game.player.weaponId, authority.weaponId);
    assert.equal(game.arena.roster.length, mode === 'duel' ? 2 : 4); assert.equal(game.arena.hudState().roster.filter(a => a.isPlayer).length, 1);
  }
});
test('adapter applies visible remote actors and removes redacted actors', () => {
  const game = fixture('ffa'), w = game.arena.world; tick(game, 190);
  const local = w.actors.get('local'), bot = w.list.find(a => a.bot); local.x = -5; local.z = 0; bot.x = 5; bot.z = 0; w.events.length = 0;
  game.arena.applySnapshot(w.snapshot('local')); assert(game.arena.enemies.list.some(a => a.id === bot.id));
  bot.x = 38; bot.z = 38; game.arena.applySnapshot(w.snapshot('local')); assert(!game.arena.enemies.list.some(a => a.id === bot.id));
  assert(game.arena.roster.some(a => a.id === bot.id), 'public score remains without a hidden position');
});
test('presentation cannot deal damage; only World authority determines results', () => {
  const game = fixture('duel'); tick(game, 190); const w = game.arena.world, bot = w.list.find(a => a.bot);
  assert.equal(game.arena.enemies.damage(bot, 999999), false); assert(bot.alive);
  w.actors.get('local').score = 4; bot.spawnProtection = 0; w.damage(bot.id, 1000, 'local'); tick(game);
  assert.equal(game.arena.result.winnerId, 'local'); assert.equal(game.arena.phase, 'finished'); assert.equal(game.arena.hudState().self.score, 5);
});
test('online adapter has no local world and accepts only correct protocol/mode', () => {
  const game = fixture('ffa', { online: true, localId: 'p' }); assert.equal(game.arena.world, undefined);
  const w = new CombatCore.World({ modeId: 'ffa' }); w.addPlayer({ id: 'p' }); w.addPlayer({ id: 'q' }); w.start();
  const snapshot = w.snapshot('p'); assert.equal(game.arena.applySnapshot({ ...snapshot, version: 999 }), false); assert.equal(game.arena.applySnapshot({ ...snapshot, modeId: 'royale' }), false);
  assert.equal(game.arena.applySnapshot(snapshot), true); assert.equal(game.player.id, 'p'); assert.deepEqual(game.player.carrySlots, snapshot.self.weaponSlots);
});
test('royale HUD follows spectator and exposes finite ammunition/channel state', () => {
  const game = fixture('royale'); tick(game, 190); const w = game.arena.world, me = w.actors.get('local');
  assert.equal(game.arena.self.reserveLimited, true); assert.equal(game.arena.self.reserve, 42);
  me.spawnProtection = 0; w.damage('local', 1000, 'bot-0'); tick(game);
  assert.equal(game.arena.result, null); const hud = game.arena.hudState(); assert(hud.spectator && hud.spectating); assert.equal(hud.zone.stage, 1);
});
test('competitive mode metadata retains finite duration and target rules', () => {
  assert.equal(MODE_DEFS.duel.target, 5); assert.equal(MODE_DEFS.duel.duration, 900); assert.equal(MODE_DEFS.ffa.target, 20); assert.equal(MODE_DEFS.royale.duration, 480);
});
test('royale announces the next safe circle before current zone becomes harmful', () => {
  const game = fixture('royale'); tick(game, 190); const a = game.arena;
  a.zone = { x: 0, z: 0, radius: 40, nextX: 4, nextZ: 0, nextRadius: 20 };
  a.self.x = -30; a.self.z = 0;
  let hud = a.hudState(); assert.equal(typeof hud.zoneWarning, 'string'); assert.equal(hud.zoneTarget.x, 4); assert.equal(hud.zoneTarget.radius, 20);
  a.self.x = -45; hud = a.hudState(); assert.equal(hud.zoneWarning, true); assert.equal(hud.zoneTarget.radius, 40);
  a.self.x = 4; hud = a.hudState(); assert.equal(hud.zoneWarning, false); assert.equal(hud.zoneTarget, null);
});
console.log('MODES_OK', count, 'adapter cases');
