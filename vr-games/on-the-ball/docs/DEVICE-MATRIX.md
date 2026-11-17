# ON THE BALL: device support matrix (research, 2026-11-16)

Status: research only. Nothing here was tested on hardware. Items marked UNVERIFIED need a check before we claim them.

## Rule that governs everything
Eye mode is used only when the runtime grants `gaze-tracking` AND the IWSDK gaze check sees real eye movement
(gaze separates from head by 1.5 deg or more). Everything else is labelled Head mode, Simulated, or Desktop.
Head or emulated gaze is never called eye tracking. A sensor failure scores as Unscored, never Red.

## Matrix
| Device | Real eye gaze in WebXR | Hands | Mode we ship | Evidence |
|---|---|---|---|---|
| Meta VR Glasses (ship spring 2027, ~$1,299.99) | Yes, `gaze-tracking` feature, `targetRayMode: gaze`. UNVERIFIED here (no hardware). | Yes. Hands-first. | Eye mode, once the gaze check passes | Meta blog, UploadVR, vr.org; IWSDK glasses-test skill |
| Meta Quest 3 / 3S | No eye hardware | Yes (hand tracking) | Head mode (labelled) | IWSDK glasses-test skill, section 6 |
| Meta Quest Pro | Has eye hardware, but no WebXR eye-tracking documentation found | Controllers, hands | Head mode unless gaze is granted and passes the check. UNVERIFIED. | Meta forum thread (no reply); Meta native docs only |
| Quest 2 / 1 | No | Quest 2 yes, Quest 1 limited | Head mode, low priority | IWER profiles |
| Desktop (IWER emulator) | Simulated only | Emulated | Development and testing only. Always labelled Simulated, never evidence of real eyes. | IWSDK glasses-test skill |

Scope decision (2026-11-16): Meta hackathon devices only (Meta VR Glasses and Meta Quest). Android XR, Apple Vision Pro, Pico and phones are out of scope and were not pursued.

## Glasses view (IWSDK glasses-test skill and IWER `metaVRGlasses` profile)
- Field of view: 37 deg left and right, 25 deg up, 43 deg down (about 74 x 68).
- Put key content level with or slightly below the eyes, near the middle. No gaze cursor in production.
- Handoff ball end point x=+-1.7 m at z=-2 m is about 40 deg to the side: outside the glasses' view. Cap it (about 20 deg).

## SDK rules found
- `gazeTracking: true` (optional, not required) registers `GazeSystem`. Use `dev.emulator.device = "metaVRGlasses"`.
- IWSDK guidance: do not add a silent head-pose fallback in production when gaze is missing. Our head mode must be an explicit, visible, labelled mode chosen by capability detection, not a silent substitute.
- Competition: entry must be fully usable with hands end-to-end. Controllers optional.
- Scaffold: `npm create @iwsdk@latest` (`@iwsdk/create` 1.1.0). npm `latest` for `@iwsdk/core` is 1.1.0 (the existing repo projects use 1.1.0-rc.2).

## Open items
1. RESOLVED 2026-11-16: the official rules (pasted by the user) say apps built with IWSDK (WebXR) are submitted as a hosted link. No APK needed.
2. Start program membership: the person submitting must be a member by submission time. Not yet confirmed.
3. Real eye hardware for validation. Not available. The rules accept demo footage from a Quest or an XR simulator/emulator, labelled honestly.
