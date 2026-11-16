# ON THE BALL — prototype v0.1

## Run
Use Node 18+ for tests and Python 3 for local hosting. From this directory:

```
node tests.mjs
python -m http.server 8080
```
Open http://localhost:8080. Desktop Focus uses mouse/touch, not eye tracking; Predict and React use buttons. Choose sport and difficulty, complete 20 trials, export/delete local summaries. No account required. For headset use, deploy this directory to an HTTPS static host (e.g. Azure Static Web Apps). XR loads pinned Three.js from jsDelivr; self-host dependency before production. Some runtimes may reject hand-tracking or gaze-tracking feature requests. XR is experimental, only Focus is implemented in headset, and headset scores are not saved. The app uses standard WebXR directly, not IWSDK; port the adapter to the generated IWSDK project if competition requirements or runtime behavior require it. No real device or emulator validation has been performed.

## Trust model
Desktop simulation, head pose, and unverified runtime gaze are distinct sources. Runtime gaze rays may be head-directed or emulated; never market their scores as verified eye tracking. No raw eye images or gaze data persist. Score only valid sample intervals; missing, nonfinite, mismatched, duplicate/out-of-order, and gaps over 100 ms are rejected. Under 75% valid coverage is unscored. Thresholds are gameplay heuristics, not clinical or training claims. Paused or hidden desktop flights restart; XR interruptions discard the flight. All local scores are practice scores, not tamper-resistant. Browser users can modify code or forge signals; do not enable prize-bearing leaderboards without server-issued challenges, replay protection, rate limits and validated telemetry. No client-only solution can prove genuine eye motion against a compromised client.

## Next validation gates
1. Actual Meta VR Glasses/Quest Pro: verify gaze source and distinguish it from head-aligned rays via a fixed-head moving-eye calibration. Confirm permission and API availability, timestamp semantics and signal quality. Do not assume a gaze source is authentic.
2. Quest 3/3S: validate explicit head mode and hand-only navigation. Verify select events, field of view, seated reach, pause/exit and performance.
3. Use IWER via an IWSDK starter to test cursor gaze and hand input; label simulation. Port adapter to IWSDK where needed. Verify exact competition rules/Start membership separately.
4. Validate frame timing, glasses fit, blinks, occlusion, long tracking loss, rapid eye/head movement, bright/dim environments, device sleep, handedness, accessibility, motion comfort. Test latency with real hardware before 500 ms flights.
5. Separate game modes and difficulty in any public leaderboard; add replay analysis only with consent. Add explicit pause/exit spatial buttons, accessible reticles, calibration UX, XR Predict/React, complete sport-specific environments, audio, local XR history and offline dependency bundling before release.

## Files
- index.html / app.mjs: desktop game and local history.
- engine.mjs: pure scoring and trajectory logic.
- xr.mjs: experimental headset adapter, Three.js and WebXR.
- tests.mjs: 14 deterministic unit tests.
