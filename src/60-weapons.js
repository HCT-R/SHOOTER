/* ========================================================================
   60-weapons.js — weapon and ammo data tables
   ======================================================================== */

/* How many weapons ride in the harness besides the sidearm. Carrying every
   gun at once is what made the shop weightless: a purchase was always an
   addition and never a choice. The pistol does not take a slot — a full
   arsenal must never be able to leave the marine unable to shoot. */
const ARSENAL_SLOTS = 3;

/* Selling is the release valve that makes the cap a decision instead of a
   wall. It is deliberately a loss: churning weapons for profit would be a
   better economy than fighting. */
const WEAPON_SELL_RATIO = 0.4;

const AMMO_TYPES = {
  none:   { name: 'N/A',      max: 0,    color: '#8b93a0' },
  shell:  { name: 'SHELLS',   max: 120,  color: '#e0913a' },
  smg:    { name: '9MM',      max: 600,  color: '#d8c84a' },
  rifle:  { name: '5.56',     max: 420,  color: '#8fd04a' },
  fuel:   { name: 'FUEL',     max: 500,  color: '#ff6a2a' },
  mini:   { name: '7.62',     max: 1200, color: '#c0c8d4' },
  rocket: { name: 'ROCKETS',  max: 24,   color: '#ff4a4a' },
  cell:   { name: 'CELLS',    max: 240,  color: '#64edff' },
  slug:   { name: 'SLUGS',    max: 80,   color: '#d990ff' },
  cannon: { name: '30 MM',    max: 240,  color: '#ffb45a' }
};

/* fire: 'hitscan' | 'spread' | 'projectile' | 'flame' | 'arc' | 'rail' */
/* crit: chance per enemy hit, critMult: damage factor. Splash weapons and the
   flamethrower stay out of the table on purpose: one roll per damage tick is
   noise, and a weapon without a chance never draws from the run RNG at all. */
const WEAPONS = [
  {
    id: 'pistol', name: 'M9 SIDEARM', short: 'M9', geo: 'pistol', sound: 'pistol',
    fire: 'hitscan', damage: 26, interval: 0.24, mag: 14, reload: 1.05,
    spread: 0.014, pellets: 1, range: 46, pierce: 0, ammo: 'none',
    recoil: 0.09, shake: 0.5, knock: 1.6, tracer: 0xffd88a, tracerW: 0.1,
    crit: 0.12, critMult: 2.2,
    muzzle: [0, 0.03, 0.44], auto: false
  },
  {
    id: 'shotgun', name: 'SPAS-12', short: 'SPAS', geo: 'shotgun', sound: 'shotgun',
    price: 260,
    fire: 'spread', damage: 17, interval: 0.68, mag: 8, reload: 0.72, shellReload: true, shellTime: 0.48,
    spread: 0.16, pellets: 9, range: 26, pierce: 1, ammo: 'shell',
    recoil: 0.42, shake: 3.2, knock: 9, tracer: 0xffc06a, tracerW: 0.14,
    crit: 0.06, critMult: 1.8,
    muzzle: [0, 0.04, 0.98], auto: false
  },
  {
    id: 'smg', name: 'MP7 SMG', short: 'MP7', geo: 'smg', sound: 'smg',
    price: 200,
    fire: 'hitscan', damage: 16, interval: 0.072, mag: 45, reload: 1.55,
    spread: 0.062, pellets: 1, range: 40, pierce: 0, ammo: 'smg',
    recoil: 0.07, shake: 0.55, knock: 1.1, tracer: 0xffe08a, tracerW: 0.085,
    crit: 0.06, critMult: 2,
    muzzle: [0, 0.03, 0.62], auto: true
  },
  {
    id: 'rifle', name: 'M4 CARBINE', short: 'M4', geo: 'rifle', sound: 'rifle',
    price: 380,
    fire: 'hitscan', damage: 34, interval: 0.105, mag: 30, reload: 1.85,
    spread: 0.028, pellets: 1, range: 58, pierce: 1, ammo: 'rifle',
    recoil: 0.12, shake: 0.95, knock: 2.4, tracer: 0xbfe8ff, tracerW: 0.09,
    crit: 0.1, critMult: 2,
    muzzle: [0, 0.02, 0.92], auto: true
  },
  {
    id: 'flamer', name: 'INFERNO', short: 'FLAME', geo: 'flamer', sound: 'flame',
    price: 520,
    fire: 'flame', damage: 82, interval: 0.045, mag: 100, reload: 2.6,
    spread: 0.19, pellets: 1, range: 10.5, pierce: 99, ammo: 'fuel',
    recoil: 0.02, shake: 0.35, knock: 0.5, burn: 4.5,
    muzzle: [0, 0.02, 0.86], auto: true
  },
  {
    id: 'minigun', name: 'M134 VULCAN', short: 'VULCAN', geo: 'minigun', sound: 'minigun',
    price: 780,
    fire: 'hitscan', damage: 22, interval: 0.042, mag: 220, reload: 4.2,
    spread: 0.085, pellets: 1, range: 52, pierce: 1, ammo: 'mini',
    recoil: 0.06, shake: 0.8, knock: 1.5, tracer: 0xfff0a0, tracerW: 0.1,
    crit: 0.05, critMult: 1.9,
    spinUp: 0.75, moveScale: 0.55,
    muzzle: [0, 0, 0.92], auto: true
  },
  {
    id: 'rocket', name: 'RPG-7', short: 'RPG', geo: 'rocket', sound: 'rocket',
    price: 880,
    fire: 'projectile', damage: 40, splash: 190, splashRadius: 6.5,
    interval: 1.15, mag: 4, reload: 3.2,
    spread: 0.01, pellets: 1, range: 80, ammo: 'rocket',
    recoil: 0.5, shake: 4.5, knock: 14, projSpeed: 34,
    muzzle: [0, 0.03, 0.9], auto: false
  },
  {
    id: 'plasma', name: 'ARC-9 PLASMA', short: 'ARC-9', geo: 'plasma', sound: 'plasma',
    price: 700,
    fire: 'arc', damage: 64, interval: 0.26, mag: 24, reload: 2.2,
    spread: 0.018, pellets: 1, range: 44, pierce: 0, ammo: 'cell',
    recoil: 0.16, shake: 1.2, knock: 3.4, tracer: 0x64edff, tracerW: 0.22,
    crit: 0.1, critMult: 2,
    chain: 2, chainRange: 5.6, chainFalloff: 0.68,
    muzzle: [0, 0.035, 1.02], auto: true
  },
  {
    id: 'railgun', name: 'HYPERION RAILGUN', short: 'RAIL', geo: 'railgun', sound: 'railgun',
    price: 1150,
    fire: 'rail', damage: 420, interval: 0.82, mag: 5, reload: 2.6,
    spread: 0.002, pellets: 1, range: 90, pierce: 8, ammo: 'slug',
    recoil: 0.38, shake: 3.4, knock: 12, tracer: 0xdf75ff, tracerW: 0.46,
    crit: 0.25, critMult: 2.5,
    muzzle: [0, 0.025, 1.25], auto: false
  },
  {
    id: 'autocannon', name: 'TITAN 30MM', short: 'TITAN', geo: 'autocannon', sound: 'autocannon',
    price: 960,
    fire: 'projectile', damage: 12, splash: 68, splashRadius: 2.5,
    interval: 0.16, mag: 36, reload: 3,
    spread: 0.032, pellets: 1, range: 80, ammo: 'cannon',
    recoil: 0.24, shake: 1.7, knock: 5, projSpeed: 64, projectileKind: 'shell',
    muzzle: [0, 0.025, 1.05], auto: true
  }
];

// Catalog additions reuse combat families, not model identities. Pure data is
// shared by the browser and authoritative Node simulation.
const ADDITIONAL_FIREARMS = [
  ['pistol', { id: 'revolver', name: 'R8 REVOLVER', short: 'R8', price: 340, damage: 68, interval: 0.48, mag: 6, reload: 2.1, ammo: 'slug', range: 48, spread: 0.009, recoil: 0.22, crit: 0.16, muzzle: [0, 0.03, 0.63], reloadStyle: 'cylinder' }],
  ['rifle', { id: 'burstRifle', name: 'BR-3 BURST RIFLE', short: 'BR-3', price: 490, damage: 25, interval: 0.38, burstCount: 3, burstInterval: 0.075, mag: 30, spread: 0.021, auto: false, muzzle: [0, 0.025, 0.99] }],
  ['rifle', { id: 'dmr', name: 'D7 MARKSMAN', short: 'D7', price: 610, damage: 76, interval: 0.36, mag: 15, reload: 2.25, spread: 0.006, range: 76, auto: false, recoil: 0.2, muzzle: [0, 0.025, 1.12] }],
  ['rifle', { id: 'sniper', name: 'S90 LONGSHOT', short: 'S90', price: 850, damage: 175, interval: 1.05, mag: 5, reload: 2.8, ammo: 'slug', spread: 0.001, range: 95, pierce: 2, auto: false, recoil: 0.34, crit: 0.2, muzzle: [0, 0.025, 1.36], reloadStyle: 'bolt' }],
  ['shotgun', { id: 'doubleBarrel', name: 'DB-2 BREAKER', short: 'DB-2', price: 410, damage: 23, interval: 0.3, mag: 2, reload: 1.8, shellReload: false, pellets: 10, spread: 0.21, range: 21, muzzle: [0, 0.04, 0.87], reloadStyle: 'break' }],
  ['shotgun', { id: 'autoShotgun', name: 'AS-12 RAIDER', short: 'AS-12', price: 750, damage: 13, interval: 0.23, mag: 12, reload: 2.55, shellReload: false, auto: true, pellets: 7, spread: 0.19, range: 23, muzzle: [0, 0.04, 0.94] }],
  ['smg', { id: 'suppressedSmg', name: 'V9 SPECTRE', short: 'V9', price: 420, damage: 19, interval: 0.086, mag: 30, reload: 1.6, spread: 0.035, suppressed: true, muzzle: [0, 0.03, 0.96] }],
  ['rifle', { id: 'lmg', name: 'LMG-60 SENTINEL', short: 'LMG-60', price: 680, damage: 27, interval: 0.095, mag: 80, ammo: 'mini', reload: 3.6, spread: 0.055, moveScale: 0.78, muzzle: [0, 0.025, 1.1], reloadStyle: 'belt' }],
  ['rocket', { id: 'grenadeLauncher', name: 'GL-6 BASTION', short: 'GL-6', price: 820, damage: 22, splash: 110, splashRadius: 4.3, interval: 0.8, mag: 6, reload: 3.1, ammo: 'grenade', projSpeed: 19, projectileKind: 'grenade', projGravity: 14, fuse: 1.25, bounce: 0.45, muzzle: [0, 0.035, 0.91], reloadStyle: 'cylinder' }],
  ['rifle', { id: 'crossbow', name: 'CB-1 SILENT ARC', short: 'CB-1', price: 590, fire: 'projectile', damage: 145, splash: 0, splashRadius: 0, interval: 0.85, mag: 1, reload: 1.05, ammo: 'bolt', projSpeed: 70, projectileKind: 'bolt', spread: 0.001, auto: false, recoil: 0.08, muzzle: [0, 0.035, 1.02], reloadStyle: 'bolt' }]
];
for (const [base, spec] of ADDITIONAL_FIREARMS) {
  WEAPONS.push(Object.assign({}, WEAPONS.find(w => w.id === base), spec, { geo: spec.id, sound: spec.id, slot: 'primary' }));
}
const MELEE_SPECS = [
  { id: 'knife', name: 'K1 COMBAT KNIFE', short: 'K1', price: 0, damage: 35, reach: 1.75, arc: 0.65, windup: 0.085, activeTime: 0.09, recovery: 0.23, knock: 1.5, maxTargets: 1, motion: 'thrust', heavy: { damage: 65, reach: 1.95, arc: 0.5, windup: 0.23, activeTime: 0.1, recovery: 0.36, knock: 3, maxTargets: 1 } },
  { id: 'machete', name: 'M8 MACHETE', short: 'M8', price: 300, damage: 49, reach: 2.2, arc: 1.65, windup: 0.16, activeTime: 0.14, recovery: 0.33, knock: 3, maxTargets: 3, motion: 'slash', heavy: { damage: 88, reach: 2.3, arc: 1.25, windup: 0.37, activeTime: 0.16, recovery: 0.46, knock: 6, maxTargets: 2 } },
  { id: 'axe', name: 'A4 BREACH AXE', short: 'A4', price: 470, damage: 75, reach: 2.1, arc: 1.05, windup: 0.26, activeTime: 0.12, recovery: 0.42, knock: 6, maxTargets: 2, motion: 'chop', heavy: { damage: 140, reach: 2.25, arc: 0.9, windup: 0.5, activeTime: 0.14, recovery: 0.62, knock: 10, maxTargets: 2 } },
  { id: 'spear', name: 'P3 TACTICAL SPEAR', short: 'P3', price: 510, damage: 58, reach: 3.2, arc: 0.48, windup: 0.21, activeTime: 0.1, recovery: 0.38, knock: 4, maxTargets: 1, motion: 'thrust', heavy: { damage: 104, reach: 3.65, arc: 0.4, windup: 0.43, activeTime: 0.13, recovery: 0.58, knock: 8, maxTargets: 2 } },
  { id: 'hammer', name: 'H2 SIEGE HAMMER', short: 'H2', price: 690, damage: 95, reach: 2.3, arc: 1.3, windup: 0.37, activeTime: 0.16, recovery: 0.58, knock: 10, maxTargets: 3, motion: 'chop', heavy: { damage: 175, reach: 2.55, arc: 1.5, windup: 0.65, activeTime: 0.2, recovery: 0.8, knock: 16, maxTargets: 4 } }
];
for (const spec of MELEE_SPECS) {
  WEAPONS.push(Object.assign({ geo: spec.id, sound: spec.id, fire: 'melee', slot: 'melee', usesAmmo: false,
    ammo: 'none', mag: 0, reload: 0, spread: 0, pellets: 1, pierce: 0, crit: 0, recoil: 0,
    shake: 0.6, auto: false, muzzle: [0, 0, spec.id === 'spear' ? 1.45 : 0.95] }, spec,
    { range: spec.reach, interval: spec.windup + spec.activeTime + spec.recovery }));
}
AMMO_TYPES.grenade = { name: '40 MM', max: 36, color: '#d0a677' };
AMMO_TYPES.bolt = { name: 'BOLTS', max: 72, color: '#9cc7b6' };

// Hand sockets are in raw geometry coordinates, before the shared 1.35 scale.
// hold positions are marine-local. Reload sockets sit at the actual magazine,
// fuel valve or loading port; the support hand follows that port during reload.
const WEAPON_POSES = {
  pistol: { hold: [0.13, 1.3, 0.42], grip: [0, -0.13, 0], support: [-0.075, -0.12, 0.015], reload: [-0.025, -0.22, 0] },
  shotgun: { hold: [0.27, 1.36, 0.437], grip: [0, -0.14, -0.02], support: [-0.07, -0.075, 0.145], reload: [-0.06, -0.08, 0.09] },
  smg: { hold: [0.27, 1.34, 0.49], grip: [0, -0.13, -0.06], support: [-0.07, -0.11, 0.12], reload: [-0.02, -0.27, 0.06] },
  rifle: { hold: [0.27, 1.37, 0.49], grip: [0, -0.12, -0.06], support: [-0.07, -0.1, 0.12], reload: [-0.025, -0.235, 0.12] },
  flamer: { hold: [0.25, 1.16, 0.395], grip: [0, -0.14, 0.02], support: [-0.12, -0.15, 0.15], reload: [-0.12, 0.1, 0.03], heavy: true },
  minigun: { hold: [0.25, 1.08, 0.49], grip: [0, -0.18, -0.06], support: [-0.03, 0.18, 0.12], reload: [-0.2, -0.03, 0.04], supportRoll: Math.PI / 2, heavy: true },
  rocket: { hold: [0.43, 1.51, 0.437], grip: [0, -0.14, -0.02], support: [-0.11, -0.1, 0.12], reload: [-0.1, 0.035, -0.1], supportRoll: Math.PI / 2 },
  plasma: { hold: [0.27, 1.3, 0.405], grip: [0, -0.18, 0.03], support: [-0.07, -0.12, 0.16], reload: [-0.08, -0.16, 0.18] },
  railgun: { hold: [0.27, 1.36, 0.46], grip: [0, -0.19, 0.02], support: [-0.075, -0.1, 0.145], reload: [-0.12, -0.015, 0.1] },
  autocannon: { hold: [0.27, 1.24, 0.415], grip: [0, -0.23, 0], support: [-0.08, -0.18, 0.13], reload: [-0.31, -0.035, 0.23], heavy: true }
};

for (const [base, spec] of ADDITIONAL_FIREARMS) {
  WEAPON_POSES[spec.id] = Object.assign({}, WEAPON_POSES[base]);
}
// Presentation poses: weapon translation/rotation, then torso rotation and
// forward lean. Timings always come from the existing combat specification.
const MELEE_PRESENTATION = {
  knife: { hold: [0.29, 1.27, 0.46], ready: [-0.12, -0.16, -0.12],
    light: [[0.06, 0.09, -0.12, -0.35, -0.3, -0.18, -0.04, -0.13, -0.04, 0], [-0.03, -0.02, 0.2, 0.12, 0.1, 0.1, 0.12, 0.12, 0.02, 0.07]],
    heavy: [[0.08, 0.14, -0.15, -0.6, -0.5, -0.35, -0.08, -0.22, -0.06, 0], [-0.02, -0.025, 0.22, 0.14, 0.18, 0.14, 0.16, 0.16, 0.03, 0.09]] },
  machete: { hold: [0.27, 1.28, 0.45], ready: [-0.16, -0.15, -0.18],
    light: [[0.06, 0.1, -0.08, -0.22, -0.85, -0.15, -0.035, -0.23, -0.04, 0], [-0.11, -0.04, 0.025, 0.14, 1, 0.24, 0.08, 0.27, 0.045, 0.06]],
    heavy: [[0.1, 0.16, -0.1, -0.6, -1, -0.34, -0.07, -0.32, -0.06, 0], [-0.13, -0.055, 0.035, 0.26, 1.12, 0.38, 0.13, 0.34, 0.06, 0.08]] },
  axe: { hold: [0.28, 1.29, 0.45], ready: [-0.38, -0.16, -0.12],
    light: [[0.03, 0.14, -0.07, -0.95, -0.22, -0.3, -0.09, -0.15, -0.045, 0], [-0.055, -0.06, 0.08, 0.95, 0.2, 0.25, 0.15, 0.18, 0.045, 0.065]],
    heavy: [[0.025, 0.2, -0.08, -1.14, -0.32, -0.4, -0.13, -0.22, -0.06, 0], [-0.08, -0.1, 0.08, 1.16, 0.26, 0.36, 0.19, 0.22, 0.06, 0.085]] },
  spear: { hold: [0.11, 1.27, 0.42], ready: [-0.08, -0.08, 0.035],
    light: [[0.045, 0.045, -0.13, -0.1, -0.12, -0.06, -0.045, -0.14, -0.025, 0], [-0.025, -0.015, 0.13, 0.055, 0.085, 0.06, 0.115, 0.11, 0.02, 0.075]],
    heavy: [[0.055, 0.085, -0.19, -0.18, -0.22, -0.09, -0.08, -0.23, -0.04, 0], [-0.035, -0.025, 0.145, 0.07, 0.13, 0.085, 0.15, 0.17, 0.025, 0.1]] },
  hammer: { hold: [0.1, 1.26, 0.43], ready: [-0.3, -0.08, -0.02],
    light: [[0.05, 0.14, -0.1, -0.88, -0.24, -0.12, -0.1, -0.18, -0.035, 0], [-0.025, -0.065, 0.06, 0.91, 0.2, 0.13, 0.16, 0.18, 0.04, 0.07]],
    heavy: [[0.045, 0.19, -0.12, -1.18, -0.32, -0.2, -0.145, -0.25, -0.05, 0], [-0.04, -0.1, 0.075, 1.15, 0.28, 0.21, 0.21, 0.24, 0.06, 0.09]] }
};
for (const weapon of MELEE_SPECS) {
  const twoHanded = weapon.id === 'spear' || weapon.id === 'hammer';
  const presentation = MELEE_PRESENTATION[weapon.id];
  WEAPON_POSES[weapon.id] = { hold: presentation.hold, grip: [0, -0.12, 0],
    support: [-0.07, -0.08, 0.14], reload: [-0.07, -0.08, 0.14], heavy: twoHanded,
    oneHanded: !twoHanded, melee: true, presentation };
}

const WEAPON_BY_ID = {};
for (let i = 0; i < WEAPONS.length; i++) {
  WEAPONS[i].pose = WEAPON_POSES[WEAPONS[i].id];
  if (!WEAPONS[i].slot) WEAPONS[i].slot = WEAPONS[i].id === 'pistol' ? 'sidearm' : 'primary';
  if (WEAPONS[i].usesAmmo === undefined) WEAPONS[i].usesAmmo = true;
  WEAPON_BY_ID[WEAPONS[i].id] = WEAPONS[i];
}

/* ammo granted by one pickup crate of each type */
const AMMO_PICKUP = {
  shell: 24, smg: 120, rifle: 90, fuel: 120, mini: 300, rocket: 4, cell: 60, slug: 20, cannon: 72, grenade: 6, bolt: 18
};

/* The wave from which a weapon may appear in the shop. Weapons are bought,
   not handed out, so this is a pacing gate and not a delivery schedule: it
   keeps the railgun out of the first shop without deciding what the player
   ends up carrying. The pistol and the starting SMG are not listed. */
const WEAPON_UNLOCK = [
  { id: 'shotgun', wave: 1 },
  { id: 'smg', wave: 2 },
  { id: 'rifle', wave: 2 },
  { id: 'flamer', wave: 3 },
  { id: 'minigun', wave: 5 },
  { id: 'plasma', wave: 6 },
  { id: 'rocket', wave: 7 },
  { id: 'railgun', wave: 8 },
  { id: 'autocannon', wave: 9 }
];

const EXTRA_UNLOCKS = { revolver: 1, burstRifle: 2, dmr: 3, sniper: 5, doubleBarrel: 1,
  autoShotgun: 4, suppressedSmg: 2, lmg: 4, grenadeLauncher: 6, crossbow: 3,
  machete: 1, axe: 3, spear: 2, hammer: 5 };
for (const id of Object.keys(EXTRA_UNLOCKS)) WEAPON_UNLOCK.push({ id, wave: EXTRA_UNLOCKS[id] });
const ProtocolWeapons = { WEAPONS, WEAPON_BY_ID, WEAPON_POSES, AMMO_TYPES, AMMO_PICKUP,
  WEAPON_UNLOCK, ARSENAL_SLOTS, WEAPON_SELL_RATIO };
if (typeof globalThis !== 'undefined') globalThis.ProtocolWeapons = ProtocolWeapons;
if (typeof module !== 'undefined' && module.exports) module.exports = ProtocolWeapons;
