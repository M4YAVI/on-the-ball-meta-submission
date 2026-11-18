# ON THE BALL

**Watch the ball. Get the count.** A seated, watch-only cricket experience for Meta VR Glasses and Meta Quest, built on the
official Meta Immersive Web SDK (IWSDK 1.1.0) from the VEGAH handoff baseline (`handoff-baseline/`, tag v0.1).

## The experience
1. Sit down, put on the glasses or headset, press **Enter VR**.
2. The app opens straight on cricket. The other three sports are their own sub-projects (see "The four sports" below) and the
   hub lobby has a tile for each; look at a tile and pinch to open it.
3. Choose how the ball is followed: **Eye tracking** (after a 10-second calibration) or **Head mode**.
4. You are the **batsman**: you take guard at the crease, your stumps behind you, the bowler 22 yards away. One warm-up ball,
   then 20 deliveries come at you on three lines (left, straight, right) and varying lengths. The ball is a red cricket
   ball with the deck's white ring around it (slides 5 and 12). A cricket bat is in your hand (see "Batting" below): swing it
   and play the ball. The score is still how well your eyes stayed on the ball.
5. After each ball: GREEN / AMBER / RED / UNSCORED with a symbol, a word and a plain reason. After 20: the scorecard with the
   20 dots in order, the counts, minutes, and your earlier sessions underneath (with "+N green on your last session").

Hands are only for navigation (look + pinch, or hand ray + pinch). Pause, start over and exit are always available.
The X on the scorecard ("Done") goes back to the sport tiles. A pause, a hidden page, the end of the XR session or a
recenter throws away the ball in flight; it is replayed, never scored as a miss.

## Batting (cricket)
A full-size cricket bat (Law 5 sizes: 10.8 cm wide blade, flat face, curved back with a spine, rubber grip) sits in the right
hand, or the left when only the left is tracked, on Quest controllers and on tracked hands. It follows the hand's grip pose
every frame. Nothing else moves it: no buttons, no auto-swing, no animation. The controller is the bat's handle, exactly as
a real bat sits in the fist (WebXR grip space: the held rod runs along Z, -Z toward the thumb): the top of the handle is on
the thumb side, the blade comes out below the little finger and the face looks where the palm looks. Hold the controller
like a handle (ring up, palm to the bowler) for the stance; the bat is always at the same angle as the hand.

- **A batsman's own view.** Two padded batting gloves (white, blue trim, finger rolls) grip the handle (`src/xr/gloves.js`, look
  only: the hit test uses the blade). On the PC the stance is what a batsman sees of his bat: gloves low at the bottom of the
  view, the bat leaning forward and out to the side over the pitch. The backlift takes the hands back to the hip and the bat
  out of view, the follow-through finishes over the front shoulder, out of view again; only the stance and the swing through
  the ball are seen, and the incoming ball is never covered. The lean is a look only: the face stays square and the middle of
  the bat travels down the ball's line. On a headset the bat and gloves are wherever the real hand is.
- **On the PC emulator (no hands to swing): look + scroll.** The mouse stays the eyes (the emulator's simulated gaze follows
  the cursor; in Play mode the mouse turns the head), so batting never takes it away from the eye-tracking score. The bat
  stands in front of you on the line you look along; the **scroll wheel** (or a two-finger swipe) is the swing: roll BACK to
  lift the bat (backlift), roll FORWARD to swing it through. A fast roll from a full backlift is a drive (about 95-100 km/h
  off the middle), a slow roll a push. Nothing moves the bat but the player: it stays where it was put (a test counts any
  frame it moves with no wheel input: 0). Works with Play mode on or off.
  Works with Play mode on or off. The PC control gets a slightly larger contact size (`PC_HIT_PAD`, 3.5 cm) because a wheel is
  cruder than an arm. Only when the IWER emulator is running; a headset never uses any of it (`src/xr/mouse-bat.js`).
- **Timing meter (right of the view): EARLY / PERFECT / LATE.** Each time the bat meets the ball a marker lands on the meter
  where your timing was and that zone lights up (it is dim the rest of the time). Timing is the ball's depth at the touch
  (`TIMING` in `src/core/bat-physics.js`): met far out in front is EARLY, nearer the body is LATE, a narrow band (22 cm) around
  the ideal point is PERFECT (48 cm wide since Nov 18). **A PERFECT touch off the middle third of the blade, with a real swing,
  always goes out of the ground**: it leaves at 130 km/h or more, 24 degrees up, in the direction you played it (left or right
  of straight). If the ball came off going square or back, it goes the way the bat was swinging, brought into the field in
  front (within 50 degrees of straight). An edge, a dab, or a toe or shoulder hit never does. The meter is feedback only: it is
  not the eye-tracking score.
- **PC swing (Nov 18, "make it easy to hit").** The pose lives in `src/core/pc-swing.js` (pure maths, tested in
  `tests/pc-swing.test.mjs`). Through the hit zone the hands now push the bat down the pitch with the face square, instead of
  only turning the bat about the hands (that pointed the blade at the bowler, so a middled ball flew up or back). The look line
  is read at the bat's depth and the hands reach to the height you look at. An offline simulator that plays every lane, length,
  speed and swing start time found every delivery hittable (typical window 100+ ms, was untouchable for some) with a PERFECT
  window for every lane at the default speed, and a look up to 8 cm off the ball still hits. A ball that has gone past the
  batsman no longer clicks off a bat held up behind him.
- **Ball size (Nov 18).** The drawn cricket ball is the real 7 cm ball from about 6 m in, and no more than about three times
  that at the bowler's end (it used to be 57 cm across in his hand). The glow and ring keep their old size, so it is as easy to
  follow. A batted ball flying away has a smaller floor (`BALL_DEG` in `src/core/ball-path.js`).
- **A slightly bigger target.** The ball's contact size is 2 cm bigger on a headset (5 cm on the PC control), so a ball that
  just grazes past still counts (`HIT_PAD` / `PC_HIT_PAD` in `src/game.js`). The bat and the ball are never moved toward each
  other, so a swing that is really early or late still misses.
- **The ball stays hittable.** After its arrival point a cricket ball carries straight on through the batting zone; it is
  only steered aside if it would pass near the face (`startRoll(..., clearIn3d)`; the other sports are unchanged).

- **The hit is physics, not an animation.** Every frame a swept test (`src/core/bat-physics.js`) moves the blade and the ball
  together in 2 cm steps, so neither a 140 km/h ball nor a fast swing can pass through the bat between frames. The ball leaves
  the face from the bat's own velocity at the contact point (measured over the last ~30 ms of hand poses, capped at 32 m/s
  against tracking spikes), a coefficient of restitution of 0.56 at the sweet spot (~21 cm up from the toe) that falls to 0.18
  at the toe and the shoulder, and friction along the face. A dead bat blocks the ball and drops it nearby. A hard swing drives
  it, and the bat's direction sets where it goes. A ball on the curved edge flies off sideways ("Edged").
- **The batted ball** flies with the same air drag as the bowled one, bounces and rolls on the outfield, and stops at the
  fence. Over the rope on the full is "SIX!", along the ground "FOUR!". The call-out shows the speed off the bat, and a
  boundary gets a crowd cheer.
- **Feel:** a willow "tock" from the middle, a thin click off an edge, a whoosh on a hard swing. A controller pulse is short
  and clean from the middle and a longer sting off the toe or shoulder. Tracked hands have nothing to vibrate.
- **Scoring is unchanged.** The eye-tracking Trial, its thresholds and the verdicts are untouched. If the ball is hit before
  its arrival point, the eyes are scored against where the ball really is (off the bat) until the arrival time, then the
  delivery closes as before. Shot call-outs are never part of the score.
- The bat is in hand on the ready screen (practice swings), every delivery and the pause; it is hidden on the menus.
- Tuning knobs: `BAT`/`HIT` in `src/core/bat-physics.js`, `gripToBat` in `src/xr/bat.js` (how the bat sits in the fist),
  the swing range, hand position and aim at the top of `src/core/pc-swing.js`.
- Demo video: `node record-cricket-batting.mjs` (repo root) records the emulator with a scripted arm swinging the controller.

## The four sports
All four are watch-only, seated, twenty balls and the same scoring, and they share the engine in `src/core` and the panels in
`src/xr`. Each sport is a different **view**, and the batsman's view belongs to cricket alone.

| Sport | Where | Your seat | Port | Hub path | Tests |
|---|---|---|---|---|---|
| Cricket | `src/` (this folder) | the batsman at the crease, stumps behind you | 8084 | `/ontheball/` | `tests/` |
| Football | `football/` | the goalkeeper | 8085 | `/ontheball/football/` | `football/tests/` |
| Tennis | `tennis/` | the receiver on the baseline | 8086 | `/ontheball/tennis/` | `tennis/tests/` |
| Baseball | `baseball/` | the catcher, behind home plate | 8087 | `/ontheball/baseball/` | `baseball/tests/` |

`npm test` runs all of them. Football, tennis and baseball have no `node_modules` of their own (Node finds this folder's).

## Scoring (baseline rules, kept)
- At least 75% of the flight must be validly tracked, otherwise **UNSCORED**. A sensor gap is never the player's miss.
- **GREEN**: on the ball (within 7 degrees) for at least 80% of the tracked time, picked up within the first 30% of the
  flight, and still on it as it arrives (the deck's "eyes stayed on the ball until it arrived"; a blink right at arrival
  skips this check instead of failing it).
- **AMBER**: on the ball at least 50% of the time (found it late, left it before it arrived, or partly on it).
- **RED**: looked away.
- An interval is credited only between two good, in-order samples less than 100 ms apart (handoff fix T09).

## Devices and modes (never mixed, always labelled)
| Device | What we use | Label |
|---|---|---|
| Meta VR Glasses | Runtime `gaze-tracking`, unlocked only after calibration proves the eyes move while the head stays still | EYE |
| Meta Quest Pro | Same as above if the browser grants gaze; otherwise head mode | EYE or HEAD |
| Meta Quest 3 / 3S | No eye tracker: head mode, with a faint amber dot showing where the head points | HEAD |
| Desktop emulator (IWER) | Emulated gaze; works for demos and tests, never presented as real eyes | SIMULATED |

Why eyes matter: a ball outside off stump ends about 11 degrees to the side; with the head straight it is GREEN for eyes that
follow it and AMBER/RED for a head-only device. That is the case this product is built for. Every delivery is a fair ball
(Nov 18): the three lanes cross the stumps on the leg stump, on the middle stump and outside off, never a wide.

## Run
```
npm install
npm test            # 60 unit and adversarial tests (scoring, tracking faults, state machine, storage, batsman geometry)
npm run test:baseline  # the handoff's original 14 checks, unchanged
npm run dev         # https://localhost:8084 with the Meta VR Glasses emulator
npx vite build      # production build in dist/ (emulator is injected for desktop browsers, skipped on the Quest browser)
```
Dev-only autopilot keys in the emulator: `1` eyes follow the ball (also passes calibration), `2` late, `3` away,
`4` blink, `5` long dropout, `6` head follows the ball (known limit: the emulator does not move its head from this key,
so it plays as a head held straight), `0` off.

## Privacy
Only per-session totals are stored, on this device (localStorage). No gaze or head poses, no eye images, no network calls.
The flat page has Export and Delete buttons.

## Known limits (honest)
- No real eye-tracking hardware was available. Eye mode was exercised only with the emulator (labelled SIMULATED).
- Quest frame rate must be measured on a real Quest before claiming 60+ fps (desktop: ~72 draw calls, ~52k triangles).
- Scores are local practice scores, not tamper-proof. Coach dashboards, cloud sync and leaderboards are P2 (after submission).
- Thresholds are gameplay rules, not clinical or sports-performance claims.

See `docs/` for the handoff brief, device matrix and the test and acceptance matrix.
