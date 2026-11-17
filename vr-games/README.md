# VR Games Hub: build, run and test guide

This folder holds every web game in the project, the VR lobby that opens them, and the one HTTPS server that serves them.
It covers the seven WebXR games (Glove Up, Cricket Catch, Bulb Rush and the four ON THE BALL sports) and the lobby.
A separate Unity project, `CricketCatch/`, is a standalone Quest build of Cricket Catch and is not part of the hub.

Written for: developers who need to install, run, test, build or deploy the games.

---

## 1. The games at a glance

| Game | Folder | Port (dev) | Hub path | What you do |
| --- | --- | --- | --- | --- |
| VR Lobby | `vr-lobby/` | 8080 | `/` | Pick a game from a grid of tiles (look and pinch) |
| Cricket Catch | `cricket-xr/` | 8081 | `/cricket/` | A coach bowls and hits the ball at you; catch it with your hands |
| Glove Up (baseball) | `baseball-xr/` | 8082 | `/baseball/` | Catch 25 pitches per round as the catcher; 12 pitch types |
| Bulb Rush | `bulb-rush-xr/` | 8083 | `/bulb/` | Seated reaction game: point at or touch the lit bulb before the ring closes |
| ON THE BALL (cricket) | `on-the-ball/` | 8084 | `/ontheball/` | Watch-only batting trial: 20 deliveries scored by where your eyes stay |
| ON THE BALL Football | `on-the-ball/football/` | 8085 | `/ontheball/football/` | Seated goalkeeper: 20 shots, eyes scored, gloves as a second score |
| ON THE BALL Tennis | `on-the-ball/tennis/` | 8086 | `/ontheball/tennis/` | Seated receiver: 20 serves, watch the ball bounce and arrive |
| ON THE BALL Baseball | `on-the-ball/baseball/` | 8087 | `/ontheball/baseball/` | Seated catcher: 20 pitches, eyes scored, mitt as a second score |
| Cricket Catch (Unity) | `CricketCatch/` | n/a | n/a | Standalone Unity 6 Quest app; 6 balls per round |

The four ON THE BALL sports share one code base. `on-the-ball/src/core/` (scoring, gaze verdicts, history, flow) and
`on-the-ball/src/xr/` (panels, audio, bat and gloves) are reused by the sub-projects. Each sub-project has its own
physics, scene, ball and words.

Other folders: `web-prototype/` (a single-page browser test of Cricket Catch), `scratch/` (a one-off helper script),
and `on-the-ball/handoff-baseline/` (the original plain-WebXR prototype that ON THE BALL started from).

---

## 2. Tech stack and use cases

### Languages and runtimes

| Technology | Version | Used for |
| --- | --- | --- |
| JavaScript (ES modules) | ES2022+ (`target: esnext`) | All web game code, tests and build tools |
| Node.js | 20.19+, 22.12+ or 24+ (`engines` in `package.json`; `cricket-xr/.nvmrc` pins 22.12.0) | Dev server, build, the hub server and the test runner |
| C# | Unity 6 (6000.0.66f2 or newer) | The Unity build of Cricket Catch (`CricketCatch/Assets/Scripts`, `Assets/Editor`) |
| HTML and CSS | n/a | Each game's `index.html` page and the browser-test page |

### XR and 3D

| Technology | Version | Use case |
| --- | --- | --- |
| WebXR Device API | browser feature | Starts an immersive VR session (`immersive-vr`), reads controllers, hand tracking and gaze/eye tracking where the runtime offers them |
| Meta Immersive Web SDK (`@iwsdk/core`) | 1.1.0 | The engine for every web game: an entity-component-system (ECS) on top of Three.js, with XR session setup, input and scene loading |
| Three.js (via `super-three`) | 0.185.0 | Rendering, geometry, materials and the animation maths. Installed as an npm alias of `super-three`, and pinned in `overrides` so every app uses one copy |
| `@pmndrs/uikit`, `-horizon`, `-lucide` | ^1.0.74 | In-VR panels: menus, scorecards, buttons and icons, drawn inside the scene |
| glTF / GLB models | n/a | The coach, pitcher, striker, hands, scenery and gloves. Loaded through the SDK's glTF loader |
| `@gltf-transform/core`, `@gltf-transform/functions` | (build tools) | Offline model work in `cricket-xr/tools/coach` and `baseball-xr/tools/pitcher`: UV regions, texture painting, glTF rewriting |
| Two-bone inverse kinematics (IK), key-posed animation | custom | The pitcher's whole delivery (`baseball-xr/src/pitcher.js`), key-posed by hand and solved per frame |
| Unity 6 + Meta XR Core SDK (`OVRHand`, `OVRCameraRig`, `OVRManager`) | Unity 6000.0.66f2 | The Quest build of Cricket Catch: hand tracking, camera rig and catch zones on each palm |

### Build, dev and hosting

| Technology | Version | Use case |
| --- | --- | --- |
| Vite | ^7.1.4 | Dev server (`dev:runtime`), production build (`build`) and preview for every web app. Each build uses relative paths (`base './'`) so it works from a sub-folder |
| esbuild | (bundled with Vite) | Transpiles the JavaScript during the build |
| `@iwsdk/cli` | 1.1.0 | `iwsdk dev restart / down / status`: runs the managed dev session the `dev` scripts start |
| `@iwsdk/vite-plugin-dev` | 1.1.0 | Adds the IWER WebXR emulator to dev mode and creates the local HTTPS certificate |
| `@iwsdk/reference` | 1.1.0 | Offline SDK API reference (`reference:warmup`, `reference:status`) |
| Node `https` server | built-in | `one-server.mjs`: builds all eight apps and serves them from one HTTPS port (default 8443) |
| Node `child_process` | built-in | `start-all.mjs` starts the lobby and games together and opens Chrome with the emulator |
| GitHub Actions + GitHub Pages | `actions/checkout@v4`, `setup-node@v4` (Node 22), `upload-pages-artifact@v3` | `.github/workflows/pages.yml` builds and publishes the lobby, Cricket Catch, Glove Up and Bulb Rush |

### Scoring, physics and sensing

| Technology | Use case | Where |
| --- | --- | --- |
| Custom projectile physics (gravity, air drag, swerve, bounce, dip) | Ball flight in the ON THE BALL sports. Solved so the ball arrives at the player's eye line | `on-the-ball/*/src/core/ball-path.js` |
| Gaze and eye-tracking verdicts | GREEN / AMBER / RED / UNSCORED for each delivery, with a calibration step before Eye mode | `on-the-ball/src/core/gaze-verdict.js`, `cricket-xr/src/gaze.js`, `cricket-xr/src/eye-tracker.js` |
| Swept collision tests | Catches, saves and punches: the glove or mitt path is tested against the ball's path, not just its position | `baseball/src/core/catching.js`, `football/src/core/goalkeeping.js` |
| Hand tracking (`XRHand`, controllers) | Hands and bats as input; the clap in Bulb Rush is two hands coming together, read from hand tracking | `bulb-rush-xr/src/game.js`, `on-the-ball/src/xr/bat.js`, `gloves.js` |
| Pure-JS maths modules | Keep the physics and scoring free of rendering, so the tests can run in plain Node | `*/src/core/` |

### Audio, storage and assets

| Technology | Use case |
| --- | --- |
| Web Audio API and HTML audio | Sound effects (`audio.js`, `sound.js`) in Ogg Vorbis format (`.ogg`) |
| `localStorage` | Best scores, lifetime score and each player's history, saved on the device |
| CC0 and MIT assets | Models, scenery and sounds from Quaternius, Kenney and `@webxr-input-profiles/assets`. Licences are in each app's `ASSETS.md` and `LICENSE-*.txt` |

### Testing

| Technology | Use case |
| --- | --- |
| Node built-in test runner (`node --test`) and `node:assert/strict` | Unit and maths tests, run with no browser. Most tests need nothing installed |
| Playwright (not in `package.json`; install it yourself) | Browser play scripts in `bulb-rush-xr/tests/` (`play.cjs`, `xr.cjs`, `features.cjs`, ...). They need a running server |
| Browser emulator (IWER, via the Vite plugin) | Plays the XR scene on a PC without a headset |

---

## 3. Prerequisites

- **Node.js**, one of the versions in section 2 (20.19+, 22.12+ or 24+).
- **npm** (it comes with Node).
- **Chrome or Edge** on the PC, for the emulator and browser tests.
- **A Meta Quest or Meta VR Glasses** for real hand, controller and eye tracking. Optional for development.
- **Unity 6000.0.66f2 or newer**, with Android Build Support, OpenJDK and Android SDK and NDK Tools. Only for `CricketCatch/`.

---

## 4. Install (once)

All web apps in this folder share one `node_modules`, installed here:

```bash
cd vr-games
npm install
```

Each sub-folder (for example `cricket-xr/`) is set up to use this shared install. Do not run `npm install` inside a sub-folder
unless you want a separate copy.

---

## 5. Run

There are three ways to run the games. Pick one.

### A. Development with the emulator (recommended on a PC)

```bash
cd vr-games
npm run dev:multi      # runs start-all.mjs: the lobby and Cricket Catch, Glove Up, Bulb Rush, and opens Chrome with the IWER emulator
```

ON THE BALL is not in `start-all.mjs`; run it on its own (section 5C).

Open the page in Chrome or Edge and accept the local certificate warning. Press **Enter XR** if the page offers it. In the emulator
panel, switch the input to **hands** and put a hand on the green ball (or press Space) to start.

### B. One HTTPS server for everything (production-like, for a headset)

```bash
cd vr-games
npm start              # builds all eight apps (the lobby and seven games), copies them into hub/, then serves them
```

`npm run dev` runs the same script.

- `npm run serve` serves the last build without rebuilding.
- `PORT=9000 npm start` uses another port (default **8443**).
- The server reads the certificate that the dev plugin creates in `vr-lobby/.iwsdk/https/`. Run `npm run dev:multi` once first.

Open `https://<this-PC>:8443/` on the PC, or `https://<this-PC's LAN IP>:8443/` in a Quest browser on the same Wi-Fi.
The paths are in the table in section 1.

This build has no emulator. Use option A to test without a headset.

### C. One app on its own

Each app can be run from its own folder. Use the port in section 1.

```bash
cd vr-games/cricket-xr && npm run dev:runtime     # https://localhost:8081
cd vr-games/baseball-xr && npm run dev:runtime    # https://localhost:8082
cd vr-games/bulb-rush-xr && npm run dev:runtime   # https://localhost:8083
cd vr-games/vr-lobby && npm run dev               # the lobby (start-all.mjs serves it on port 8080)
```

ON THE BALL and its sub-projects are started from the `on-the-ball/` folder:

```bash
cd vr-games/on-the-ball
npm run dev:runtime        # ON THE BALL (cricket), https://localhost:8084
npm run dev:football       # https://localhost:8085
npm run dev:tennis         # https://localhost:8086
npm run dev:baseball       # https://localhost:8087
```

`npm run dev` in a game folder is IWSDK's managed variant. It opens its own browser and needs a browser download. Use `dev:runtime` for plain Vite.

### Play without a headset

On a PC, the mouse moves the hand or the mitt, Space or Enter starts a round, and click or tap works on every menu.
In ON THE BALL the eye score uses the emulator's simulated gaze, which follows the mouse. The batting bat is moved with the scroll wheel (section 7 of `on-the-ball/README.md`).

---

## 6. Test

| Command (run from `vr-games/`) | What it tests | Needs |
| --- | --- | --- |
| `npm run test:lobby` | Lobby unit tests (`vr-lobby/tests/unit.test.mjs`) | nothing |
| `npm run test:ontheball` | Every ON THE BALL sport: cricket, football, tennis and baseball (236 tests) | nothing |

Per app, from the app's folder:

| Command | What it tests |
| --- | --- |
| `cd cricket-xr && npm run test:unit` | Tuning, flight and catch maths, hand animation, gaze and "no low balls" (5 files) |
| `cd baseball-xr && npm run test:unit` | Unit tests in `tests/unit.test.mjs` |
| `cd bulb-rush-xr && npm run test:unit` | Unit tests in `tests/unit.test.mjs` |
| `cd bulb-rush-xr && npm test` | Browser play and XR scripts. Needs Playwright installed and the Bulb Rush server running |

From `on-the-ball/`:

| Command | What it tests |
| --- | --- |
| `npm test` | All sports at once |
| `npm run test:football` | Shot physics and goalkeeping |
| `npm run test:tennis` | Serve physics, bounce, scoring and sessions (53 tests) |
| `npm run test:baseball` | Pitch and scoring tests, and hand play (64 tests) |
| `npm run test:baseline` | The original handoff prototype |

---

## 7. Build and deploy

### Build each app

```bash
cd vr-games
npm run build:lobby                         # the lobby only, into vr-lobby/dist
cd cricket-xr && npm run build              # any single app, into its own dist/
cd on-the-ball && npm run build:football    # a single ON THE BALL sport, into football/dist
```

`npm start` builds all eight apps and copies them into `vr-games/hub/` (generated; not committed).

### Publish to GitHub Pages

The workflow is `vr-games/.github/workflows/pages.yml`. It builds the lobby, Cricket Catch, Glove Up and Bulb Rush, copies them
into one site, and deploys it to `https://<user>.github.io/<repo>/`. Setup, once: in the repo, open **Settings > Pages** and set
the source to **GitHub Actions**.

**Gaps:**
- GitHub only runs workflows from the `.github/` folder at the repository root. In this repo the root is one level up, so
  `pages.yml` will not run until it is moved to `<repo>/.github/workflows/` and its paths are changed to start from `vr-games/`.
- The workflow does not build the four ON THE BALL apps yet.

### Build Cricket Catch for Quest (Unity)

1. Install Unity 6000.0.66f2 or newer (see section 3).
2. Create a new **3D (URP)** project named `CricketCatch` in Unity Hub, or copy `CricketCatch/Assets` into one.
3. In Unity, install **Meta XR Core SDK** from **Window > Package Manager > My Assets**.
4. Set **Edit > Project Settings > Player > Active Input Handling = Both**.
5. Run **Tools > Cricket Catch > Build Scene**, then **Play** to test with the mouse.
6. For Quest: **Tools > Cricket Catch > Add Quest Camera Rig**, add the **Hand Tracking** building block, run
   **Meta > Tools > Project Setup Tool**, then in **File > Build Profiles** choose **Android**, your Quest, and **Build And Run**.

The full steps are in `CricketCatch/README.md`.

---

## 8. Ports and URLs

| Port | Served by | Address |
| --- | --- | --- |
| 8080 | Lobby (dev) | `https://localhost:8080` |
| 8081 | Cricket Catch | `https://localhost:8081` |
| 8082 | Glove Up | `https://localhost:8082` |
| 8083 | Bulb Rush | `https://localhost:8083` |
| 8084 | ON THE BALL (cricket) | `https://localhost:8084` |
| 8085 | ON THE BALL Football | `https://localhost:8085` |
| 8086 | ON THE BALL Tennis | `https://localhost:8086` |
| 8087 | ON THE BALL Baseball | `https://localhost:8087` |
| 8443 | One server (`npm start`), all of the above under sub-paths | `https://<host>:8443/` |

The lobby opens each game on its own port (`vr-lobby/src/config.js`). Under the one server (8443), the lobby opens
each game from its sub-path instead, so the same tiles work in both setups.

---

## 9. Troubleshooting

- **Certificate warning in the browser.** The dev certificate is self-signed. Accept it once per port. A Quest needs the same step in its browser.
- **"Refused to connect" on a lobby tile.** The game's dev server is not running. Start it (section 5) or use `npm run dev:multi`, which starts the lobby and the games together.
- **"Dependencies are missing" from `npm start`.** Run `npm install` in `vr-games/` first.
- **Port already in use.** Stop the other process, or set `PORT` (for the one server) or change `server.port` in the app's `vite.config.js`.
- **Stale lock files after a crash.** `start-all.mjs` removes `.iwsdk/runtime` locks before it starts. To clear them by hand, delete the `.iwsdk/runtime` folder in the app.
- **Eye score says UNSCORED.** The headset or emulator is not sending gaze data. Run the calibration again. A sensor failure is UNSCORED by design; it is never counted as a miss.
- **Two copies of Three.js warnings.** Every app must import `three` through the shared `super-three` alias. Each `vite.config.js` dedupes `three` and the `@pmndrs/uikit` packages for this reason. Do not add a second `three` install.
- **Cannot find `playwright`.** Install it yourself (`npm i -D playwright`) before running the browser test scripts. They are not in `package.json`.

---

## 10. Assets, licences and credits

- Models, sounds and scenery are CC0 (Quaternius, Kenney) or MIT (`@webxr-input-profiles/assets`).
- Licence texts ship in each app's `public/` folder, for example `LICENSE-webxr-input-profiles.txt`.
- The source of every asset is listed in each app's `ASSETS.md`.

---

## 11. Folder map

```
vr-games/
├── README.md              this file
├── package.json           shared dependencies and the root scripts
├── one-server.mjs         builds all apps and serves them on one HTTPS port
├── start-all.mjs          npm run dev:multi: the lobby and the games, with the emulator
├── hub/                   generated: the combined build (not committed)
├── vr-lobby/              the lobby (Vite)
├── cricket-xr/            Cricket Catch (Vite, IWSDK)
├── baseball-xr/           Glove Up (Vite, IWSDK)
├── bulb-rush-xr/          Bulb Rush (Vite, IWSDK)
├── on-the-ball/           ON THE BALL (Vite, IWSDK) and its sub-projects:
│   ├── src/core/          shared scoring, gaze verdicts, history, flow
│   ├── src/xr/            shared panels, audio, bat and gloves
│   ├── football/          goalkeeper sub-project
│   ├── tennis/            receiver sub-project
│   └── baseball/          catcher sub-project
├── CricketCatch/          Unity 6 project for Quest
├── web-prototype/         single-page Cricket Catch browser test
├── scratch/               a one-off helper script
└── .github/workflows/
    └── pages.yml          builds and publishes to GitHub Pages
```
