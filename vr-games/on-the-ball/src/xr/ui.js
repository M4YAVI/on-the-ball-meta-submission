// All the on-screen panels, built from the ON THE BALL deck: sport tiles (slide 4) and the scorecard (slide 8).
//
// Placement follows the Meta VR Glasses view (37 deg left/right, 25 up, 43 down): everything sits about 2.2 m in front of
// the eyes, near the middle and level with or a little below eye height. Every target draws its own hover ring and pressed
// look, because the glasses show no gaze cursor.

import { Hovered, RayInteractable } from '@iwsdk/core';
import { Card, dot, fit, panelBase, paragraph, pill, roundButton, roundRect, symbol, text } from './cards.js';
import { COLORS, FONT, OUTCOME, SOURCE_LABEL } from './theme.js';
import { paintTile } from './tile-art.js';
import { PHASE } from '../core/flow.js';

const Z = -2.2; // distance of the panels, metres
const PX = 640; // canvas pixels per metre (of the unscaled layout)
const K = 1.2; // everything is drawn this much larger than the layout numbers below, to use more of the glasses' view

// Which panels are visible in each phase.
const LAYOUT = {
  [PHASE.SPORT]: [], // never shown: the main lobby picks the game, so ON THE BALL opens straight on the mode choice
  [PHASE.MODE]: ['modeInfo', 'btn:eye', 'btn:head', 'btn:back'],
  [PHASE.CALIBRATING]: ['calibInfo', 'btn:calcancel'],
  [PHASE.READY]: ['readyInfo', 'btn:start', 'btn:speed', 'btn:modeback', 'btn:guide'],
  // While a delivery is under way (run-in, release, flight) nothing but the pause button is on screen, so no text sits where the
  // eyes follow the ball and nothing pulls the gaze off it. The pause button is a plain icon in the low corner, off the ball's path.
  [PHASE.PLAYING]: ['btn:pause'],
  // Once the ball has ended (tracked or missed): the result and the scoreboard strip. They go again when the next delivery begins.
  [PHASE.BETWEEN]: ['hud', 'flash', 'btn:pause'],
  [PHASE.PAUSED]: ['pauseInfo', 'btn:resume', 'btn:retry', 'btn:exit'],
  [PHASE.SCORECARD]: ['scoreMain', 'scoreRow1', 'scoreRow2', 'btn:retry2', 'btn:exit2'],
};

// Plain words for why a ball was amber or red (from Trial.finish().reason).
const REASON_NOTE = {
  late: 'Found it late',
  'left-early': 'Left it before it arrived',
  partial: 'Partly on the ball',
  'looked-away': 'Looked away',
};

const dayTime = (ts) => {
  try {
    return new Date(ts).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' }).replace(',', '');
  } catch (_) {
    return '';
  }
};

// Words and picture that change from sport to sport. Cricket is the default; football passes its own (football/src/skin.js).
export const CRICKET_SKIN = Object.freeze({
  title: 'Cricket',
  art: 'cricket',
  warmupIntro: 'You are the batsman. One warm-up ball, then 20 deliveries. ',
  intro: 'You are the batsman. Twenty deliveries. ',
  headHint: 'Keep the amber dot on the ball. Nothing to catch or hit.',
  eyeHint: "Watch the glow at the bowler's hand, then follow the ball with your eyes right onto the bat.",
  speedDefault: 'Spin 85 km/h',
});

export class Ui {
  constructor(world, anchorEntity, onPress, skin = CRICKET_SKIN) {
    this.skin = skin;
    this.world = world;
    this.anchorEntity = anchorEntity;
    this.onPress = onPress;
    this.entries = new Map();
    this.byEntity = new Map();
    this.state = null;
    this.visible = new Set();
    this.art = {};
    this.build();
  }

  tileArt(id) {
    if (!this.art[id]) {
      try {
        this.art[id] = paintTile(id, 16 / 9);
      } catch (e) {
        this.art[id] = null; // a missing picture must never stop the app
      }
    }
    return this.art[id];
  }

  // when: optional (state) => boolean. The panel is shown in its phase only while this is true.
  add(id, w, h, x, y, draw, { interactive = false, px = PX, z = Z, when = null } = {}) {
    const card = new Card(w * K, h * K, px / K); // same pixel layout, K times larger in the world
    card.mesh.position.set(x * K, y * K, z);
    card.mesh.visible = false;
    card.mesh.name = id;
    const entity = this.world.createTransformEntity(card.mesh, this.anchorEntity);
    const e = { id, card, entity, draw, interactive, when, enabled: interactive, hover: false, pressed: false, shown: false };
    this.entries.set(id, e);
    this.byEntity.set(entity, e);
    return e;
  }

  build() {
    const S = () => this.state;

    // ---- how to follow the ball
    this.add('modeInfo', 1.5, 0.52, 0, 0.36, (c, w, h) => {
      const s = S();
      panelBase(c, w, h);
      text(c, 'How should we follow the ball?', w / 2, 62, { size: 50, weight: 700, align: 'center' });
      paragraph(c, s?.eyeNote ?? '', 60, 118, w - 120, { size: 31, color: COLORS.dim, align: 'center' });
      if (s?.notice) paragraph(c, s.notice, 60, 220, w - 120, { size: 30, color: COLORS.amber, align: 'center' });
    });
    const eyeLabel = () => 'Eye tracking';
    this.add(
      'btn:eye',
      0.72,
      0.26,
      -0.385,
      -0.08,
      (c, w, h, f) => {
        const s = S();
        pill(c, 4, 4, w - 8, h - 8, eyeLabel(), { ...f, primary: !!s?.eyeAvailable, disabled: !s?.eyeAvailable, sub: s?.eyeAvailable ? (s.emulated ? 'Simulated by the emulator' : 'Quick eye check first (2 dots)') : 'Not available on this device' });
      },
      { interactive: true },
    );
    this.add(
      'btn:head',
      0.72,
      0.26,
      0.385,
      -0.08,
      (c, w, h, f) => pill(c, 4, 4, w - 8, h - 8, 'Head mode', { ...f, sub: 'Follows your head (6DoF)' }),
      { interactive: true },
    );
    this.add('btn:back', 0.5, 0.15, 0, -0.34, (c, w, h, f) => pill(c, 4, 4, w - 8, h - 8, 'Back to lobby', f), { interactive: true, when: (s) => !!s?.inHub });

    // ---- calibration
    this.add('calibInfo', 1.4, 0.4, 0, 0.5, (c, w, h) => {
      const s = S();
      const cal = s?.calib ?? { targetIndex: 0, progress: 0 };
      panelBase(c, w, h);
      text(c, 'Keep your head still', w / 2, 58, { size: 50, weight: 700, align: 'center' });
      text(c, `Look at the glowing dot with your eyes only (${Math.min(2, cal.targetIndex + 1)} of 2)`, w / 2, 124, { size: 32, weight: 500, align: 'center', color: COLORS.dim });
      const bw = w - 200;
      roundRect(c, 100, 176, bw, 22, 11);
      c.fillStyle = 'rgba(255,255,255,0.12)';
      c.fill();
      roundRect(c, 100, 176, Math.max(22, bw * (cal.progress ?? 0)), 22, 11);
      c.fillStyle = COLORS.accent;
      c.fill();
    });
    this.add('btn:calcancel', 0.5, 0.15, 0, -0.56, (c, w, h, f) => pill(c, 4, 4, w - 8, h - 8, 'Cancel', f), { interactive: true });

    // ---- ready
    this.add('readyInfo', 1.5, 0.56, 0, 0.3, (c, w, h) => {
      const s = S();
      const src = SOURCE_LABEL[s?.source ?? 'head'];
      panelBase(c, w, h);
      text(c, this.skin.title, w / 2, 58, { size: 56, weight: 800, align: 'center' });
      // source chip: always says what is doing the tracking
      const label = `${src.short}  ·  ${src.long}`;
      roundRect(c, w / 2 - 330, 104, 660, 50, 25);
      c.strokeStyle = src.color;
      c.lineWidth = 3;
      c.stroke();
      text(c, label, w / 2, 130, { size: 28, weight: 700, align: 'center', color: src.color });
      paragraph(c, (s?.warmupPending ? this.skin.warmupIntro : this.skin.intro) + (s?.source === 'head' ? this.skin.headHint : this.skin.eyeHint), 70, 186, w - 140, { size: 32, color: COLORS.dim, align: 'center' });
    });
    this.add('btn:start', 0.7, 0.22, 0, -0.15, (c, w, h, f) => pill(c, 4, 4, w - 8, h - 8, 'Start', { ...f, primary: true }), { interactive: true });
    this.add('btn:speed', 0.7, 0.15, -0.38, -0.40, (c, w, h, f) => pill(c, 4, 4, w - 8, h - 8, 'Speed: ' + (S()?.speedLabel ?? this.skin.speedDefault), f), { interactive: true });
    this.add('btn:guide', 0.7, 0.15, 0, -0.60, (c, w, h, f) => pill(c, 4, 4, w - 8, h - 8, 'Green guide ring: ' + (S()?.guide === false ? 'Off' : 'On'), f), { interactive: true });
    this.add('btn:modeback', 0.5, 0.15, 0.38, -0.40, (c, w, h, f) => pill(c, 4, 4, w - 8, h - 8, 'Change mode', f), { interactive: true });

    // ---- heads-up strip between deliveries (hidden while a ball is in play, see LAYOUT). It sits low (centre ~29 degrees down, top edge ~27), below the lowest point any ball
    // reaches (25 degrees down, PATH.arrivalFloorDeg in core/ball-path.js), so it never covers the pitch, the bowler or the ball.
    this.add('hud', 1.7, 0.15, -0.1, -1.2, (c, w, h) => {
      const s = S();
      const src = SOURCE_LABEL[s?.source ?? 'head'];
      c.save();
      c.globalAlpha = 0.9;
      roundRect(c, 2, 2, w - 4, h - 4, h / 2);
      c.fillStyle = COLORS.panel;
      c.fill();
      c.restore();
      text(c, src.short, 30, h / 2, { size: 28, weight: 800, color: src.color });
      const r = 12;
      // the dots start after the source label, whatever its length (SIMULATED is the longest)
      c.save();
      c.font = `800 28px ${FONT}`;
      const x0 = 30 + c.measureText(src.short).width + 30;
      c.restore();
      const step = Math.min(33, (w - 230 - x0) / 19);
      for (let i = 0; i < 20; i++) dot(c, x0 + i * step, h / 2, r, s?.results?.[i] ?? null);
      const ball = s?.warmup ? 'Warm-up' : `Ball ${Math.min(20, (s?.results?.length ?? 0) + 1)} of 20`;
      text(c, ball, w - 30, h / 2, { size: 28, weight: 700, align: 'right' });
    });
    this.add('btn:pause', 0.17, 0.17, 0.86, -1.2, (c, w, h, f) => roundButton(c, w, h, 'pause', f), { interactive: true });

    // result of the ball that just finished: word + symbol + colour, and a plain reason when it was not scored
    this.add('flash', 1.25, 0.16, 0, -0.74, (c, w, h) => {
      const f = S()?.flash;
      if (!f) return;
      const o = OUTCOME[f.status] ?? OUTCOME.unscored;
      panelBase(c, w, h, { radius: h / 2, edge: o.color });
      symbol(c, o.symbol, 52, h / 2, 24, o.color);
      const wordSize = fit(c, o.word, 320, 36, 800);
      text(c, o.word, 92, h / 2, { size: wordSize, weight: 800, color: o.color });
      const why = f.status === 'green' && f.streak >= 2 ? f.streak + ' in a row' : REASON_NOTE[f.reason] ?? o.note;
      const note = f.status === 'unscored' ? o.note : why + ' · on ball ' + Math.round((f.coverage ?? 0) * 100) + '%';
      const noteSize = fit(c, note, w - 92 - 330, 28, 500);
      text(c, note, w - 30, h / 2, { size: noteSize, weight: 500, color: COLORS.dim, align: 'right' });
    });

    // ---- paused
    this.add('pauseInfo', 1.4, 0.34, 0, 0.34, (c, w, h) => {
      panelBase(c, w, h);
      text(c, 'Paused', w / 2, 62, { size: 58, weight: 800, align: 'center' });
      paragraph(c, 'The ball that was in flight was thrown away. It is not counted as a miss.', 60, 126, w - 120, { size: 32, color: COLORS.text, align: 'center' });
    });
    this.add('btn:resume', 0.5, 0.2, -0.56, -0.05, (c, w, h, f) => pill(c, 4, 4, w - 8, h - 8, 'Resume', { ...f, primary: true }), { interactive: true });
    this.add('btn:retry', 0.5, 0.2, 0, -0.05, (c, w, h, f) => pill(c, 4, 4, w - 8, h - 8, 'Start over', f), { interactive: true });
    this.add('btn:exit', 0.5, 0.2, 0.56, -0.05, (c, w, h, f) => pill(c, 4, 4, w - 8, h - 8, 'Exit', f), { interactive: true });

    // ---- scorecard (deck slide 8)
    this.add('scoreMain', 1.7, 0.78, 0, 0.2, (c, w, h) => {
      const s = S();
      const cnt = s?.counts ?? { total: 0, green: 0, amber: 0, red: 0, unscored: 0 };
      const src = SOURCE_LABEL[s?.source ?? 'head'];
      panelBase(c, w, h, { radius: 34 });
      // sport badge and title
      const art = this.tileArt(this.skin.art);
      c.save();
      c.beginPath();
      c.arc(96, 100, 52, 0, Math.PI * 2);
      c.clip();
      if (art) c.drawImage(art, 0, 0, art.width, art.height, 96 - 52 * 1.78, 100 - 52, 52 * 3.56, 104);
      c.restore();
      c.beginPath();
      c.arc(96, 100, 52, 0, Math.PI * 2);
      c.strokeStyle = COLORS.edge;
      c.lineWidth = 3;
      c.stroke();
      text(c, this.skin.title, 176, 80, { size: 58, weight: 800 });
      text(c, dayTime(s?.ts ?? Date.now()), 178, 130, { size: 32, weight: 500, color: COLORS.dim });
      // source chip
      roundRect(c, 176, 160, 400, 44, 22);
      c.strokeStyle = src.color;
      c.lineWidth = 3;
      c.stroke();
      text(c, src.short + ' · ' + (s?.source === 'eye' ? 'calibrated' : s?.source === 'head' ? 'head mode' : 'emulator'), 376, 183, { size: 27, weight: 700, color: src.color, align: 'center' });
      // hand play (baseball's mitt, football's gloves): a line of its own under the source chip, so the eye-tracking counts on the
      // right stay the score. A sport can give its own wording in hand.line.
      if (s?.hand && (s.hand.line || s.hand.pitches > 0)) {
        const hd = s.hand;
        const line = hd.line ?? `Mitt: ${hd.catches} of ${hd.pitches} caught · ${hd.strikes} strikes${hd.framed ? ' (' + hd.framed + ' framed)' : ''}`;
        text(c, line, 176, 238, { size: fit(c, line, 450, 26, 700), weight: 700, color: COLORS.dim });
      }
      // 20 dots in two rows of 10
      for (let i = 0; i < 20; i++) dot(c, 78 + (i % 10) * 64, 290 + Math.floor(i / 10) * 74, 24, s?.results?.[i] ?? null);
      // progress against the last session in the same mode (deck slide 8: older days sit under the card)
      const prev = (s?.history ?? []).find((r) => r.source === s?.source);
      if ((s?.bestStreak ?? 0) >= 2) text(c, 'Best run: ' + s.bestStreak + ' in a row', 50, h - 98, { size: 30, weight: 700, color: COLORS.green });
      if (prev) {
        const d = cnt.green - prev.counts.green;
        const msg = d > 0 ? `+${d} on your last ${src.short.toLowerCase()} session` : d < 0 ? `${d} on your last ${src.short.toLowerCase()} session` : `Same as your last ${src.short.toLowerCase()} session`;
        text(c, msg, 50, h - 52, { size: 30, weight: 700, color: d > 0 ? COLORS.green : d < 0 ? COLORS.amber : COLORS.dim });
      }
      // divider + counts
      c.fillStyle = COLORS.edge;
      c.fillRect(w - 440, 40, 2, h - 80);
      const rows = [
        [cnt.total, 'total', COLORS.white],
        [cnt.green, 'good sight', COLORS.green],
        [cnt.amber, 'average', COLORS.amber],
        [cnt.red, 'lost eye contact', COLORS.red],
        [cnt.unscored, 'unscored', COLORS.unscored],
        [s?.minutes ?? 0, 'min', COLORS.white],
      ];
      rows.forEach(([n, label, col], i) => {
        const y = 62 + i * 78;
        text(c, String(n), w - 330, y, { size: 58, weight: 800, color: col, align: 'right' });
        const labelSize = fit(c, label, 300, 36, 500);
        text(c, label, w - 305, y + 6, { size: labelSize, weight: 500, color: COLORS.dim });
      });
    });
    const row = (idx) => (c, w, h) => {
      const s = S();
      const r = s?.history?.[idx];
      panelBase(c, w, h, { radius: 24, alpha: 0.9 });
      if (!r) {
        text(c, idx === 0 ? 'Your first session. Play again to see progress.' : '', 36, h / 2, { size: 32, weight: 500, color: COLORS.faint });
        return;
      }
      const src = SOURCE_LABEL[r.source] ?? SOURCE_LABEL.head;
      text(c, dayTime(r.ts), 36, h / 2, { size: 32, weight: 500, color: COLORS.dim });
      text(c, src.short, 420, h / 2, { size: 27, weight: 800, color: src.color });
      text(c, 'good sight', w - 36, h / 2 + 2, { size: 28, weight: 500, color: COLORS.dim, align: 'right' });
      text(c, String(r.counts.green), w - 210, h / 2, { size: 44, weight: 800, color: COLORS.green, align: 'right' });
    };
    this.add('scoreRow1', 1.7, 0.15, 0, -0.30, row(0));
    this.add('scoreRow2', 1.7, 0.15, 0, -0.47, row(1));
    this.add('btn:retry2', 0.24, 0.24, -0.4, -0.73, (c, w, h, f) => roundButton(c, w, h, 'retry', f), { interactive: true });
    this.add('btn:exit2', 0.24, 0.24, 0.4, -0.73, (c, w, h, f) => roundButton(c, w, h, 'close', f), { interactive: true });

    for (const e of this.entries.values()) this.redraw(e);
  }

  redraw(e) {
    e.card.draw((c, w, h) => e.draw(c, w, h, { hover: e.hover, pressed: e.pressed, disabled: !e.enabled }));
  }

  setEnabled(id, enabled) {
    const e = this.entries.get(id);
    if (!e || e.enabled === enabled) return;
    e.enabled = enabled;
    this.applyInteractivity(e);
    this.redraw(e);
  }

  applyInteractivity(e) {
    const want = e.interactive && e.enabled && e.shown;
    const has = e.entity.hasComponent(RayInteractable);
    if (want && !has) e.entity.addComponent(RayInteractable);
    else if (!want && has) e.entity.removeComponent(RayInteractable);
    if (!want) {
      e.hover = false;
      e.pressed = false;
    }
  }

  // Show exactly the panels of `phase`, and redraw them from `state`.
  show(phase, state) {
    this.state = state;
    const ids = new Set((LAYOUT[phase] ?? []).filter((id) => {
      const e = this.entries.get(id);
      return e && (!e.when || e.when(state));
    }));
    for (const e of this.entries.values()) {
      const on = ids.has(e.id) && (!e.when || e.when(state));
      e.shown = on;
      e.card.mesh.visible = on;
      this.applyInteractivity(e);
      if (on) this.redraw(e);
    }
    this.visible = ids;
  }

  // Redraw the visible panels after the state changed (calibration progress, a finished ball, ...).
  refresh(state) {
    this.state = state;
    for (const id of this.visible) {
      const e = this.entries.get(id);
      if (e) this.redraw(e);
    }
  }

  // Once per frame: hover rings follow the gaze or hand ray.
  update() {
    for (const id of this.visible) {
      const e = this.entries.get(id);
      if (!e || !e.interactive || !e.enabled) continue;
      const hovered = e.entity.hasComponent(Hovered);
      if (hovered !== e.hover) {
        e.hover = hovered;
        this.redraw(e);
      }
    }
  }

  // A pinch landed on an entity.
  press(entity) {
    const e = this.byEntity.get(entity);
    if (!e || !e.shown || !e.enabled || !e.interactive) return;
    this.onPress(e.id);
  }

  dispose() {
    for (const e of this.entries.values()) e.card.dispose();
  }
}
