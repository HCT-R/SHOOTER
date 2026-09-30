/* Versioned, browser-local profile. Legacy keys remain untouched.
   Holds settings, appearance, records and meta-progression. No active run
   and no Steam Cloud data is stored here. */
const PROFILE_KEY = 'pixel_protocol_profile';
const PROFILE_BACKUP_KEY = PROFILE_KEY + '_backup';
const PROFILE_RECOVERY_KEY = PROFILE_KEY + '_recovery';
const PROFILE_SCHEMA_VERSION = 2;

/* Upgrade steps, applied in order: each takes the parsed object at version n
   and returns it at version n + 1. A step only has to move or reinterpret
   data — parse() rebuilds every known field from scratch afterwards and
   defaults whatever is missing, so a purely additive version needs no work
   beyond the version stamp. Dropping a step here is what silently destroys
   a player's profile, so the chain must stay complete forever. */
const PROFILE_MIGRATIONS = {
  // 1 -> 2: meta-progression added; samples and runs simply default to zero
  1: (value) => { value.schemaVersion = 2; return value; }
};

function parseProfileBoolean(value, fallback) {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  if (typeof value === 'string') {
    const text = value.trim().toLowerCase();
    if (text === 'true' || text === '1') return true;
    if (text === 'false' || text === '0') return false;
  }
  return fallback;
}

function createProfileStore(storageProvider, appearanceNormalizer) {
  const provideStorage = storageProvider || (() => window.localStorage);
  const keys = ['look', 'meta', 'binds', 'best', 'samples', 'runs', 'music', 'volume', 'motion', 'pixels', 'dmgnum'];
  /* Settings that are strictly true or false. The list is shared by the
     validator and the reader on purpose: they used to be two separate
     conditions, and a key added to one but not the other is silently
     unwritable — the profile rejects everything it has no rule for, which is
     the right default and a quiet failure when you forget. */
  const BOOLEAN_KEYS = ['music', 'motion', 'dmgnum'];
  const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
  const empty = () => ({ schemaVersion: PROFILE_SCHEMA_VERSION, settings: {}, appearance: null,
    records: {}, progression: {}, controls: {} });
  const copy = (value) => JSON.parse(JSON.stringify(value));
  let profile = empty(), initialized = false, baseRaw = null;
  let persistence = 'uninitialized', reason = null, activeKey = PROFILE_KEY;
  const pending = new Map();

  const canonical = (key) => {
    if (typeof key !== 'string') return null;
    const name = key.replace(/^(?:as3d_|pixel_protocol_)/, '');
    return keys.indexOf(name) >= 0 ? name : null;
  };
  const number = (value) => {
    if (typeof value !== 'number' && typeof value !== 'string') return undefined;
    if (typeof value === 'string' && value.trim() === '') return undefined;
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  };
  const appearance = (value) => {
    if (!record(value)) return undefined;
    // The profile is loaded lazily, after the appearance schema is available.
    // An isolated store can also be used by migration tools without Three.js.
    const normalize = appearanceNormalizer || (typeof clampLook === 'function' ? clampLook : null);
    if (normalize) return copy(normalize(value));
    const out = {};
    for (const key of ['nickname', 'skin', 'hairStyle', 'hairColor', 'jacket', 'pants',
      'vest', 'vestColor', 'helmet', 'shoulders', 'backpack', 'accent']) {
      if (!has(value, key)) continue;
      const field = value[key];
      if (key === 'vest' || key === 'backpack') out[key] = parseProfileBoolean(field, true);
      else if (typeof field === 'string') out[key] = field.slice(0, 100);
      else if (typeof field === 'number' && Number.isFinite(field)) out[key] = field;
    }
    return out;
  };
  /* Station ranks are a map, not a scalar, so they get the same treatment as
     the appearance: parsed if they arrive as text and clamped by the owning
     table. The clamp lives in 92-upgrades.js, which loads after this file but
     long before any profile is read. */
  const meta = (value) => {
    if (typeof value === 'string') {
      try { value = JSON.parse(value); } catch (error) { return undefined; }
    }
    if (!record(value)) return undefined;
    if (typeof clampMetaRanks === 'function') return clampMetaRanks(value);
    const out = {};
    for (const key of Object.keys(value)) {
      const n = Number(value[key]);
      if (Number.isFinite(n) && n > 0) out[key] = Math.floor(n);
    }
    return out;
  };
  /* Key bindings are a map of action id to key codes. Like the appearance
     and the station ranks they are clamped by the table that owns them,
     which lives in a file loaded after this one but long before any
     profile is read. */
  const binds = (value) => {
    if (typeof value === 'string') {
      try { value = JSON.parse(value); } catch (error) { return undefined; }
    }
    if (!record(value)) return undefined;
    return typeof clampBinds === 'function' ? clampBinds(value) : copy(value);
  };
  const normalize = (key, value) => {
    if (key === 'binds') return binds(value);
    if (key === 'meta') return meta(value);
    if (key === 'look') {
      if (typeof value === 'string') {
        try { value = JSON.parse(value); } catch (error) { return undefined; }
      }
      return appearance(value);
    }
    if (BOOLEAN_KEYS.indexOf(key) >= 0) return parseProfileBoolean(value, undefined);
    const n = number(value);
    if (n === undefined) return undefined;
    if (key === 'best' || key === 'samples' || key === 'runs') {
      return n >= 0 && n <= Number.MAX_SAFE_INTEGER ? Math.floor(n) : undefined;
    }
    if (key === 'volume') return n >= 0 && n <= 100 ? n : undefined;
    if (key === 'pixels') return [0, 2, 3, 4, 6].indexOf(n) >= 0 ? n : undefined;
    return undefined;
  };
  const apply = (target, key, value) => {
    if (key === 'look') target.appearance = copy(value);
    else if (key === 'meta') target.progression = copy(value);
    else if (key === 'binds') target.controls = copy(value);
    // records that only ever climb merge with max, so a stale tab cannot roll
    // them back; samples is spendable and therefore a plain assignment
    else if (key === 'best' || key === 'runs') target.records[key] = Math.max(target.records[key] || 0, value);
    else if (key === 'samples') target.records.samples = value;
    else target.settings[key] = value;
  };
  const RECORD_KEYS = ['best', 'samples', 'runs'];
  const readValue = (target, key) => key === 'look' ? target.appearance
    : key === 'meta' ? target.progression
    : key === 'binds' ? target.controls
    : RECORD_KEYS.indexOf(key) >= 0 ? target.records[key] : target.settings[key];

  const parse = (raw) => {
    if (raw === null || raw === undefined) return { kind: 'missing' };
    let value;
    try { value = JSON.parse(raw); } catch (error) { return { kind: 'corrupt' }; }
    if (!record(value)) return { kind: 'corrupt' };
    if (Number.isInteger(value.schemaVersion) && value.schemaVersion > PROFILE_SCHEMA_VERSION) return { kind: 'future' };
    let migrated = false;
    while (Number.isInteger(value.schemaVersion) && value.schemaVersion < PROFILE_SCHEMA_VERSION) {
      const step = PROFILE_MIGRATIONS[value.schemaVersion];
      // an unknown older version is not recoverable; treat it like corruption
      // rather than guessing at the shape of data nobody described
      if (!step) return { kind: 'corrupt' };
      const before = value.schemaVersion;
      value = step(value);
      if (!record(value) || !(value.schemaVersion > before)) return { kind: 'corrupt' };
      migrated = true;
    }
    if (value.schemaVersion !== PROFILE_SCHEMA_VERSION) return { kind: 'corrupt' };
    if ((has(value, 'settings') && !record(value.settings)) ||
        (has(value, 'records') && !record(value.records)) ||
        (has(value, 'progression') && !record(value.progression)) ||
        (has(value, 'controls') && !record(value.controls)) ||
        (value.appearance !== undefined && value.appearance !== null && !record(value.appearance))) {
      return { kind: 'corrupt' };
    }
    const result = empty();
    let repaired = false;
    for (const key of keys) {
      const source = key === 'look' ? value.appearance
        : key === 'meta' ? value.progression
        : key === 'binds' ? value.controls
        : RECORD_KEYS.indexOf(key) >= 0 ? (value.records || {})[key]
        : (value.settings || {})[key];
      if (source === undefined ||
        ((key === 'look' || key === 'meta' || key === 'binds') && source === null)) continue;
      const clean = normalize(key, source);
      if (clean === undefined) { repaired = true; continue; }
      apply(result, key, clean);
      if (JSON.stringify(clean) !== JSON.stringify(source)) repaired = true;
    }
    // a migrated profile must be rewritten even when nothing else changed,
    // otherwise the old bytes stay on disk and migrate again on every launch
    return { kind: 'supported', profile: result, repaired: repaired || migrated, migrated: migrated };
  };

  const legacy = (storage) => {
    const migrated = empty();
    for (const key of keys) {
      for (const prefix of ['pixel_protocol_', 'as3d_']) {
        const raw = storage.getItem(prefix + key);
        if (raw === null) continue;
        const value = normalize(key, raw);
        if (value === undefined) continue;
        apply(migrated, key, value);
        break;
      }
    }
    return migrated;
  };

  function flush() {
    ensure();
    try {
      const storage = provideStorage();
      const raw = storage.getItem(PROFILE_KEY), current = parse(raw);
      const protectedMain = current.kind === 'future' || current.kind === 'corrupt';
      activeKey = protectedMain ? PROFILE_RECOVERY_KEY : PROFILE_KEY;
      const targetRaw = protectedMain ? storage.getItem(activeKey) : raw;
      const target = protectedMain ? parse(targetRaw) : current;
      if (target.kind === 'future' || target.kind === 'corrupt') {
        persistence = 'memory'; reason = 'recovery-profile-protected'; return false;
      }
      // Merge changes made by another tab before applying this tab's pending
      // values. A lower stale high score can never replace a higher record.
      if (target.kind === 'supported' && (raw !== baseRaw || protectedMain)) {
        const merged = target.profile;
        for (const [key, value] of pending) apply(merged, key, value);
        profile = merged;
      }
      const next = JSON.stringify(profile);
      if (targetRaw !== next) {
        if (!protectedMain && current.kind === 'supported') {
          const backup = parse(storage.getItem(PROFILE_BACKUP_KEY));
          if (backup.kind === 'future' || backup.kind === 'corrupt') {
            persistence = 'memory'; reason = 'backup-profile-protected'; return false;
          }
          // Save the exact previous bytes before replacing a known profile.
          storage.setItem(PROFILE_BACKUP_KEY, raw);
        }
        storage.setItem(activeKey, next);
      }
      baseRaw = protectedMain ? raw : next;
      pending.clear();
      persistence = protectedMain ? 'recovery' : 'persistent';
      reason = protectedMain ? current.kind + '-main-profile' : null;
      return true;
    } catch (error) {
      persistence = 'memory'; reason = 'storage-unavailable'; return false;
    }
  }

  function ensure() {
    if (initialized) return;
    initialized = true;
    try {
      const storage = provideStorage();
      baseRaw = storage.getItem(PROFILE_KEY);
      const current = parse(baseRaw);
      if (current.kind === 'supported') {
        profile = current.profile;
        persistence = 'persistent';
        // an upgraded profile is not a damaged one; saying so would send the
        // next reader hunting for corruption that never happened
        reason = current.migrated ? 'schema-migrated'
          : current.repaired ? 'invalid-fields-recovered' : null;
        return;
      }
      const recovery = parse(storage.getItem(PROFILE_RECOVERY_KEY));
      const backup = parse(storage.getItem(PROFILE_BACKUP_KEY));
      profile = recovery.kind === 'supported' ? recovery.profile
        : backup.kind === 'supported' ? backup.profile : legacy(storage);
      if (current.kind === 'missing') {
        persistence = 'memory'; reason = 'migration-pending';
        flush();
      } else {
        // Do not replace an unrecognized/corrupt primary save just by loading
        // the game. Subsequent changes go to an explicit recovery sidecar.
        activeKey = PROFILE_RECOVERY_KEY;
        persistence = 'recovery'; reason = current.kind + '-main-profile';
      }
    } catch (error) {
      persistence = 'memory'; reason = 'storage-unavailable';
    }
  }

  return {
    get(key, fallback) {
      ensure();
      const name = canonical(key);
      if (!name) return fallback;
      const value = readValue(profile, name);
      if (value === undefined || value === null) return fallback;
      if (name === 'look' || name === 'meta' || name === 'binds') return JSON.stringify(value);
      if (BOOLEAN_KEYS.indexOf(name) >= 0) return value ? '1' : '0';
      return String(value);
    },
    set(key, value) {
      ensure();
      const name = canonical(key);
      if (!name) return false;
      const clean = normalize(name, value);
      if (clean === undefined) return false;
      apply(profile, name, clean);
      pending.set(name, clean);
      return flush();
    },
    flush: flush,
    snapshot() { ensure(); return copy(profile); },
    status() {
      ensure();
      return { schemaVersion: PROFILE_SCHEMA_VERSION, persistence: persistence, reason: reason,
        storageKey: activeKey, pendingChanges: pending.size };
    }
  };
}

const store = createProfileStore();
