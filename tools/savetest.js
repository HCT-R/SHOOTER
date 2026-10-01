/* CPU-only save migration/recovery regression: node tools/savetest.js */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const source = ['05-save.js', '45-customize.js', '92-upgrades.js'].map((file) =>
  fs.readFileSync(path.join(root, 'src', file), 'utf8')).join('\n');
const KEY = 'pixel_protocol_profile';
const BACKUP = KEY + '_backup', RECOVERY = KEY + '_recovery';
let checks = 0;
function equal(actual, expected, message) { checks++; assert.strictEqual(actual, expected, message); }
function ok(condition, message) { checks++; assert(condition, message); }
function profile(settings = {}, best = 0, appearance = null, records = {}) {
  return JSON.stringify({ schemaVersion: 3, settings, appearance,
    records: Object.assign({ best }, records) });
}
// the shape players on the previous release actually have on disk
function legacyProfile(settings = {}, best = 0, appearance = null) {
  return JSON.stringify({ schemaVersion: 1, settings, appearance, records: { best } });
}
function storage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data, readsBlocked: false, writesBlocked: false, blockedKey: null,
    getItem(key) { if (this.readsBlocked) throw Error('SecurityError'); return data.has(key) ? data.get(key) : null; },
    setItem(key, value) {
      if (this.writesBlocked || this.blockedKey === key) throw Error('QuotaExceededError');
      data.set(key, String(value));
    }
  };
}
function boot(disk, denyAccess = false) {
  const window = {};
  Object.defineProperty(window, 'localStorage', { get() { if (denyAccess) throw Error('SecurityError'); return disk; } });
  const context = vm.createContext({ window, console });
  vm.runInContext(source, context);
  return vm.runInContext('({ store, createProfileStore, normalizeCampaignProgress, parseProfileBoolean, clampLook, loadLook, saveLook, randomLook, ' +
    'LOOK_PRESETS, META_UPGRADES, META_BY_ID, metaCost, clampMetaRanks, metaInvested })', context);
}

// Upgrade a real old profile while leaving every legacy byte in place.
{
  const look = JSON.stringify({ nickname: 'Тень-07', skin: 0x9a6a44, vest: 'false', backpack: 0,
    jacket: 0x44403a, helmet: 'recon', shoulders: 'heavy', accent: 0xb6a0ff });
  const old = { as3d_look: look, as3d_best: '842', as3d_volume: '0', as3d_music: 'false', as3d_motion: '0', as3d_pixels: '4' };
  const disk = storage(old), api = boot(disk), s = api.store;
  equal(s.get('best', '0'), '842');
  equal(s.get('as3d_music', '1'), '0');
  equal(s.get('pixel_protocol_volume', '55'), '0');
  equal(s.get('motion', ''), '0');
  equal(s.get('pixels', '2'), '2');
  const saved = JSON.parse(disk.data.get(KEY));
  equal(saved.schemaVersion, 3);
  equal(saved.settings.music, false);
  equal(saved.settings.motion, false);
  equal(saved.settings.volume, 0);
  equal(saved.appearance.nickname, 'Тень-07');
  equal(saved.appearance.vest, false);
  equal(saved.appearance.backpack, false);
  equal(saved.appearance.jacket, 0x44403a);
  for (const [key, value] of Object.entries(old)) equal(disk.data.get(key), value, 'legacy key changed: ' + key);
  const previous = disk.data.get(KEY);
  equal(s.set('as3d_music', true), true);
  equal(disk.data.get(BACKUP), previous, 'previous profile was not backed up exactly');
  equal(disk.data.get('as3d_music'), 'false');
  equal(boot(disk).store.get('music', '0'), '1');
  const copy = s.snapshot(); copy.settings.music = false;
  equal(s.get('music'), '1', 'snapshot exposed mutable internal state');
  equal(s.get('unknown', 'fallback'), 'fallback');
  equal(s.set('unknown', 1), false);
}

// Missing preferences remain missing, preserving prefers-reduced-motion.
{
  const disk = storage(), s = boot(disk).store;
  equal(s.get('motion', ''), '');
  equal(Object.keys(JSON.parse(disk.data.get(KEY)).settings).length, 0);
  equal(s.get('best', '0'), '0');
  equal(s.status().persistence, 'persistent');
}

// Invalid legacy fields fall back independently, without poisoning good data.
{
  const disk = storage({ as3d_best: '-5', as3d_volume: 'NaN', as3d_music: 'maybe', as3d_motion: '{}',
    as3d_pixels: '9', as3d_look: '{broken', pixel_protocol_best: '345' });
  const api = boot(disk), s = api.store;
  equal(s.get('best', '0'), '345');
  equal(s.get('volume', '55'), '55');
  equal(s.get('music', '1'), '1');
  equal(s.get('motion', ''), '');
  equal(s.get('pixels', '2'), '2');
  equal(api.loadLook().nickname, 'NOMAD');
  for (const value of [null, [], {}, '', 'NaN', Infinity, -1, 101]) equal(s.set('volume', value), false);
  for (const value of [null, [], {}, '', 'NaN', Infinity, -1, 1, 5]) equal(s.set('pixels', value), false);
  equal(s.set('look', '{invalid'), false);
  equal(s.set('look', []), false);
  equal(s.set('best', '123.8'), true);
  equal(s.get('best'), '345', 'a lower record replaced the high score');
}

// Strict booleans and every authored preset, including the medic jacket.
{
  const api = boot(storage());
  for (const value of [false, 0, '0', 'false', ' FALSE ']) {
    equal(api.clampLook({ vest: value, backpack: value }).vest, false);
    equal(api.clampLook({ vest: value, backpack: value }).backpack, false);
    equal(api.parseProfileBoolean(value, true), false);
  }
  for (const value of [true, 1, '1', 'true', ' TRUE ']) equal(api.parseProfileBoolean(value, false), true);
  for (const value of [undefined, null, [], {}, 2, -1, '', 'no', 'yes']) {
    equal(api.clampLook({ vest: value, backpack: value }).vest, true);
    equal(api.clampLook({ vest: value, backpack: value }).backpack, true);
    equal(api.parseProfileBoolean(value, false), false);
  }
  for (const preset of api.LOOK_PRESETS) {
    const clean = api.clampLook(preset.look);
    for (const key of Object.keys(preset.look)) equal(clean[key], preset.look[key], preset.name + ' lost ' + key);
  }
  api.saveLook({ nickname: 'Медик_9', vest: false, backpack: false, jacket: 0x44403a });
  equal(api.loadLook().nickname, 'Медик_9');
  equal(api.randomLook().nickname, 'Медик_9');
}

/* Every setting the game writes has to be writable. The profile rejects any
   key it has no validation rule for, which is the right default and a silent
   failure when a new setting is added to the key list and nowhere else: the
   game keeps working, the preference simply never survives a reload. */
{
  const s = boot(storage()).store;
  const settings = [
    ['music', '0', '0'], ['music', '1', '1'],
    ['motion', '0', '0'], ['motion', '1', '1'],
    ['dmgnum', '0', '0'], ['dmgnum', '1', '1'],
    ['volume', 40, '40'], ['quality', 'high', 'high'], ['sfxVolume', 80, '80'], ['musicVolume', 35, '35'], ['botDifficulty', 'hard', 'hard'], ['loadout', 'weapon:suppressedSmg', 'weapon:suppressedSmg']
  ];
  for (const [key, write, read] of settings) {
    equal(s.set(key, write), true, key + ' could not be written');
    equal(s.get(key, 'missing'), read, key + ' did not survive a write');
  }
  // booleans are strict in both directions, not merely truthy
  for (const key of ['music', 'motion', 'dmgnum']) {
    equal(s.set(key, 'maybe'), false, key + ' accepted a value that is neither true nor false');
    equal(s.set(key, false), true, key + ' refused a real false');
    equal(s.get(key, '1'), '0', key + ' did not read back as false');
  }
  // and a key the format knows nothing about stays out
  equal(s.set('telemetry', '1'), false, 'an unknown setting was accepted');
  equal(s.get('telemetry', 'missing'), 'missing', 'an unknown setting was stored');
}

// Unavailable storage still preserves settings and customization this session.
{
  const disk = storage(), api = boot(disk, true), s = api.store;
  equal(s.set('music', false), false);
  equal(s.get('music', '1'), '0');
  api.saveLook({ nickname: 'LOCAL', vest: false });
  equal(api.loadLook().nickname, 'LOCAL');
  equal(api.loadLook().vest, false);
  equal(s.status().persistence, 'memory');
  equal(disk.data.size, 0);
}
{
  const original = profile({ volume: 55, pixels: 2 }, 999);
  const disk = storage({ [KEY]: original }); disk.readsBlocked = true;
  const s = boot(disk).store;
  equal(s.set('best', 100), false);
  equal(s.set('music', false), false);
  equal(s.get('music'), '0');
  disk.readsBlocked = false;
  equal(s.flush(), true);
  const saved = JSON.parse(disk.data.get(KEY));
  equal(saved.records.best, 999);
  equal(saved.settings.volume, 55);
  equal(saved.settings.music, false);
}

// A failed backup/write never destroys the last durable profile.
{
  const original = profile({ volume: 55 }, 12);
  const disk = storage({ [KEY]: original }), s = boot(disk).store;
  equal(s.get('volume'), '55');
  disk.blockedKey = BACKUP;
  equal(s.set('volume', 23), false);
  equal(s.get('volume'), '23');
  equal(disk.data.get(KEY), original);
  disk.blockedKey = KEY;
  equal(s.flush(), false);
  equal(disk.data.get(KEY), original);
  equal(disk.data.get(BACKUP), original);
  disk.blockedKey = null;
  equal(s.flush(), true);
  equal(boot(disk).store.get('volume'), '23');
}

// Corrupt and newer primary saves survive intact; recovery has its own key.
for (const original of ['{broken-json', JSON.stringify({ schemaVersion: 9, futureProgress: { keep: true } }),
  '[]', 'null', JSON.stringify({ schemaVersion: 1, settings: [] })]) {
  const backup = profile({ volume: 17 }, 919);
  const disk = storage({ [KEY]: original, [BACKUP]: backup }), s = boot(disk).store;
  equal(s.get('best', '0'), '919');
  equal(s.get('volume', '55'), '17');
  equal(disk.data.get(KEY), original);
  equal(s.set('music', false), true);
  equal(s.status().persistence, 'recovery');
  equal(disk.data.get(KEY), original);
  equal(disk.data.get(BACKUP), backup);
  equal(JSON.parse(disk.data.get(RECOVERY)).settings.music, false);
  equal(boot(disk).store.get('music', '1'), '0');
  equal(boot(disk).store.get('best', '0'), '919');
}
{
  const main = '{broken', recovery = JSON.stringify({ schemaVersion: 6, keep: true });
  const disk = storage({ [KEY]: main, [RECOVERY]: recovery, as3d_best: '81' }), s = boot(disk).store;
  equal(s.get('best', '0'), '81');
  equal(s.set('best', 100), false);
  equal(s.get('best'), '100');
  equal(s.status().persistence, 'memory');
  equal(disk.data.get(KEY), main);
  equal(disk.data.get(RECOVERY), recovery);
}

// Malformed fields in a supported schema are repaired only after exact backup.
{
  const original = profile({ music: 'maybe', volume: 'bad', motion: 'false', pixels: 4 }, -5);
  const disk = storage({ [KEY]: original }), s = boot(disk).store;
  equal(s.get('music', '1'), '1');
  equal(s.get('motion', '1'), '0');
  equal(s.get('pixels', '2'), '2');
  equal(s.status().reason, 'invalid-fields-recovered');
  equal(disk.data.get(KEY), original, 'loading silently replaced malformed data');
  equal(s.set('best', 300), true);
  equal(disk.data.get(BACKUP), original);
  equal(boot(disk).store.get('best'), '300');
}

// Two tabs merge independent changes and preserve the best score.
{
  const disk = storage({ [KEY]: profile({ volume: 55, music: true }, 10) });
  const a = boot(disk).store, b = boot(disk).store;
  a.get('best'); b.get('best');
  equal(a.set('volume', 11), true);
  equal(b.set('music', false), true);
  equal(a.set('best', 500), true);
  equal(b.set('best', 40), true);
  const latest = boot(disk).store;
  equal(latest.get('volume'), '11');
  equal(latest.get('music'), '0');
  equal(latest.get('best'), '500');
}

/* Schema 1 -> 2 -> 3. This is the case that costs real players their profile if it
   regresses: everything they had must survive, and the upgrade must be
   reported as an upgrade rather than as damage. */
{
  const look = JSON.stringify({ nickname: 'Вектор-12', skin: 0x9a6a44, jacket: 0x44403a });
  const original = legacyProfile({ volume: 41, music: false, pixels: 3 }, 1234, JSON.parse(look));
  const disk = storage({ [KEY]: original }), s = boot(disk).store;
  equal(s.get('best', '0'), '1234', 'migration lost the high score');
  equal(s.get('volume', '55'), '41', 'migration lost a setting');
  equal(s.get('music', '1'), '0', 'migration lost a boolean setting');
  equal(s.get('pixels', '2'), '2');
  equal(JSON.parse(s.get('look', '{}')).nickname, 'Вектор-12', 'migration lost the callsign');
  equal(s.status().schemaVersion, 3);
  equal(s.status().persistence, 'persistent', 'an upgradable profile was not treated as usable');
  equal(s.status().reason, 'schema-migrated', 'migration was reported as corruption');
  // new fields default rather than appearing as undefined
  equal(s.get('samples', '0'), '0');
  equal(s.get('runs', '0'), '0');
  // loading alone must not rewrite the old bytes; the first write does, and
  // it backs the previous profile up exactly
  equal(disk.data.get(KEY), original, 'loading rewrote the profile before any change');
  equal(s.set('samples', 25), true);
  equal(disk.data.get(BACKUP), original, 'the pre-migration profile was not backed up');
  const saved = JSON.parse(disk.data.get(KEY));
  equal(saved.schemaVersion, 3);
  equal(saved.records.samples, 25);
  equal(saved.records.best, 1234);
  equal(saved.appearance.nickname, 'Вектор-12');
  // a second launch is a plain load, no second migration
  const again = boot(disk).store;
  equal(again.status().reason, null, 'a migrated profile migrated again');
  equal(again.get('samples', '0'), '25');
}

/* Meta-currency is spendable, so unlike the high score it has to be able to
   go down — and it must still refuse nonsense. */
{
  const disk = storage({ [KEY]: profile({}, 500, null, { samples: 90, runs: 4 }) }), s = boot(disk).store;
  equal(s.get('samples', '0'), '90');
  equal(s.get('runs', '0'), '4');
  equal(s.set('samples', 30), true, 'spending samples was rejected');
  equal(s.get('samples', '0'), '30', 'samples did not decrease when spent');
  equal(s.set('best', 100), true);
  equal(s.get('best', '0'), '500', 'the high score was rolled back by a lower value');
  equal(s.set('runs', 2), true);
  equal(s.get('runs', '0'), '4', 'the run counter was rolled back');
  equal(s.set('runs', 9), true);
  equal(s.get('runs', '0'), '9');
  for (const bad of [-1, 'lots', NaN, Infinity, {}]) {
    equal(s.set('samples', bad), false, 'accepted invalid sample count: ' + String(bad));
  }
  equal(s.get('samples', '0'), '30');
  equal(s.set('samples', 0), true, 'a zero balance was rejected');
  equal(s.get('samples', '9'), '0');
}

/* A version with no upgrade step is unrecoverable: guessing at its shape is
   worse than keeping the bytes and working in a sidecar. */
{
  const original = JSON.stringify({ schemaVersion: 0, settings: { volume: 10 } });
  const disk = storage({ [KEY]: original }), s = boot(disk).store;
  equal(s.status().persistence, 'recovery');
  equal(disk.data.get(KEY), original, 'an unmigratable profile was overwritten');
}

/* Station ranks are a map inside the profile, and the profile is text the
   player can edit. Everything below is about what a hand-written or stale
   save is allowed to do to the game. */
{
  const api = boot(storage()), { META_UPGRADES, META_BY_ID, metaCost, clampMetaRanks, metaInvested } = api;
  ok(META_UPGRADES.length >= 5, 'station has too few upgrades to feel like progression');
  const ids = new Set();
  for (const u of META_UPGRADES) {
    ok(!ids.has(u.id), 'duplicate station upgrade id ' + u.id);
    ids.add(u.id);
    ok(typeof u.title === 'string' && u.title.length > 0, u.id + ' has no title');
    ok(typeof u.desc === 'string' && u.desc.length > 0, u.id + ' has no description');
    ok(Number.isInteger(u.max) && u.max >= 1, u.id + ' has a bad cap');
    ok(typeof u.apply === 'function', u.id + ' has no effect');
    ok(u.cost > 0 && u.step >= 0, u.id + ' is priced wrong');
    equal(META_BY_ID[u.id], u, u.id + ' missing from the index');
    // price climbs with rank and stops existing at the cap
    ok(metaCost(u, 0) === u.cost, u.id + ' first rank is mispriced');
    ok(metaCost(u, u.max) === Infinity, u.id + ' can be bought past its cap');
    if (u.step > 0) ok(metaCost(u, 1) > metaCost(u, 0), u.id + ' second rank is not dearer');
  }
  equal(metaCost(null, 0), Infinity);
  equal(metaInvested({}), 0);
  const first = META_UPGRADES[0];
  equal(metaInvested({ [first.id]: 2 }), first.cost + (first.cost + first.step));

  // clamping: caps hold, junk is dropped, unknown content cannot come back
  const clamped = clampMetaRanks({ [first.id]: 99, unknownRelic: 4, [META_UPGRADES[1].id]: '2' });
  equal(clamped[first.id], first.max, 'a rank above the cap was kept');
  equal(clamped[META_UPGRADES[1].id], 2, 'a numeric string rank was dropped');
  equal(clamped.unknownRelic, undefined, 'an unknown upgrade id survived the clamp');
  for (const bad of [null, undefined, 'text', 42, []]) {
    equal(Object.keys(clampMetaRanks(bad)).length, 0, 'garbage produced ranks: ' + String(bad));
  }
  for (const bad of [-3, 0, 'x', NaN, Infinity, {}]) {
    equal(clampMetaRanks({ [first.id]: bad })[first.id], undefined, 'bad rank accepted: ' + String(bad));
  }
  equal(clampMetaRanks({ [first.id]: 2.8 })[first.id], 2, 'a fractional rank was not floored');
}

/* Ranks round-trip through the profile and are clamped on the way in, so a
   tampered save cannot start a run with content that does not exist. */
{
  const disk = storage(), s = boot(disk).store;
  const { META_UPGRADES } = boot(storage());
  const first = META_UPGRADES[0].id;
  equal(s.get('meta', '{}'), '{}', 'a fresh profile started with station ranks');
  equal(s.set('meta', { [first]: 2 }), true);
  equal(JSON.parse(s.get('meta', '{}'))[first], 2);
  equal(JSON.parse(disk.data.get(KEY)).progression[first], 2, 'ranks were not written to the profile');
  // accepted as text too, because that is how get() hands them back
  equal(s.set('meta', JSON.stringify({ [first]: 1 })), true);
  equal(JSON.parse(s.get('meta', '{}'))[first], 1);
  for (const bad of ['{broken', 'null', '[]', 7]) equal(s.set('meta', bad), false, 'accepted bad ranks: ' + String(bad));
  equal(JSON.parse(s.get('meta', '{}'))[first], 1, 'a rejected write changed stored ranks');
  // a save edited by hand is clamped when it is read back, not trusted
  disk.data.set(KEY, JSON.stringify({ schemaVersion: 3, settings: {}, appearance: null,
    records: { best: 0 }, progression: { [first]: 9999, ghostUpgrade: 3 } }));
  const reread = boot(disk).store, ranks = JSON.parse(reread.get('meta', '{}'));
  equal(ranks[first], META_UPGRADES[0].max, 'a tampered rank was not clamped on load');
  equal(ranks.ghostUpgrade, undefined, 'an unknown upgrade survived a reload');
  equal(reread.status().reason, 'invalid-fields-recovered', 'a repaired profile did not say so');
}

/* A version-1 profile has no progression section at all; it must upgrade into
   an empty one rather than reading as damage. */
{
  const disk = storage({ [KEY]: legacyProfile({ volume: 30 }, 77) }), s = boot(disk).store;
  equal(s.get('meta', '{}'), '{}', 'migration invented station ranks');
  equal(s.status().reason, 'schema-migrated');
  equal(s.get('best', '0'), '77');
}

// Schema2 keeps identity, records, progression and audio; only the removed
// pixel preference disappears. The backup retains the exact original bytes.
{
  const original = JSON.stringify({schemaVersion:2,settings:{pixels:6,volume:29,sfxVolume:73,quality:'high'},appearance:{nickname:'ARCHIVE'},
    records:{best:930,samples:144,runs:8},progression:{},controls:{}});
  const disk=storage({[KEY]:original}),s=boot(disk).store;
  equal(s.status().schemaVersion,3);equal(s.status().reason,'schema-migrated');
  equal(s.get('best'),'930');equal(s.get('samples'),'144');equal(s.get('runs'),'8');
  equal(s.get('sfxVolume'),'73');equal(s.get('quality'),'high');equal(s.get('pixels','removed'),'removed');
  equal(JSON.parse(s.get('look')).nickname,'ARCHIVE');equal(s.set('musicVolume',22),true);
  equal(disk.data.get(BACKUP),original);equal(JSON.parse(disk.data.get(KEY)).settings.pixels,undefined);
}

// Safe stage checkpoints preserve carried weapons, melee selection, ammo and
// build while rejecting corrupt boundaries and clamping untrusted counters.
{
  const disk=storage(),api=boot(disk),s=api.store;
  const campaign={unlocked:3,completed:[1,2],logs:['archive-a'],checkpoint:{missionId:3,stageIndex:5,seed:3107,money:200,score:300,time:80,sampleYield:16,
    perks:{overcharge:2},upgrades:{damage:1},stats:{kills:14},player:{hp:72,maxHp:125,armor:13,maxArmor:100,owned:['pistol','knife','suppressedSmg','spear'],
      weaponId:'suppressedSmg',meleeId:'spear',ammo:{light:120},mags:{suppressedSmg:21},bonuses:{damageMultiplier:1.44,burnChains:1}}}};
  equal(s.set('campaign',campaign),true);
  const restored=JSON.parse(boot(disk).store.get('campaign'));
  equal(restored.checkpoint.stageIndex,5);equal(restored.checkpoint.seed,3107);equal(restored.checkpoint.player.weaponId,'suppressedSmg');
  equal(restored.checkpoint.player.meleeId,'spear');equal(restored.checkpoint.player.mags.suppressedSmg,21);equal(restored.checkpoint.player.bonuses.burnChains,1);
  equal(restored.completed.join(','),'1,2');equal(restored.logs.join(','),'archive-a');
  for(const bad of [null,[],3,'{broken'])equal(s.set('campaign',bad),false);
  for(const patch of [{missionId:7},{stageIndex:-1},{stageIndex:1.1},{seed:-1},{seed:0x100000000}]){
    const clean=api.normalizeCampaignProgress({...campaign,checkpoint:{...campaign.checkpoint,...patch}});equal(clean.checkpoint,null,'invalid checkpoint accepted');
  }
  const clean=api.normalizeCampaignProgress({...campaign,checkpoint:{...campaign.checkpoint,money:1e50,player:{...campaign.checkpoint.player,hp:-4,ammo:{light:Infinity,heavy:1e9},bonuses:JSON.parse('{"__proto__":9,"constructor":8,"damageMultiplier":2}')}}});
  equal(clean.checkpoint.money,1000000);equal(clean.checkpoint.player.hp,1);equal(clean.checkpoint.player.ammo.light,undefined);
  equal(clean.checkpoint.player.ammo.heavy,10000);ok(!Object.prototype.hasOwnProperty.call(clean.checkpoint.player.bonuses,'constructor'));
  const a=boot(disk).store,b=boot(disk).store;a.get('campaign');b.get('campaign');
  a.set('campaign',{unlocked:5,completed:[1,2,3,4],logs:['archive-a','archive-b'],checkpoint:null});
  b.set('campaign',{unlocked:3,completed:[1,2],logs:['archive-c'],checkpoint:campaign.checkpoint});
  const merged=JSON.parse(boot(disk).store.get('campaign'));equal(merged.unlocked,5);equal(merged.completed.join(','),'1,2,3,4');
  ok(['archive-a','archive-b','archive-c'].every(id=>merged.logs.includes(id)),'stale tab erased journals');
  equal(merged.checkpoint.missionId,3,'latest checkpoint choice did not persist');
}

console.log('RESULT_OK save/profile: ' + checks + ' assertions; schema 1-to-3 chain, removed pixel preference, campaign checkpoints/builds/unlocks, strict fields, backup/recovery, multi-tab merge');
