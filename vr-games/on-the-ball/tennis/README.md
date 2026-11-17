# ON THE BALL · Tennis

The player is the **receiver**, seated on the baseline. The server stands on the far baseline, about 23 m away, tosses the ball,
strikes it, and it comes to you: it bounces **once** in the service box, rises, and is gone about 1.2 m in front of your eyes.
The player never hits, catches or touches the ball: they only watch it, and the eyes are the input. Same rules as cricket and
football: watch the ball, get the count; green / amber / red / unscored; Eye mode only after a passed calibration; Head mode is
separate and always labelled; a sensor failure is UNSCORED, never red.

Tennis is a sub-project of `on-the-ball`, built the same way football is. It has **no `node_modules` of its own** (Node finds the
parent's), and it reuses the cricket build's scoring engine, gaze checks, session flow, history and panels (`../src/core`,
`../src/xr`). Only the serve physics, the court, the ball and the words are tennis's.

## Run

```
npm run dev:tennis      # https://localhost:8086/   (from the on-the-ball folder)
npm run build:tennis    # tennis/dist
npm run test:tennis     # 53 tennis tests
npm test                # every sub-project's tests
```

Through the hub (`vr-games`), tennis is served at `/ontheball/tennis/`, and the lobby has a tile for it (bottom row, right).

## What is in the folder

| Path | What it is |
| --- | --- |
| `src/core/ball-path.js` | Serve physics: toss, strike, gravity, air drag, one bounce (restitution 0.72), speeds, directions, the 20-serve set |
| `src/xr/tennis-scene.js` | Floodlit court: every line painted to size, net with posts and tape, windscreens with the ON THE BALL name, a stand, an umpire's chair, the server with a toss and serve action |
| `src/xr/ball.js` | Optic-yellow tennis ball, glow, the guide ring |
| `src/game.js` | The game system (adapted from football's): lead-in with the toss, strike, bounce, serve physics |
| `src/skin.js` | The words the shared panels use for tennis |
| `public/` | Server model (the shared CC0 character), sounds, scene file (the SDK needs the scene inside the project) |
| `tests/tennis.test.mjs` | Physics, bounce, comfort, scoring, adversarial and session tests |

## Design decisions

* **Receiver view.** Your own body is not drawn. The net is 11.6 m ahead, the server 23.4 m ahead. You sit in the middle of the
  deuce half, so the centre line (the T) is 2 m to your left and the sideline about 2 m to your right.
* **Real flight.** Strike speeds 100 / 130 / 170 km/h (Slow / Medium / Fast, default Medium). Fast arrives in about 0.6 s from the
  strike. Drag 0.0209 per metre, gravity 9.81. At the bounce the ball keeps 72% of its downward speed (flipped upward) and 78% of
  its forward speed. Nothing is fitted: the arrival height is what the physics gives, and the tests check it for every speed,
  direction and depth.
* **Two sides, one per try.** A try of 20 serves is played from one half of the court, and the next try uses the other half:
  deuce (server on your left, original view) then ad (server on your right), and so on. The side never changes during a try. It
  changes when you press Retry, or after a finished try when you start again, and the last side is saved on the device so it carries
  on alternating after a restart. On the ad side the court slides 4 m under the seated player (the signs stay readable, nothing is
  mirrored) and the server walks to the other side of his baseline. Wide and T swap sides with it. The ready panel says which side
  the try is played from. A try you abandon (pause, then exit) keeps its side.
* **Three directions.** Wide: the ball ends to your right, 16 degrees off straight ahead. Body: straight at you. T: to your left,
  16 degrees off. Each serve also has its own slice (up to 0.18 m) and bounce depth (5.5 to 6.3 m out), all inside the service box.
* **The toss.** The server lifts his free arm, the ball leaves the hand about 0.76 s before the strike, rises, and is struck on its
  way down. A soft glow rides the ball through the toss so the eyes are already where the serve starts, and goes out at the strike.
* **Comfort limits (tested for every speed, direction, slice and depth):** inside the glasses' view with 5 degrees to spare, never
  more than 25 degrees below eye level, never more than 20 above, never through the court, never closer than 1.1 m, and the net
  is always cleared.
* **Wide and T balls end 16 degrees to the side (right or left depending on the side)**, so a head held straight cannot score green on them but eyes can (the reason
  for eye tracking on the glasses).
* **No scoring changes.** Tolerances, coverage and quality rules are the shared ones, untouched (a test pins them).
* **Shared changes made outside this folder** (cricket and football behaviour unchanged, their 94 tests still pass): tennis is marked
  live in `src/core/flow.js`; history accepts the `slow` speed id (`src/core/history.js`); the cricket test that expected tennis
  to be unselectable now checks baseball; the hub server builds and mounts tennis; the lobby has a tennis tile.

## Honest limits

* Checked in the Meta emulator (IWER) in a headless browser, and by tests. **No real headset or real eye tracker has been used.**
  Anything the emulator calls gaze is simulated and is labelled SIMULATED in the game.
* The server's racket and arm are placed so the strings meet the ball at the strike; this was fitted by eye in the emulator, not
  from motion capture. The same CC0 character as cricket's bowler is used, in his own clothes.
* The contact point is 2.4 m above the court and the server is 1.95 m tall, so his racket can reach it. A real server may hit a
  little higher; the physics takes the contact point from `PATH.releaseY`.
* The bounce point is not a real wide / T placement: the ball is always aimed so that it ends up to the player's side, close enough
  to follow comfortably. Wide and T therefore describe where the ball ends relative to the receiver.
