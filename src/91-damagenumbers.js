/* ========================================================================
   91-damagenumbers.js — floating damage readouts
   ======================================================================== */

/* Entirely cosmetic. Nothing here touches game.rng or changes a single number
   in the simulation, so turning it off cannot change how a fight goes — which
   is the whole reason it is allowed to be a setting at all.

   The one decision worth stating: a hit folds into the number already floating
   over the same target instead of opening a second one. A minigun lands twenty
   hits a second, and twenty separate numbers are a blizzard that hides the
   very thing they exist to show. One number that climbs answers the question
   the player actually asked — "is this thing taking damage, and how fast" —
   and it answers it in one place they can keep their eyes on. */

const DAMAGE_NUMBER_CAP = 18;
const DAMAGE_NUMBER_LIFE = 0.9;
/* How long a number stays open to being merged into. Longer than any weapon's
   fire interval, so sustained fire keeps one number; short enough that a
   deliberate second shot reads as a second hit. */
const DAMAGE_NUMBER_MERGE = 0.45;
const DAMAGE_NUMBER_RISE = 1.6;

class DamageNumbers {
  constructor(host) {
    this.enabled = true;
    this.list = [];
    this.host = host || null;
    this.nodes = [];
    if (!this.host || typeof document === 'undefined') return;
    // a fixed pool: creating and destroying nodes per hit would churn the DOM
    // dozens of times a second on a fast weapon
    for (let i = 0; i < DAMAGE_NUMBER_CAP; i++) {
      const node = document.createElement('div');
      node.className = 'dmgNum';
      node.style.display = 'none';
      this.host.appendChild(node);
      this.nodes.push(node);
    }
  }

  clear() {
    this.list.length = 0;
    for (const node of this.nodes) node.style.display = 'none';
  }

  /* A hit on a target that already has an open number adds to it and restarts
     its life, so the number stays up while the trigger is held. */
  add(targetId, amount, crit, x, y, z) {
    if (!this.enabled || !(amount > 0)) return null;
    for (let i = 0; i < this.list.length; i++) {
      const open = this.list[i];
      if (open.id === targetId && open.age < DAMAGE_NUMBER_MERGE) {
        open.amount += amount;
        open.crit = open.crit || !!crit;
        open.age = 0;
        open.x = x; open.y = y; open.z = z;
        return open;
      }
    }
    let slot;
    if (this.list.length < DAMAGE_NUMBER_CAP) {
      slot = {};
      this.list.push(slot);
    } else {
      // recycle the oldest: it is the one the player has already read
      slot = this.list[0];
      for (let i = 1; i < this.list.length; i++) {
        if (this.list[i].age > slot.age) slot = this.list[i];
      }
    }
    slot.id = targetId;
    slot.amount = amount;
    slot.crit = !!crit;
    slot.age = 0;
    slot.x = x; slot.y = y; slot.z = z;
    return slot;
  }

  /* Convenience for the two call sites that have an enemy in hand. */
  addFor(e, amount, crit) {
    if (!e) return null;
    return this.add(e.id, amount, crit, e.x, (e.y || 0) + (e.def ? e.def.radius : 1) + 0.5, e.z);
  }

  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      this.list[i].age += dt;
      if (this.list[i].age >= DAMAGE_NUMBER_LIFE) this.list.splice(i, 1);
    }
  }

  render(camera, point, width, height) {
    if (!this.nodes.length) return;
    const shown = Math.min(this.list.length, this.nodes.length);
    for (let i = 0; i < shown; i++) {
      const n = this.list[i];
      const node = this.nodes[i];
      const t = n.age / DAMAGE_NUMBER_LIFE;
      point.set(n.x, n.y + t * DAMAGE_NUMBER_RISE, n.z).project(camera);
      // behind the camera or off the edge: nothing useful to draw
      if (point.z > 1 || Math.abs(point.x) > 1.05 || Math.abs(point.y) > 1.05) {
        node.style.display = 'none';
        continue;
      }
      node.textContent = String(Math.round(n.amount));
      node.className = n.crit ? 'dmgNum crit' : 'dmgNum';
      node.style.left = ((point.x * 0.5 + 0.5) * width) + 'px';
      node.style.top = ((-point.y * 0.5 + 0.5) * height) + 'px';
      // fades over the back half of its life, so a fresh number is the bright one
      node.style.opacity = String(clamp(1 - (t - 0.45) / 0.55, 0, 1));
      node.style.display = 'block';
    }
    for (let i = shown; i < this.nodes.length; i++) this.nodes[i].style.display = 'none';
  }
}
