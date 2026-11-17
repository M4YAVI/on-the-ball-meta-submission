# Test and acceptance matrix
Baseline 14 unit checks passed; every item below is a required new or repeat verification, not a claim of completion. Record device, OS/runtime, SDK version, mode, steps, expected/actual, evidence link and pass/fail. Mark unavailable hardware NOT TESTED.

| ID | Scenario | Expected result / evidence |
|---|---|---|
| T01 | Run baseline and updated unit tests | All pass; commit-linked output; add tests for regressions |
| T02 | Desktop complete 20 balls for each enabled mode | Correct ordered results; no duplicate completion; export/delete works |
| T03 | Quest 3/3S head mode | Explicit head label; seated hand-only start/selection/pause/exit; full session |
| T04 | Eye-capable device with permission | Fixed head, move eyes across targets; prove independent gaze and API source; record hardware and signal limitations |
| T05 | Emulator | Clearly marked simulated; never verified eye or competitive score |
| T06 | Eye API absent/denied/revoked | Clear message; explicit opt-in to separate head mode; no mixed scoring |
| T07 | Blink, brief dropout, occlusion | Invalid interval excluded; no false penalty; quality shown |
| T08 | Long dropout / <75% coverage (provisional) | Unscored; explain retry; no fabricated score |
| T09 | Invalid preceding sample then valid sample | Missing interval not credited; bounded sample integration |
| T10 | NaN, Infinity, zero vector, wrong source | Reject, stable app, no fake success |
| T11 | Duplicate/out-of-order/future/stale timestamps | Reject according to documented source clock; no double count |
| T12 | Noise, drift, delayed signals, headset shift | Quality assessment/recalibration where supported; no unvalidated latency correction |
| T13 | Pause, visibility loss, sleep, recenter, session end | Interrupted delivery discarded; clean resume/exit; no duplicate render loops |
| T14 | Rapid pinch spam / repeated select | One valid action per state; no duplicated points |
| T15 | Perfect scripted gaze / forged client data | Demonstrate practice score can be manipulated; no verified competitive label or automatic accusation |
| T16 | Local storage corruption/edit/quota failure | Graceful recovery; no crash; local results not authoritative |
| T17 | Dependency unavailable / network interruption | Explain failure; no stuck loading; bundle dependencies; desktop offline if supported |
| T18 | Seated comfort / narrow FOV / left-right handedness | Accessible controls, clear targets, no forced motion; safe pause/exit |
| T19 | Color blindness / reduced motion / text | Symbols and labels supplement color; readable UI; safe settings |
| T20 | Frame performance / ball timing | Capture device frame times and dropped frames; compare with official target; do not claim actual gaze latency without measurement |
| T21 | Privacy inspection | No raw eye images or persistent raw gaze; no unwanted network transmissions; deletion works |
| T22 | HTTPS staging | Launch from supported browser/headset; permissions and errors handled; actual full-loop recording |
| T23 | Predict/React (if shipped in XR) | Hand-only answers, random paths, response measured from explicit cue; no answer leakage in UI |
| T24 | Competition compliance | Authorized Start member, verified deadline, permitted build URL/channel, required demo and entry fields |

## Definition of done
P0 tests applicable to shipped functionality pass with recorded evidence. Actual eye-mode validation is required before describing it as verified; if hardware unavailable label experimental and keep it out of verified scores. No claim of cheat-proof, medical benefit, or competition eligibility without evidence. Report all open issues and explicitly approve any scope cuts. Provide source PR, commit hash, build instructions, HTTPS URL, device matrix, test log, demo video and submission checklist.
