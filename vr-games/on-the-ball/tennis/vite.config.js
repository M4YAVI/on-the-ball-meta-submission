// ON THE BALL · Tennis. A sub-project of on-the-ball: it has no node_modules of its own (Node finds the parent's), shares the
// scoring engine in ../src/core and the panels in ../src/xr.
import { iwsdkDev } from '@iwsdk/vite-plugin-dev';
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  plugins: [iwsdkDev()],
  cacheDir: '../node_modules/.vite-tennis',
  server: { host: '0.0.0.0', port: 8086, open: false },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: process.env.NODE_ENV !== 'production',
    target: 'esnext',
    rollupOptions: { input: fileURLToPath(new URL('./index.html', import.meta.url)) },
  },
  esbuild: { target: 'esnext' },
  resolve: { dedupe: ['three', '@pmndrs/uikit', '@pmndrs/uikit-horizon', '@pmndrs/uikit-lucide'] },
  optimizeDeps: {
    exclude: ['@babylonjs/havok'],
    include: ['three', '@pmndrs/uikit', '@pmndrs/uikit-horizon', '@pmndrs/uikit-lucide', '@drawcall/uikitml'],
    esbuildOptions: { target: 'esnext' },
  },
  publicDir: 'public', // a small copy: the striker model, the sounds, the scene file (the SDK wants the scene inside the project)
  base: './',
});
