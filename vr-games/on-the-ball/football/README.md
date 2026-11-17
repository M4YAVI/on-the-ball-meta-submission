# ON THE BALL · Football

The player is the **goalkeeper**, seated in goal. A striker takes 20 shots from the edge of the penalty area. The eyes are the
primary input and the score: watch the ball, get the count; green / amber / red / unscored; Eye mode only after a passed
calibration; Head mode is separate and always labelled; a sensor failure is UNSCORED, never red.

**Hand play (gloves).** Like cricket's bat and baseball's mitt, the player also plays with their hands: a goalkeeper glove on
each hand, and a second score beside the eyes (`Gloves: 14 of 20 saved · 6 caught` on the scorecard). It never changes the eye
score: the eye trial ends at the ball's arrival point (1.2 m in front of the eyes) and the gloves only get the ball after that.

Football is a sub-project of `on-the-ball`. It has **no `node_modules` of its own** (Node finds the parent's), and it reuses
the cricket build's scoring engine (`../src/core`) and panels (`../src/xr`). Only the shot physics, the ground, the ball and
the words are football's.

## Run

```
npm run dev:football      # https://localhost:8085/   (from the on-the-ball folder)
npm run build:football    # football/dist
npm run test:football     # football tests (shot physics + goalkeeping)
npm test                  # every sport
```

Through the hub (`vr-games`), football is served at `/ontheball/football/`.

## What is in the folder

| Path | What it is |
| --- | --- |
| `src/core/ball-path.js` | Shot physics: gravity, air drag, swerve, dip, arrival height; speeds; the 20-shot set |
| `src/xr/football-scene.js` | Floodlit stadium: striped pitch with all markings, goals, stands, boards, floodlights, striker with a kick animation |
| `src/xr/ball.js` | White football, glow, the guide ring |
| `src/game.js` | The game system (copy of cricket's, adapted: lead-in, strike, shot physics) |
| `src/skin.js` | The words the shared panels use for football |
| `src/core/goalkeeping.js` | Hand play, pure maths: swept glove/ball test, catch / parry / punch, the goal line, the keeper's tally |
| `src/xr/gloves.js` | The two gloves on the hands (controllers or tracked hands), and the PC emulator control |
| `src/xr/glove-model.js` | The goalkeeper glove mesh |
| `src/xr/save-callout.js` | SAVED! / CAUGHT! / PUNCHED CLEAR! / GOAL call-out |
| `public/` | Striker model, sounds, scene file (the SDK needs the scene inside the project) |
| `tests/football.test.mjs` | Physics, view-comfort, scoring and adversarial tests |
| `tests/goalkeeping.test.mjs` | Glove tests, and whole shots played the way the game plays them, at every speed |

## Design decisions

* **Goalkeeper view.** The goal is behind the chair, out of view. The striker stands at the edge of the penalty area (about
  16.5 m), the ball rests on the grass in front of him, and a soft glow marks it so the eyes are already there at the strike.
* **Real flight.** Strike speeds 50 / 70 / 90 / 110 km/h (default 70). "Fast" arrives in about half a second, like the deck's
  fast ball. Drag 0.0135 per metre. Each shot also has a swerve (up to 0.5 m), a float/knuckle (up to 0.28 m) and an arrival
  height between knee and chest.
* **Comfort limits (tested for every speed, lane, swerve, height and dip):** inside the glasses' view with 5 degrees to spare,
  never more than 25 degrees below eye level, never more than 20 above, never through the grass, never closer than 1.1 m.
* **Side shots end 16 degrees to the side**, so a head held straight cannot score green on them but eyes can (the reason for
  eye tracking on the glasses).
* **Shared changes made outside this folder** (cricket behaviour unchanged, its 64 tests still pass): `GameFlow` takes an
  optional `deliveries` maker; `Ui` takes an optional `skin`; football is marked live; history accepts the `easy` speed id;
  the hub server builds and mounts football.

## Goalkeeping (hand play)

* **Gloves follow the hands.** Each glove sits on its hand's grip pose (Touch controller or tracked hand); nothing moves them but
  the player. They are drawn palm to the play, fingers turning down when the hand goes low; the wrist's own roll is not used
  (steadier, and the save test does not depend on it). Controllers buzz on a save.
* **Save test.** After the arrival point the ball carries on toward the goal. Each frame is split into small steps and the ball
  and each palm are swept against each other, so neither a fast shot nor a fast dive can pass through between frames.
* **On contact** (plain physics, `meetGlove`): two hands together hold a shot up to 22 m/s relative speed (Gentle / Easy /
  Medium) = **CAUGHT**, and the ball stays in the gloves until the next shot; faster, or one hand = **SAVED** (parried back out
  toward the field); a glove driven at the ball = **PUNCHED CLEAR**; a fingertip that only bends it may still see it go in =
  **GOAL** ("a touch, but it went in"). Over the line, between the posts and under the bar is a goal.
* **Fairness.** A shot with no glove tracked while it came through is not counted (never a goal against the player). The
  warm-up shot is called but not counted.
* **PC emulator.** The mouse is the eyes (or the head in Play mode), so it cannot also be the hands. The gloves stand on the line
  you are looking along, and the **scroll wheel sets their height** (forward = up, back = down): read the shot, get the hands
  there. Nothing moves by itself. A headset never uses this.
* **Dev only:** `window.__otb.keeper = 'hands' | 'one' | 'miss'` puts simulated gloves where the shot will pass (both, the left
  only, or well wide); `null` gives control back.

## Honest limits

* Checked in the Meta emulator (IWER) in a headless browser, and by tests. **No real headset or real eye tracker has been used.**
  Anything the emulator calls gaze is simulated and is labelled SIMULATED in the game. The gloves were checked with the dev
  keeper, **not with real hands on a headset**.
* The headless browser renders very slowly. Like cricket, the ball's clock moves at most 50 ms per frame, so a slow frame holds
  the ball still instead of jumping it, and the shots are scored. A headset runs far above that rate.
* The kick animation uses the same CC0 character as cricket's bowler, in his own clothes (no team kit).
* The lobby still has one ON THE BALL tile (to cricket). Football is reached by URL or the "Football" button in the emulator
  menu on the cricket page; a lobby tile is a separate change.
