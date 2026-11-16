# ON THE BALL

**Watch the ball. Get the count.** A seated, watch-only cricket experience for Meta VR Glasses and Meta Quest, built on the
official Meta Immersive Web SDK (IWSDK 1.1.0) from the VEGAH handoff baseline (`handoff-baseline/`, tag v0.1).

## The experience
1. Sit down, put on the glasses or headset, press **Enter VR**.
2. Look at a sport and pinch to select it (cricket is live; baseball, tennis and football show "coming soon").
3. Choose how the ball is followed: **Eye tracking** (after a 10-second calibration) or **Head mode**.
4. You are the **batsman**: you take guard at the crease, your stumps behind you, the bowler 22 yards away. One warm-up ball,
   then 20 deliveries come at you on three lines (left, straight, right) and varying lengths. You only watch. Nothing to catch or hit.
5. After each ball: GREEN / AMBER / RED / UNSCORED with a symbol, a word and a plain reason. After 20: the scorecard with the
   20 dots in order, the counts, minutes, and your earlier sessions underneath (with "+N green on your last session").

Hands are only for navigation (look + pinch, or hand ray + pinch). Pause, start over and exit are always available.

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

Why eyes matter: a ball that ends 16 degrees to the side while the head stays straight is GREEN for eyes that follow it and
AMBER/RED for a head-only device. That is the case this product is built for.

## Run
```
npm install
npm test            # 58 unit and adversarial tests (scoring, tracking faults, state machine, storage, batsman geometry)
npm run dev         # https://localhost:8084 with the Meta VR Glasses emulator
npx vite build      # production build in dist/ (emulator is injected for desktop browsers, skipped on the Quest browser)
```
Dev-only autopilot keys in the emulator: `1` eyes follow the ball (also passes calibration), `2` late, `3` away,
`4` blink, `5` long dropout, `6` head follows the ball, `0` off.

## Privacy
Only per-session totals are stored, on this device (localStorage). No gaze or head poses, no eye images, no network calls.
The flat page has Export and Delete buttons.

## Known limits (honest)
- No real eye-tracking hardware was available. Eye mode was exercised only with the emulator (labelled SIMULATED).
- Quest frame rate must be measured on a real Quest before claiming 60+ fps (desktop: ~72 draw calls, ~52k triangles).
- Scores are local practice scores, not tamper-proof. Coach dashboards, cloud sync and leaderboards are P2 (after submission).
- Thresholds are gameplay rules, not clinical or sports-performance claims.

See `docs/` for the handoff brief, device matrix and the test and acceptance matrix.
