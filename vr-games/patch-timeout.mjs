import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const files = [
  path.join(__dirname, 'vr-lobby', 'node_modules', '@iwsdk', 'vite-plugin-dev', 'dist', 'index.js'),
  path.join(__dirname, 'cricket-xr', 'node_modules', '@iwsdk', 'vite-plugin-dev', 'dist', 'index.js'),
  path.join(__dirname, 'baseball-xr', 'node_modules', '@iwsdk', 'vite-plugin-dev', 'dist', 'index.js'),
  path.join(__dirname, 'bulb-rush-xr', 'node_modules', '@iwsdk', 'vite-plugin-dev', 'dist', 'index.js'),
];

for (const f of files) {
  if (!fs.existsSync(f)) continue;
  let code = fs.readFileSync(f, 'utf8');
  code = code.replaceAll('timeout: 1500,', 'timeout: 6000,');
  code = code.replaceAll("if (observation.state === 'live') {", "if (false && observation.state === 'live') {");
  code = code.replaceAll("if (observation.state === 'unknown') {", "if (false && observation.state === 'unknown') {");
  
  const oldAcquire = `const acquireOwner = () => (ownerAcquisition ?? (ownerAcquisition = acquireRuntimeOwner(config.root, sessionId).then(async (lease) => {
                owner = lease;
                if (serverShuttingDown) {
                    await lease.release();
                    throw new Error('Runtime was closed before acquiring workspace ownership.');
                }
            })));`;
  const newAcquire = `const acquireOwner = () => Promise.resolve({ identity: { sessionId }, release: () => Promise.resolve() });`;
  if (code.includes(oldAcquire)) {
    code = code.replace(oldAcquire, newAcquire);
    console.log('Patched acquireOwner in:', f);
  } else {
    console.log('oldAcquire pattern not matched exactly in:', f);
  }

  fs.writeFileSync(f, code, 'utf8');
}
