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

const WEAPON_BY_ID = {};
for (let i = 0; i < WEAPONS.length; i++) {
  WEAPONS[i].pose = WEAPON_POSES[WEAPONS[i].id];
  WEAPON_BY_ID[WEAPONS[i].id] = WEAPONS[i];
}

/* ammo granted by one pickup crate of each type */
const AMMO_PICKUP = {
  shell: 24, smg: 120, rifle: 90, fuel: 120, mini: 300, rocket: 4, cell: 60, slug: 20, cannon: 72
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
