/* Field requisitions are run-local. Prices and caps are shared by UI and game. */
const FIELD_UPGRADES = [
  { id: 'damage', title: 'УСИЛИТЕЛЬ УРОНА', icon: '↗', desc: '+15% урона всем оружием', cost: 220, step: 150, max: 4 },
  { id: 'reload', title: 'БЫСТРЫЕ МАГАЗИНЫ', icon: '↻', desc: 'Перезарядка на 12% быстрее', cost: 180, step: 120, max: 3 },
  { id: 'vitality', title: 'БИОУСИЛЕНИЕ', icon: '+', desc: '+25 максимального здоровья и лечение', cost: 200, step: 130, max: 4 },
  { id: 'armor', title: 'КОМПОЗИТНАЯ БРОНЯ', icon: '◇', desc: '+25 к пределу брони, восстановление брони', cost: 160, step: 110, max: 4 },
  { id: 'supply', title: 'БОЕПРИПАСЫ', icon: '≡', desc: 'Боезапас для всего доступного оружия', cost: 100, step: 0, max: Infinity },
  { id: 'medkit', title: 'ПОЛЕВАЯ АПТЕЧКА', icon: '✚', desc: 'Восстановить 60 здоровья', cost: 80, step: 0, max: Infinity }
];

const WAVE_EVENTS = [
  { name: 'КОНТАКТ', desc: 'Зачистите сектор', hp: 1, speed: 1, budget: 1 },
  { name: 'РОЙ', desc: 'Быстрые цели • держите дистанцию', hp: 0.85, speed: 1.18, budget: 1.15 },
  { name: 'ПРОРЫВ', desc: 'Больше противников • используйте гранаты', hp: 1, speed: 1, budget: 1.25 },
  { name: 'БРОНЕПАНЦИРЬ', desc: 'Усиленные цели • цельтесь точно', hp: 1.3, speed: 0.9, budget: 0.85 }
];

/* ------------------------------------------------------------------ perks */
/* Perks are the run's build. Unlike requisitions they cost nothing, are
   offered as a choice of three after every wave, and are the only thing that
   makes the second run of a sector play differently from the first.

   tags carry the synergy. A tag is not a stat: it is a label the offer reads,
   so a perk can demand that the build already leans a certain way before it
   shows up at all. That is what turns a pile of percentages into a build.

   apply(game) mutates the player directly, exactly like buyUpgrade does. Ranks
   live in game.perks so the offer can cap them and the HUD can show them. */
const PERK_TAGS = {
  fire: 'ОГОНЬ', shock: 'ЭЛЕКТРИЧЕСТВО', blast: 'ВЗРЫВ',
  pierce: 'ПРОБИТИЕ', crit: 'КРИТ', body: 'ТЕЛО'
};

/* Weights are drawn without replacement, so an offer of three is a sample of
   the pool and not three independent rolls. */
const PERK_RARITY = {
  common: { label: 'ОБЫЧНЫЙ', weight: 62, color: '#8fd8c8' },
  rare: { label: 'РЕДКИЙ', weight: 30, color: '#8fd8ff' },
  epic: { label: 'ЭПИЧЕСКИЙ', weight: 8, color: '#c7a3ff' }
};

const PERKS = [
  {
    id: 'overcharge', title: 'ПЕРЕГРУЗКА СТВОЛА', icon: '↑', rarity: 'common', max: 4,
    tags: [], desc: '+12% урона всем оружием',
    apply: (g) => { g.player.damageMultiplier *= 1.12; }
  },
  {
    id: 'quickhands', title: 'БЫСТРЫЕ РУКИ', icon: '↻', rarity: 'common', max: 3,
    tags: [], desc: 'Перезарядка на 12% быстрее',
    apply: (g) => { g.player.reloadMultiplier *= 0.88; }
  },
  {
    id: 'optics', title: 'КАЛИБРОВКА ПРИЦЕЛА', icon: '⊕', rarity: 'common', max: 4,
    tags: ['crit'], desc: '+40% к шансу критического попадания',
    apply: (g) => { g.player.critScale *= 1.4; }
  },
  {
    id: 'hollowpoint', title: 'РАЗРЫВНЫЕ СЕРДЕЧНИКИ', icon: '✳', rarity: 'rare', max: 3,
    tags: ['crit'], desc: 'Критический урон на 35% выше',
    apply: (g) => { g.player.critPower *= 1.35; }
  },
  {
    id: 'stabilizer', title: 'СТАБИЛИЗАТОР', icon: '⌖', rarity: 'common', max: 3,
    tags: [], desc: 'Разброс меньше на 22%',
    apply: (g) => { g.player.spreadScale *= 0.78; }
  },
  {
    id: 'bioframe', title: 'БИОКАРКАС', icon: '✚', rarity: 'common', max: 4,
    tags: ['body'], desc: '+30 максимального здоровья и лечение',
    apply: (g) => { g.player.maxHp += 30; g.player.heal(30); }
  },
  {
    id: 'composite', title: 'КОМПОЗИТНЫЕ ПЛАСТИНЫ', icon: '◇', rarity: 'common', max: 4,
    tags: ['body'], desc: '+30 к пределу брони и полное восстановление',
    apply: (g) => { g.player.maxArmor += 30; g.player.armor = g.player.maxArmor; }
  },
  {
    id: 'lightstep', title: 'ЛЁГКИЙ ХОД', icon: '»', rarity: 'common', max: 3,
    tags: ['body'], desc: 'Скорость передвижения выше на 10%',
    apply: (g) => { g.player.speedScale *= 1.1; }
  },
  {
    id: 'capacitor', title: 'КОНДЕНСАТОР РЫВКА', icon: '⇥', rarity: 'rare', max: 3,
    tags: ['body', 'shock'], desc: 'Откат рывка короче на 28%',
    apply: (g) => { g.player.dashCooldown *= 0.72; }
  },
  {
    id: 'thermite', title: 'ТЕРМИТНАЯ СМЕСЬ', icon: '≈', rarity: 'common', max: 3,
    tags: ['fire'], desc: 'Горение наносит на 60% больше урона',
    apply: (g) => { g.player.burnScale *= 1.6; }
  },
  {
    id: 'hedetonator', title: 'ФУГАСНЫЙ ЗАРЯД', icon: '✺', rarity: 'rare', max: 3,
    tags: ['blast'], desc: 'Урон и радиус взрывов выше на 25%',
    apply: (g) => { g.player.splashScale *= 1.25; }
  },
  {
    id: 'bandolier', title: 'ЛИШНИЙ ПОДСУМОК', icon: '◉', rarity: 'common', max: 3,
    tags: ['blast'], desc: 'Откат гранаты короче на 25%',
    apply: (g) => { g.player.grenadeCooldown *= 0.75; }
  },
  {
    id: 'conductor', title: 'ПРОВОДНИК', icon: '⌁', rarity: 'rare', max: 2,
    tags: ['shock'], desc: 'Разряд ARC-9 перескакивает на одну цель больше',
    apply: (g) => { g.player.chainBonus += 1; }
  },
  {
    id: 'apcore', title: 'БРОНЕБОЙНЫЕ СЕРДЕЧНИКИ', icon: '→', rarity: 'rare', max: 2,
    tags: ['pierce'], desc: 'Лучевое оружие пробивает на одну цель больше',
    apply: (g) => { g.player.pierceBonus += 1; }
  },
  {
    /* The payoff perk the whole tag system exists for: it is invisible until
       the build actually carries both halves of the combination. */
    id: 'arcburn', title: 'ЦЕПНОЙ ОЖОГ', icon: '⚡', rarity: 'epic', max: 1,
    tags: ['fire', 'shock'], requires: { fire: 1, shock: 1 },
    desc: 'Попадание по горящему врагу бьёт разрядом по ближайшей цели',
    apply: (g) => { g.player.burnChains = true; }
  }
];

const PERK_BY_ID = {};
for (const perk of PERKS) PERK_BY_ID[perk.id] = perk;

/* Ranks of every perk carrying the tag. Offers read this, not the player's
   stats, so a requirement stays readable no matter how the effect is wired. */
function perkTagCount(ranks, tag) {
  let total = 0;
  for (const perk of PERKS) {
    if (perk.tags.indexOf(tag) >= 0) total += ranks[perk.id] || 0;
  }
  return total;
}

function perkAvailable(perk, ranks) {
  if ((ranks[perk.id] || 0) >= perk.max) return false;
  if (!perk.requires) return true;
  for (const tag of Object.keys(perk.requires)) {
    if (perkTagCount(ranks, tag) < perk.requires[tag]) return false;
  }
  return true;
}

/* Weighted draw without replacement. rng is the run generator, so the same
   seed and the same picks always produce the same offers. */
function rollPerkOffer(ranks, rng, count) {
  const pool = PERKS.filter((perk) => perkAvailable(perk, ranks));
  const offer = [];
  while (offer.length < count && pool.length) {
    let total = 0;
    for (const perk of pool) total += PERK_RARITY[perk.rarity].weight;
    let roll = rng() * total;
    let index = pool.length - 1;
    for (let i = 0; i < pool.length; i++) {
      roll -= PERK_RARITY[pool[i].rarity].weight;
      if (roll <= 0) { index = i; break; }
    }
    offer.push(pool[index]);
    pool.splice(index, 1);
  }
  return offer;
}

/* --------------------------------------------------- meta-progression */
/* Station upgrades are bought with alien samples between runs and never
   expire. They are the reason to start a second run after losing the first,
   so they change the opening of a run rather than its ceiling: a stronger
   start, never a bigger multiplier that trivialises the late waves.

   Ranks live in the profile, so this table is a save format. Ids must stay
   stable, and a cap may only grow — shrinking one silently voids ranks a
   player already paid for. */
const META_UPGRADES = [
  {
    id: 'reserves', title: 'РЕЗЕРВЫ СТАНЦИИ', icon: '✚', max: 5, cost: 40, step: 35,
    desc: '+15 стартового здоровья за уровень',
    apply: (player, rank) => { player.maxHp += 15 * rank; player.hp = player.maxHp; }
  },
  {
    id: 'plating', title: 'НАКЛАДНЫЕ ПЛАСТИНЫ', icon: '◇', max: 5, cost: 45, step: 40,
    desc: '+12 стартовой брони за уровень',
    apply: (player, rank) => { player.addArmor(12 * rank); }
  },
  {
    id: 'stipend', title: 'ОПЕРАТИВНЫЙ ФОНД', icon: '¤', max: 4, cost: 50, step: 45,
    desc: '+60 стартовых кредитов за уровень',
    apply: (player, rank, game) => { game.money += 60 * rank; }
  },
  {
    id: 'sidearm', title: 'ЛИЧНЫЙ АРСЕНАЛ', icon: '⌁', max: 3, cost: 80, step: 70,
    desc: 'Дополнительный ствол в стартовом наборе за уровень',
    apply: (player, rank) => {
      for (const id of ['shotgun', 'rifle', 'plasma'].slice(0, rank)) {
        player.giveWeapon(id);
        const ammo = WEAPON_BY_ID[id].ammo;
        if (ammo !== 'none') player.giveAmmo(ammo, AMMO_PICKUP[ammo] * 2);
      }
    }
  },
  {
    id: 'harvest', title: 'СБОР ОБРАЗЦОВ', icon: '≡', max: 4, cost: 60, step: 55,
    desc: '+20% образцов за забег за уровень',
    apply: (player, rank, game) => { game.sampleRate += 0.2 * rank; }
  },
  {
    id: 'doctrine', title: 'АРХИВ ДОКТРИН', icon: '⊕', max: 1, cost: 150, step: 0,
    desc: 'Предложение усилений даёт четыре карточки вместо трёх',
    apply: (player, rank, game) => { game.perkOfferBonus += rank; }
  }
];

const META_BY_ID = {};
for (const upgrade of META_UPGRADES) META_BY_ID[upgrade.id] = upgrade;

/* Price of moving from one rank to the next. A rank at the cap has no price
   at all rather than an ever-growing one, so callers compare against a real
   number instead of special-casing the ceiling. */
function metaCost(def, rank) {
  if (!def || rank >= def.max) return Infinity;
  return def.cost + def.step * rank;
}

/* The profile is player-writable text, so ranks are clamped on the way in.
   Unknown ids are dropped rather than preserved: keeping them would let a
   stale or hand-edited save resurrect content that no longer exists. */
function clampMetaRanks(value) {
  const out = {};
  if (!value || typeof value !== 'object') return out;
  for (const upgrade of META_UPGRADES) {
    const raw = value[upgrade.id];
    const n = typeof raw === 'string' ? Number(raw) : raw;
    if (typeof n !== 'number' || !Number.isFinite(n)) continue;
    const rank = Math.floor(n);
    if (rank > 0) out[upgrade.id] = Math.min(rank, upgrade.max);
  }
  return out;
}

/* Total samples already sunk into a build of ranks. The station refunds
   nothing, so this is only ever used to show progress. */
function metaInvested(ranks) {
  let total = 0;
  for (const upgrade of META_UPGRADES) {
    const rank = (ranks || {})[upgrade.id] || 0;
    for (let i = 0; i < rank; i++) total += metaCost(upgrade, i);
  }
  return total;
}

/* ------------------------------------------------------------- shop stock */
/* Requisitions used to be a fixed menu and weapons arrived on their own at
   set waves. Both are gone: the shop now rolls a small, random stock after
   every wave, and a weapon is something you decide to buy instead of
   something the game decides to hand you.

   The stock is the decision surface, so it stays small. Four slots, a reroll
   that costs more each time you use it, and a lock that protects a slot you
   want but cannot afford yet — that is the whole grammar. */
const SHOP_SLOTS = 4;
const SHOP_REROLL_BASE = 55;
const SHOP_REROLL_STEP = 45;

/* Rerolling is priced per visit, not per run: walking away and coming back
   after the next wave resets it. Otherwise the twentieth shop is unusable. */
function shopRerollCost(rerolls) {
  return SHOP_REROLL_BASE + SHOP_REROLL_STEP * Math.max(0, rerolls | 0);
}

/* Everything the shop could offer right now, already priced. Owned weapons,
   capped upgrades and weapons the wave gate has not reached yet are simply
   absent — an offer the player cannot use is a wasted slot, not a choice. */
function shopCandidates(context) {
  const out = [];
  const owned = context.owned || {};
  const upgrades = context.upgrades || {};
  const wave = context.wave || 1;

  for (const unlock of WEAPON_UNLOCK) {
    if (wave < unlock.wave || owned[unlock.id]) continue;
    const weapon = WEAPON_BY_ID[unlock.id];
    if (!weapon || !weapon.price) continue;
    out.push({ kind: 'weapon', id: unlock.id, price: weapon.price, weight: 26 });
  }

  for (const def of FIELD_UPGRADES) {
    const rank = upgrades[def.id] || 0;
    if (rank >= def.max) continue;
    out.push({ kind: 'upgrade', id: def.id, price: def.cost + def.step * rank, weight: 34 });
  }

  return out;
}

/* Weighted draw without replacement, like the perk offer: a shop of four is a
   sample of what is available, so the same item never fills two slots. Locked
   slots are passed in as `keep` and their ids are excluded from the draw. */
function rollShopStock(context, rng, slots, keep) {
  const held = keep || [];
  const taken = {};
  let want = 0;
  // keep is indexed by slot, so a hole is a slot to fill and not a short array
  for (let i = 0; i < slots; i++) {
    const kept = held[i];
    if (kept && kept.id) taken[kept.kind + ':' + kept.id] = true;
    else want++;
  }

  const pool = shopCandidates(context).filter((item) => !taken[item.kind + ':' + item.id]);
  const rolled = [];
  while (rolled.length < want && pool.length) {
    let total = 0;
    for (const item of pool) total += item.weight;
    let roll = rng() * total;
    let index = pool.length - 1;
    for (let i = 0; i < pool.length; i++) {
      roll -= pool[i].weight;
      if (roll <= 0) { index = i; break; }
    }
    const item = pool[index];
    rolled.push({ kind: item.kind, id: item.id, price: item.price, locked: false, sold: false });
    pool.splice(index, 1);
  }

  /* Locked slots keep their position so the shop does not reshuffle under the
     player's cursor between rerolls. */
  const out = [];
  let next = 0;
  for (let i = 0; i < slots; i++) {
    const kept = held[i];
    if (kept && kept.id) { out.push(kept); continue; }
    out.push(next < rolled.length ? rolled[next++] : null);
  }
  return out;
}
