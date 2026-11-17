// The pitcher's arsenal, as ON THE BALL baseball uses it: real big-league speed, movement and spin for a right-hander, taken from
// baseball-xr (MLB Statcast averages, rounded). Pure data and functions, no scene, so it is unit tested.
//
// Frame (the viewer's, the same as the rest of ON THE BALL): x to the player's right, y up, a pitch travels toward +z. The pitcher
// is a right-hander, so his ARM side is the player's LEFT (-x) and his GLOVE side the player's right (+x).
//   ivb: induced vertical break, inches. + is rise (less drop than gravity alone). hb: horizontal break, inches, + is arm side.
//   gyro: the share of the spin that is bullet spin (about the line of flight), which moves the ball not at all.

export const INCH = 0.0254;
export const MPH = 2.23694; // mph per m/s

export const PITCHES = Object.freeze([
  { id: 'four-seam', name: 'Four-seam fastball', short: 'Four-seamer', mph: 95, ivb: 16, hb: 8, rpm: 2350, gyro: 0.1, use: 30 },
  { id: 'sinker', name: 'Sinker', short: 'Sinker', mph: 94, ivb: 8, hb: 15, rpm: 2150, gyro: 0.15, use: 13 },
  { id: 'changeup', name: 'Changeup', short: 'Changeup', mph: 86, ivb: 6, hb: 14, rpm: 1750, gyro: 0.2, use: 10 },
  { id: 'cutter', name: 'Cutter', short: 'Cutter', mph: 89.5, ivb: 8, hb: -3, rpm: 2400, gyro: 0.55, use: 8 },
  { id: 'curveball', name: 'Curveball', short: 'Curveball', mph: 80, ivb: -10, hb: -9, rpm: 2550, gyro: 0.15, use: 9 },
  { id: 'slider', name: 'Slider', short: 'Slider', mph: 86, ivb: 1, hb: -5, rpm: 2450, gyro: 0.65, use: 11 },
  { id: 'splitter', name: 'Splitter', short: 'Splitter', mph: 87, ivb: 3, hb: 9, rpm: 1350, gyro: 0.3, use: 5 },
  { id: 'sweeper', name: 'Sweeper', short: 'Sweeper', mph: 82, ivb: 1, hb: -15, rpm: 2600, gyro: 0.25, use: 7 },
  { id: 'knuckle-curve', name: 'Knuckle curve', short: 'Knuckle curve', mph: 82, ivb: -11, hb: -6, rpm: 2400, gyro: 0.2, use: 4 },
  { id: 'screwball', name: 'Screwball', short: 'Screwball', mph: 77, ivb: -4, hb: 16, rpm: 2250, gyro: 0.2, use: 1.5 },
  // Almost no spin: the seams catch the air unevenly and it flutters, late, unpredictably (`flutter` is the wobble, in metres).
  { id: 'knuckleball', name: 'Knuckleball', short: 'Knuckler', mph: 76, ivb: 2, hb: 0, rpm: 120, gyro: 0, use: 1.5, flutter: 0.13 },
  // The slow, high-arcing surprise.
  { id: 'eephus', name: 'Eephus', short: 'Eephus', mph: 52, ivb: 6, hb: 4, rpm: 1300, gyro: 0.1, use: 1 },
]);

// How hard he throws: a share of the Statcast speeds (a four-seamer is about 59, 78 or 95 mph). Scores at different levels are
// not comparable, so the level id is stored with each session (the ids are the shared history's speed ids).
export const LEVELS = Object.freeze([
  { id: 'easy', name: 'Rookie', velo: 0.62 },
  { id: 'pro', name: 'Pro', velo: 0.82 },
  { id: 'fast', name: 'Majors', velo: 1.0 },
]);
// Rookie is the default: a four-seamer takes about 0.63 s from his hand to the plate, in the range of the other sports' default balls
// (Pro is the deck's half-second ball, Majors quicker still). Players move up with the Speed button.
export const DEFAULT_LEVEL = 'easy';
export const levelById = (id) => LEVELS.find((l) => l.id === id) ?? LEVELS.find((l) => l.id === DEFAULT_LEVEL);

// The four-seamer's speed at a level, rounded, for the menu label: "Pro 78 mph".
export const levelMph = (level) => Math.round(PITCHES[0].mph * level.velo);
export const levelLabel = (level) => `${level.name} ${levelMph(level)} mph`;

// The pitch's speed at a level, m/s. `jitter` is -1..1: pitch-to-pitch variation of about 1 mph, so two four-seamers are not twins.
export function pitchSpeed(pitch, level, jitter = 0) {
  const j = Number.isFinite(jitter) ? Math.max(-1, Math.min(1, jitter)) : 0;
  return ((pitch.mph + j * 1.2) * level.velo) / MPH;
}

// The steady acceleration the spin adds (on top of gravity) for a flight of T seconds, so the pitch moves its real number of
// inches whatever the speed. x to the player's right, y up.
export function breakAccel(pitch, T, out = {}) {
  const a = 2 / (T * T);
  out.x = -pitch.hb * INCH * a; // arm side is the player's left
  out.y = pitch.ivb * INCH * a;
  return out;
}

// The spin axis that gives that movement (Magnus: the force is along spin x velocity, with the ball flying along +z), with the
// pitch's share of bullet spin along the line of flight.
export function spinAxis(pitch, out = {}) {
  const bx = -pitch.hb;
  const by = pitch.ivb;
  const len = Math.hypot(bx, by);
  const g = Math.min(0.95, pitch.gyro);
  if (len < 1e-6) {
    out.x = 0.3;
    out.y = 0.2;
    out.z = 0.93; // a knuckleball: a lazy tumble
  } else {
    const t = Math.sqrt(1 - g * g) / len;
    out.x = -by * t;
    out.y = bx * t;
    out.z = g;
  }
  const n = Math.hypot(out.x, out.y, out.z);
  out.x /= n;
  out.y /= n;
  out.z /= n;
  return out;
}

// Turns a second to draw. Real spin (20 to 45 turns a second) would only strobe in a headset, so a spinning pitch is drawn slower
// but in proportion; a knuckleball's one or two turns are real.
export const drawnRps = (pitch) => (pitch.rpm < 600 ? pitch.rpm / 60 : pitch.rpm / 165);

// A knuckleball's flutter: a sideways and up-down wobble that grows late and is back to zero at T (so the pitch still crosses where
// it was aimed). `f` holds the amplitudes, rates and phases, drawn once per pitch from the session's random source.
export function flutterParams(pitch, rand) {
  const A = pitch.flutter || 0;
  if (!A) return null;
  return {
    ax: A * (0.6 + 0.4 * rand()) * (rand() < 0.5 ? -1 : 1),
    ay: A * 0.7 * (0.6 + 0.4 * rand()) * (rand() < 0.5 ? -1 : 1),
    wx: 2 * Math.PI * (1.1 + rand()),
    wy: 2 * Math.PI * (1.3 + rand()),
    px: rand() * 6.283,
    py: rand() * 6.283,
  };
}
export function flutterAt(f, t, T, out = {}) {
  if (!f || !(T > 0)) {
    out.x = 0;
    out.y = 0;
    return out;
  }
  const g = (t / T) * (t / T);
  out.x = f.ax * g * (Math.sin(f.wx * t + f.px) - Math.sin(f.wx * T + f.px));
  out.y = f.ay * g * (Math.sin(f.wy * t + f.py) - Math.sin(f.wy * T + f.py));
  return out;
}

// Which pitch to throw next: weighted by how often a big-league pitcher throws it, never the same one twice running, so 20 pitches
// show a spread of the arsenal. rand: () => [0, 1).
export function choosePitch(rand, avoidId = null) {
  const open = PITCHES.filter((p) => p.id !== avoidId);
  let total = 0;
  for (const p of open) total += p.use;
  let r = rand() * total;
  for (const p of open) {
    r -= p.use;
    if (r <= 0) return p;
  }
  return open[open.length - 1];
}
