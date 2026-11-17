# ON THE BALL · Baseball

The player is the **catcher**, seated behind home plate. The pitcher stands on the mound, 18.44 m away, looks in, nods, winds up and
throws, and the ball comes to you: it is gone about 1.2 m in front of your eyes, as it crosses the front of the plate. The player
never hits, catches or touches the ball: they only watch it, and the eyes are the input. Same rules as cricket, football and tennis:
watch the ball, get the count; green / amber / red / unscored; Eye mode only after a passed calibration; Head mode is separate and
always labelled; a sensor failure is UNSCORED, never red.

**The batsman's view stays cricket's.** Baseball does not put you in the batter's box; you are behind the plate, where baseball-xr
(`vr-games/baseball-xr`, "Glove Up") already puts you. This sub-project reuses that game's ballpark, pitcher, ball and pitch
arsenal, and takes the player out of the catching: there is no mitt, no hand and nothing to touch.

Baseball is a sub-project of `on-the-ball`, built the same way football and tennis are. It has **no `node_modules` of its own**
(Node finds the parent's), and it reuses the cricket build's scoring engine, gaze checks, session flow, history and panels
(`../src/core`, `../src/xr`).

## Run

```
npm run dev:baseball      # https://localhost:8087/   (from the on-the-ball folder)
npm run build:baseball    # baseball/dist
npm run test:baseball     # 45 baseball tests
npm test                  # cricket + football + tennis + baseball (181 tests)
```

Through the hub (`vr-games`), baseball is served at `/ontheball/baseball/`, and the lobby has a tile for it (bottom row, left).

## What is in the folder

| Path | What it is |
| --- | --- |
| `src/core/pitches.js` | The twelve pitch types (real big-league speed, rise / drop, run, spin), the three speed levels, the movement and spin maths, the knuckleball's flutter, the weighted pitch choice |
| `src/core/ball-path.js` | The park's real dimensions, the aim point, the solved flight from the pitcher's fingers to the plate, the comfort checks, the 20-pitch set |
| `src/xr/ballpark.js` | The ballpark under the lights (copied from baseball-xr; only the way objects are added changed) |
| `src/xr/pitcher.js` | The pitcher and his whole delivery, key-posed with two-bone IK (copied from baseball-xr; added `reset()`) |
| `src/xr/glove.js` | The pitcher's glove (copied from baseball-xr, unchanged) |
| `src/xr/ball.js` | The baseball (baseball-xr's seam and stitching), its glow, the guide ring, the pitch's own spin |
| `src/xr/baseball-scene.js` | Hangs the park and the pitcher on one group in the player's eye frame |
| `src/game.js` | The game system (adapted from tennis's): settle, wind-up, release from his real fingers, flight, scoring |
| `src/skin.js` | The words the shared panels use for baseball |
| `public/` | The pitcher model (CC0 Quaternius, the same file baseball-xr ships), sounds, licences, the scene file (the SDK needs it inside the project) |
| `tests/baseball.test.mjs` | Physics, comfort, scoring, adversarial and session tests |

## Design decisions

* **Catcher view.** Your own body is not drawn. Home plate's point is 0.8 m in front of your eyes, the rubber 18.44 m beyond it. You
  are seated, as a catcher crouches, and the whole park is placed from your own eye height, so a pitch looks the same whatever
  your height.
* **One pitch has three parts.** He looks in and nods (0.9 s), winds up and delivers (1.24 s, the ball is in his fingers all the
  time, so the eyes can start on the real ball), and lets go. Only the flight is scored: the trial starts at the release frame, from
  where his fingers really are, and the flight is solved from there to the aim point.
* **Real pitches.** Twelve types at MLB Statcast averages (four-seamer 95 mph, sinker, changeup, cutter, curveball, slider,
  splitter, sweeper, knuckle curve, screwball, knuckleball, eephus). Gravity and the spin's acceleration are in the flight, and the
  movement is the real number of inches whatever the speed. Each session throws a spread of the arsenal (weighted by how often a
  pitcher throws each, never the same twice running).
* **Three speed levels** (default Rookie, the gentlest; the Speed button in the menu): Rookie 59 mph, Pro 78 mph, Majors 95 mph for the four-seamer.
  Flight times: about 0.63 / 0.48 / 0.39 s for a four-seamer. The level id is saved with each session because scores at different
  speeds are not comparable (history ids `easy` / `pro` / `fast`).
* **Three lanes and three heights.** Left, Middle and Right end 16 degrees to the side or straight ahead; Low, Level and High are
  13 cm apart. Each pitch is also a little off its spot (command, up to 3 cm) and 1 mph off its speed. A Left or Right pitch ends
  to the side, so a head held straight cannot score green on it but eyes can (the reason for eye tracking on the glasses).
* **Comfort limits (tested for every pitch type, level, lane, row and extreme command miss):** inside the glasses' view with 5
  degrees to spare, never more than 25 degrees below eye level, never more than 20 above (the highest is about 13), never through
  the ground, never closer than 1.1 m. The drawn ball is close to its real size: never under a 0.35 degree radius in flight (about 11 cm across at the mound, the real 7.4 cm inside 6 m) and about 9 cm in the pitcher's hand; the white guide ring, not the ball's size, is what marks it from far away.
* **A bad release point cannot hurt.** The hand position the game feeds in is pulled back into the box a pitcher's hand can be in,
  and every field of a delivery is cleaned (NaN, strings, huge numbers) before it moves the ball.
* **No scoring changes.** Tolerances, coverage and quality rules are the shared ones, untouched (a test pins them).
* **Shared changes made outside this folder** (cricket, football and tennis behaviour unchanged, their 136 tests still pass): baseball
  is marked live in `src/core/flow.js`; two old tests that expected baseball to be unselectable now check that an unknown sport is
  refused; the hub server builds and mounts baseball; the lobby has a tile and a picture for it.

## Honest limits

* Checked in the Meta emulator (IWER) in a headless browser, and by tests. **No real headset or real eye tracker has been used.**
  Anything the emulator calls gaze is simulated and is labelled SIMULATED in the game.
* The flight speed is the pitch's speed along the straight line from his hand to the plate (as in baseball-xr): the ball is a
  little faster at release than at the plate in a real pitch, because the game does not model air drag.
* The release point in `PATH.release` (used by the tests) was measured in the emulator from the pitcher's delivery, not from
  motion capture. In the game the real hand position at the release frame is used.
* The pitch type and speed are not shown on screen after each pitch (the shared result panel has no room for them). The twelve
  types are in the flight and the spin of the ball, and in the history only the level is kept.
* There is no batter and no umpire in the park (baseball-xr has none), so the strike zone is not drawn and no pitch is called a
  ball or a strike: this game scores where the eyes were, not where the pitch went.
* Head mode is a little stricter here than in cricket or tennis, because the ball is quicker. Modelled with the shared scoring: a
  head that trails the ball by up to 66 ms scores green on every lane at Rookie speed (the default); at Pro speed a trail of 66 ms
  or more makes Left and Right pitches amber, and at Rookie 100 ms does. In the emulator, the dev autopilot's head scored mostly amber at
  Pro (its trail was not measured). Head mode is a labelled compatibility mode, not the
  product's measure; real head-tracking latency on a headset has not been measured.
