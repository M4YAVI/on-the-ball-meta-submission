// One server for the whole hub: the lobby and the three games, on one HTTPS port.
//
//   node one-server.mjs            build all four apps, then serve them
//   node one-server.mjs --serve    serve the last build without rebuilding
//   PORT=9000 node one-server.mjs  use another port (default 8443)
//
//   https://<this-PC>:8443/           VR Lobby
//   https://<this-PC>:8443/cricket/   Cricket Catch
//   https://<this-PC>:8443/baseball/  Glove Up
//   https://<this-PC>:8443/bulb/      Bulb Rush
//   https://<this-PC>:8443/ontheball/ ON THE BALL (its own app, source in ../on-the-ball)
//   https://<this-PC>:8443/ontheball/football/ ON THE BALL football (source in ../on-the-ball/football)
//
// No game source is changed. Each app is built with its own vite.config.js and its own node_modules,
// and the four builds are copied into hub/ the same way .github/workflows/pages.yml does it.
// The builds use relative paths (base './'), so each one works from its sub-folder.
//
// This is a production build, so the dev-only IWER emulator is not included. For emulator testing,
// use the original start-all.mjs (npm run dev), which still works unchanged.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const HUB = path.join(ROOT, 'hub');
const PORT = Number(process.env.PORT) || 8443;
const HOST = process.env.HOST || '0.0.0.0';

// `mount` is the sub-folder the app is served from. The lobby sits at the root.
const APPS = [
  { name: 'VR Lobby', dir: 'vr-lobby', mount: '' },
  { name: 'Cricket Catch', dir: 'cricket-xr', mount: 'cricket' },
  { name: 'Glove Up (Baseball)', dir: 'baseball-xr', mount: 'baseball' },
  { name: 'Bulb Rush', dir: 'bulb-rush-xr', mount: 'bulb' },
  { name: 'ON THE BALL', dir: '../on-the-ball', mount: 'ontheball' }, // the one real copy (its own git repo)
  { name: 'ON THE BALL Football', dir: '../on-the-ball/football', mount: 'ontheball/football', sharedModules: '../on-the-ball' }, // a sub-project of ON THE BALL: no node_modules of its own
];

// The HTTPS certificate the IWSDK dev plugin already made. It holds the cert and key together, as the plugin writes it.
const CERT = path.join(ROOT, 'vr-lobby', '.iwsdk', 'https', '_cert.pem');

function buildApp(app) {
  const cwd = path.join(ROOT, app.dir);
  const viteBin = path.join(path.join(ROOT, app.sharedModules ?? app.dir), 'node_modules', 'vite', 'bin', 'vite.js');
  if (!fs.existsSync(viteBin)) {
    throw new Error(`${app.name}: dependencies are missing. Run "npm install" in ${app.dir}.`);
  }
  console.log(`\n[build] ${app.name} (${app.dir})`);
  const r = spawnSync(process.execPath, [viteBin, 'build'], { cwd, stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`${app.name}: build failed (exit ${r.status}).`);
}

function assemble() {
  fs.rmSync(HUB, { recursive: true, force: true });
  for (const app of APPS) {
    const from = path.join(ROOT, app.dir, 'dist');
    if (!fs.existsSync(path.join(from, 'index.html'))) {
      throw new Error(`${app.name}: no build output at ${from}.`);
    }
    fs.cpSync(from, path.join(HUB, app.mount), { recursive: true });
  }
  rewriteDevLinks(HUB);
  console.log(`\n[hub] assembled into ${HUB}`);
}

// The games' own nav buttons (Lobby, Glove Up, Cricket Catch) point at the dev ports 8080-8083.
// In the hub they become paths on this server. Only the built HTML is changed; the source is not.
const DEV_LINKS = [
  ['https://localhost:8080', '/'],
  ['https://localhost:8081', '/cricket'],
  ['https://localhost:8082', '/baseball'],
  ['https://localhost:8083', '/bulb'],
  ['https://localhost:8084', '/ontheball'],
  ['https://localhost:8085', '/ontheball/football'],
];

function rewriteDevLinks(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      rewriteDevLinks(p);
    } else if (entry.name.endsWith('.html')) {
      let html = fs.readFileSync(p, 'utf8');
      for (const [from, to] of DEV_LINKS) html = html.split(from).join(to);
      fs.writeFileSync(p, html);
    }
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.wasm': 'application/wasm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.ktx2': 'image/ktx2',
  '.bin': 'application/octet-stream',
};

function handle(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    return res.end();
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'https://localhost').pathname);
  } catch {
    res.writeHead(400);
    return res.end('Bad request');
  }

  // "/cricket" -> "/cricket/", so the game's relative asset paths resolve under its folder.
  for (const app of APPS) {
    if (app.mount && pathname === `/${app.mount}`) {
      res.writeHead(301, { Location: `/${app.mount}/` });
      return res.end();
    }
  }

  const relative = pathname.endsWith('/') ? `${pathname}index.html` : pathname;
  const file = path.resolve(HUB, '.' + relative);
  if (file !== HUB && !file.startsWith(HUB + path.sep)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Not found');
  }
  if (stat.isDirectory()) {
    res.writeHead(301, { Location: `${pathname}/` });
    return res.end();
  }

  res.writeHead(200, {
    'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'Content-Length': stat.size,
    'Cache-Control': 'no-cache',
  });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}

function lanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
}

function startServer() {
  if (!fs.existsSync(CERT)) {
    throw new Error(
      `HTTPS certificate not found at ${CERT}. Run "node start-all.mjs" once (it creates it), then try again.`,
    );
  }
  const pem = fs.readFileSync(CERT);
  const server = https.createServer({ key: pem, cert: pem }, handle);
  server.listen(PORT, HOST, () => {
    console.log('\n========================================================');
    console.log('  VR GAMES HUB: ONE SERVER');
    console.log('========================================================');
    console.log(`  VR Lobby          https://localhost:${PORT}/`);
    console.log(`  Cricket Catch     https://localhost:${PORT}/cricket/`);
    console.log(`  Glove Up          https://localhost:${PORT}/baseball/`);
    console.log(`  Bulb Rush         https://localhost:${PORT}/bulb/`);
    console.log(`  ON THE BALL       https://localhost:${PORT}/ontheball/`);
    console.log(`  ON THE BALL Football  https://localhost:${PORT}/ontheball/football/`);
    for (const ip of lanAddresses()) {
      console.log(`  On a Quest, use   https://${ip}:${PORT}/`);
    }
    console.log('========================================================\n');
  });
  process.on('SIGINT', () => {
    server.close();
    process.exit(0);
  });
}

try {
  if (process.argv.includes('--serve')) {
    if (!fs.existsSync(path.join(HUB, 'index.html'))) {
      throw new Error('Nothing built yet. Run "node one-server.mjs" first (without --serve).');
    }
  } else {
    for (const app of APPS) buildApp(app);
    assemble();
  }
  startServer();
} catch (e) {
  console.error(`\n[error] ${e.message}`);
  process.exit(1);
}
