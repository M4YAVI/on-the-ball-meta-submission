# ON THE BALL · Football

The player is the **goalkeeper**, seated in goal. A striker takes 20 shots from the edge of the penalty area. The player never
saves, catches or touches the ball: they only watch it, and the eyes are the input. Same rules as cricket: watch the ball, get
the count; green / amber / red / unscored; Eye mode only after a passed calibration; Head mode is separate and always labelled;
a sensor failure is UNSCORED, never red.

Football is a sub-project of `on-the-ball`. It has **no `node_modules` of its own** (Node finds the parent's), and it reuses
the cricket build's scoring engine (`../src/core`) and panels (`../src/xr`). Only the shot physics, the ground, the ball and
the words are football's.

## Run

```
npm run dev:football      # https://localhost:8085/   (from the on-the-ball folder)
npm run build:football    # football/dist
npm run test:football     # 30 football tests
npm test                  # cricket + football (94 tests)
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
| `public/` | Striker model, sounds, scene file (the SDK needs the scene inside the project) |
| `tests/football.test.mjs` | Physics, view-comfort, scoring and adversarial tests |

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

## Honest limits

* Checked in the Meta emulator (IWER) in a headless browser, and by tests. **No real headset or real eye tracker has been used.**
  Anything the emulator calls gaze is simulated and is labelled SIMULATED in the game.
* The headless browser here renders too slowly for the 60 fps sampling the scoring needs, so its shots came out UNSCORED
  ("tracking too weak", correctly not a miss). Scored play needs a real headset or a machine with a GPU.
* The kick animation uses the same CC0 character as cricket's bowler, in his own clothes (no team kit).
* The lobby still has one ON THE BALL tile (to cricket). Football is reached by URL or the "Football" button in the emulator
  menu on the cricket page; a lobby tile is a separate change.
