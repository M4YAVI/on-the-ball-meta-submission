// Local session history: the "backend", kept simple and inside the browser (localStorage).
//
// Privacy: only totals are kept. Each saved session is the sport, when, which input source scored it, the 20 colours, and
// the minutes. No gaze directions, no head poses, no eye images, no per-frame data. The player can export or delete it.
//
// Honesty: these are PRACTICE scores kept on the player's own device. They can be edited by the user, so they are never
// presented as verified or as a competitive result. A corrupt, edited or oversized store is discarded safely (T16).

import { tally, STATUS } from './engine.js';

const KEY = 'otb.sessions.v1';
const MAX_SESSIONS = 50;
const SOURCES = ['eye', 'head', 'simulated'];
// release speed of each delivery (ids from SPEED_OPTIONS in ball-path.js; calm / normal / pro are from earlier builds and stay
// readable). Scores at different speeds are not comparable.
export const SPEEDS = ['gentle', 'spin', 'medium', 'fast', 'calm', 'normal', 'pro'];
const STATUSES = Object.values(STATUS);

function validSession(s) {
  return (
    s != null &&
    typeof s === 'object' &&
    typeof s.sport === 'string' &&
    s.sport.length > 0 &&
    s.sport.length <= 24 &&
    Number.isFinite(s.ts) &&
    SOURCES.includes(s.source) &&
    (s.speed === undefined || SPEEDS.includes(s.speed)) &&
    Array.isArray(s.results) &&
    s.results.length === 20 &&
    s.results.every((r) => STATUSES.includes(r)) &&
    Number.isFinite(s.minutes) &&
    s.minutes >= 0 &&
    s.minutes < 1000
  );
}

export class HistoryStore {
  // storage: anything with getItem / setItem / removeItem. Injected so tests can use a fake, and so the app can fall back
  // to memory when browser storage is blocked.
  constructor(storage = null) {
    this.storage = storage;
    this.memory = [];
    this.lastError = null;
  }

  load() {
    let raw = null;
    try {
      raw = this.storage ? this.storage.getItem(KEY) : null;
    } catch (e) {
      this.lastError = 'storage-unavailable';
      return this.memory.slice();
    }
    if (raw == null) return this.memory.slice();
    try {
      if (raw.length > 200000) throw new Error('too large');
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) throw new Error('not a list');
      const ok = parsed.filter(validSession).slice(-MAX_SESSIONS);
      if (ok.length !== parsed.length) this.lastError = 'dropped-invalid-entries';
      this.memory = ok;
      return ok.slice();
    } catch (e) {
      this.lastError = 'corrupt-store-reset';
      this.memory = [];
      try {
        this.storage?.removeItem(KEY);
      } catch (_) {
        /* nothing more to do */
      }
      return [];
    }
  }

  // session: { sport, source, results:[20 statuses], minutes, ts? }. Returns the stored entry, or null if it is not valid.
  add(session) {
    const entry = {
      sport: session?.sport,
      ts: Number.isFinite(session?.ts) ? session.ts : Date.now(),
      source: session?.source,
      speed: SPEEDS.includes(session?.speed) ? session.speed : 'spin',
      results: Array.isArray(session?.results) ? session.results.slice(0, 20) : [],
      minutes: session?.minutes,
      practice: true,
    };
    if (!validSession(entry)) return null;
    const all = this.load();
    all.push(entry);
    const kept = all.slice(-MAX_SESSIONS);
    this.memory = kept;
    try {
      this.storage?.setItem(KEY, JSON.stringify(kept));
    } catch (e) {
      this.lastError = 'storage-write-failed'; // quota or blocked: the session stays in memory for this visit
    }
    return entry;
  }

  // Newest first, for the scorecard's "earlier sessions" rows.
  recent(sport, n = 2) {
    return this.load()
      .filter((s) => s.sport === sport)
      .slice(-n)
      .reverse()
      .map((s) => ({ ts: s.ts, source: s.source, counts: tally(s.results) }));
  }

  exportJson() {
    return JSON.stringify(this.load(), null, 2);
  }

  clear() {
    this.memory = [];
    try {
      this.storage?.removeItem(KEY);
    } catch (_) {
      this.lastError = 'storage-unavailable';
    }
  }
}

export const HISTORY_KEY = KEY;
