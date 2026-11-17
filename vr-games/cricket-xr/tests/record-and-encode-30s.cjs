const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');
const { chromium } = require('playwright');

const OUT = path.resolve('hd-preview-frames');
if (fs.existsSync(OUT)) {
  fs.rmSync(OUT, { recursive: true, force: true });
}
fs.mkdirSync(OUT, { recursive: true });

const W = 1280;
const H = 720;
const FPS = 24;
const BALLS = 6;

(async () => {
  console.log('=== RECORDING 30s HD DEMO VIDEO (HIGH CATCH + CLEAN HUD) ===\n');

  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    args: [
      '--ignore-certificate-errors',
      '--use-gl=angle',
      '--use-angle=d3d11',
      '--enable-webgl',
      '--enable-webgl2',
    ],
  });

  const page = await browser.newPage({
    ignoreHTTPSErrors: true,
    viewport: { width: W, height: H },
  });

  await page.goto(`https://localhost:8081/?balls=${BALLS}&tutorial=0`);
  await page.waitForFunction(() => window.__game && window.__world, null, { timeout: 40000 });

  // Enter WebXR mode with hand tracking
  await page.evaluate((n) => {
    localStorage.removeItem('cricket-catch-best-' + n);
    window.IWER_DEVICE.primaryInputMode = 'hand';
    window.__world.launchXR();
  }, BALLS);
  await page.waitForFunction(() => !!window.__world.session, null, { timeout: 15000 });
  await page.waitForTimeout(1000);

  // Configure player view and hand tracking
  await page.evaluate(async () => {
    // Hide emulator GUI panels
    const fixed = [...document.body.children].find((e) => getComputedStyle(e).position === 'fixed' && e.querySelector('canvas'));
    if (fixed) {
      for (const kid of fixed.children) {
        if (kid.tagName === 'CANVAS' && getComputedStyle(kid).zIndex !== '3') continue;
        kid.style.display = 'none';
      }
    }

    const d = window.IWER_DEVICE;
    const s = window.__game.sys;

    // Head position: viewing crease and sightscreen
    await d.remote.dispatch('look_at', { device: 'headset', target: { x: 0, y: 1.05, z: -3.5 } });

    // Fielder hands (src/emulator-hands.js, the same ones the emulator plays): relaxed cupped stance, a
    // reach timed to the flight, fingers closing round the ball, both hands for a ball at the body.
    for (const side of ['left', 'right']) d.hands[side].connected = true;
    s.emulatorHands.forced = true;
    window.__moveHands = () => s.emulatorHands.flush();

    // The eyes: follow the ball in flight, watch it into the hands, then ease back to the coach.
    const look = { x: 0, y: 1.05, z: -3.5 };
    window.__lookAtBall = (bIdx, plan) => {
      const b = s.ball.position;
      const flying = s.state === 'swinging' || s.state === 'flying';
      const curPlan = plan && plan[bIdx] ? plan[bIdx] : null;
      let t;
      if (flying && curPlan && curPlan.catch === false && b.z > -4) t = { x: b.x + 2, y: b.y + 0.8, z: b.z };
      else if (flying || s.heldBy) t = { x: b.x, y: b.y, z: b.z };
      else t = { x: 0, y: 1.05, z: -3.5 };
      const k = flying ? 1 : 0.2;
      look.x += (t.x - look.x) * k;
      look.y += (t.y - look.y) * k;
      look.z += (t.z - look.z) * k;
      return d.remote.dispatch('look_at', { device: 'headset', target: { ...look } });
    };

    // Track audio events for exact synchronization
    window.__audioEvents = [];
    window.__currentFrame = 0;

    const origFile = s.sound.file ? s.sound.file.bind(s.sound) : () => false;
    s.sound.file = (name, vol) => {
      const typeMap = {
        hit: 'hit',
        coin: 'caught',
        hurt: 'missed',
        ui: 'ui',
        level: 'over',
      };
      const type = typeMap[name] || 'ui';
      window.__audioEvents.push({ frame: window.__currentFrame, type });
      return origFile(name, vol);
    };

    // Step function for precise 24 FPS
    window.__real = s.constructor.prototype.update;
    s.update = () => {};
    window.__frame = () => new Promise((r) => window.__world.session.requestAnimationFrame(() => r()));
  });

  await page.evaluate(() => window.__moveHands());
  await page.waitForTimeout(600);

  // Target 720 frames (30.0s @ 24 FPS)
  const MAX_FRAMES = 720;
  // `type` goes to the game's own forceType hook; the hands pick their technique from the ball's line.
  const ballPlan = [
    { catch: true, type: 'normal' },  // Ball 1: at the chest, both hands, orthodox cup
    { catch: false, type: 'normal' }, // Ball 2: a late, dropped attempt (coach shrug)
    { catch: true, type: 'high' },    // Ball 3: high skier, both hands, reverse cup
    { catch: true, type: 'wide' },    // Ball 4: wide, one hand at full stretch, the other covers
    { catch: true, type: 'normal' },  // Ball 5: both hands
    { catch: true, type: 'normal' },  // Ball 6: both hands, the winning catch
  ];

  let frameNo = 0;
  const shot = async (bIdx = 0) => {
    await page.evaluate(async ({ fn, bIdx, plan }) => {
      window.__currentFrame = fn;
      await window.__moveHands();
      await window.__lookAtBall(bIdx, plan);
      return window.__frame();
    }, { fn: frameNo++, bIdx, plan: ballPlan });
    const filename = `f${String(frameNo - 1).padStart(4, '0')}.png`;
    await page.screenshot({ path: path.join(OUT, filename) });
  };

  console.log('Capturing intro title card...');
  for (let i = 0; i < 24; i++) await shot(); // 1s intro card

  // Start the round
  console.log('Starting round...');
  await page.evaluate(() => {
    const s = window.__game.sys;
    s.lockout = 0;
    s.tryStart();
  });

  console.log('Recording active gameplay frames...');
  let lastState = null;
  while (frameNo < MAX_FRAMES) {
    const state = await page.evaluate((plan) => {
      const s = window.__game.sys;
      // The next ball's type, through the game's own test hook (read when the throw begins).
      if (s.state === 'ready' || s.state === 'feedback' || s.state === 'idle') {
        const next = plan[s.ballNo];
        s.forceType = next ? next.type : 'normal';
        s.forceWideSide = -1;
      }
      const bIdx = Math.max(0, s.ballNo - 1);
      const curPlan = plan[bIdx] || { catch: true, type: 'normal' };

      // Step physics at 60Hz rate; the fielder hands move inside each step (a dropped attempt on ball 2).
      s.emulatorHands.plan = curPlan;
      const simSteps = Math.round(60 / 24); // 2.5 simulation ticks per video frame
      for (let i = 0; i < simSteps; i++) {
        window.__real.call(s, 1 / 60);
      }

      return {
        state: s.state,
        ballNo: s.ballNo,
        score: s.score,
        misses: s.misses,
        cup: s.cupType || (s.catchInfo && s.catchInfo.technique) || null,
        two: s.twoHanded,
        result: s.lastResult || null,
      };
    }, ballPlan);

    await shot(state.ballNo ? state.ballNo - 1 : 0);

    if (state.state === 'feedback' && lastState !== 'feedback') {
      console.log(` -> Ball ${state.ballNo}: ${state.result}${state.two ? ', two hands' : ''}${state.cup ? ` (${state.cup})` : ''}`);
    }
    lastState = state.state;

    if (frameNo % 100 === 0) {
      console.log(` -> Frame ${frameNo}/${MAX_FRAMES} (Ball ${state.ballNo}/${BALLS}, Score: ${state.score}, Missed: ${state.misses})`);
    }

    if (state.state === 'over' && frameNo >= 660) {
      // Pad end card to 720 frames
      while (frameNo < MAX_FRAMES) await shot();
      break;
    }
  }

  // Retrieve recorded audio events
  const audioEvents = await page.evaluate(() => window.__audioEvents);
  await browser.close();

  console.log(`\nCaptured ${frameNo} frames and ${audioEvents.length} synchronized audio events.`);

  // Write audio events metadata
  const meta = {
    totalFrames: frameNo,
    fps: FPS,
    events: audioEvents,
  };
  fs.writeFileSync('audio-events.json', JSON.stringify(meta, null, 2), 'utf8');

  // Encode with FFmpeg
  console.log('\n=== ENCODING MP4 WITH STEREO AUDIO ===');
  const totalDuration = (frameNo / FPS).toFixed(2);
  const audioMap = {
    ui: 'public/audio/ui.ogg',
    hit: 'public/audio/hit.ogg',
    caught: 'public/audio/confirm.ogg',
    missed: 'public/audio/hurt.ogg',
    over: 'public/audio/level_up.ogg',
  };

  const validEvents = audioEvents.filter((e) => audioMap[e.type] && fs.existsSync(audioMap[e.type]));
  let ffmpegCmd = '';

  if (validEvents.length === 0) {
    ffmpegCmd = `ffmpeg -y -framerate ${FPS} -i "${OUT}/f%04d.png" -c:v libx264 -preset medium -crf 19 -pix_fmt yuv420p cricket_catch_30s_hd.mp4`;
  } else {
    const inputs = [`-framerate ${FPS} -i "${OUT}/f%04d.png"`];
    const filterParts = [];
    const mixInputs = [];

    validEvents.forEach((ev, idx) => {
      inputs.push(`-i "${audioMap[ev.type]}"`);
      const delayMs = Math.round((ev.frame / FPS) * 1000);
      const audioIdx = idx + 1;
      filterParts.push(`[${audioIdx}:a]adelay=${delayMs}|${delayMs}[a${idx}]`);
      mixInputs.push(`[a${idx}]`);
    });

    const filterComplex = `${filterParts.join(';')};${mixInputs.join('')}amix=inputs=${mixInputs.length}:duration=longest[aout]`;
    ffmpegCmd = `ffmpeg -y ${inputs.join(' ')} -filter_complex "${filterComplex}" -map 0:v -map "[aout]" -c:v libx264 -preset medium -crf 19 -pix_fmt yuv420p -c:a aac -b:a 192k -t ${totalDuration} cricket_catch_30s_hd.mp4`;
  }

  console.log('Running FFmpeg encoding...');
  execSync(ffmpegCmd, { stdio: 'inherit' });

  // Copy to workspace root and cricket-xr
  const rootOut = path.resolve('..', 'cricket_catch_30s_hd.mp4');
  fs.copyFileSync('cricket_catch_30s_hd.mp4', rootOut);
  console.log(`Video generated successfully at: ${rootOut} and cricket_catch_30s_hd.mp4`);

  console.log('\n=== VIDEO CREATION COMPLETE ===');
})();

