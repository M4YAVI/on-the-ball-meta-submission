// Emulator controls (the "Emulator" menu, device switcher, Colliders button) are for development only.
// Wrap that markup in <!-- dev-only:start --> ... <!-- dev-only:end --> (or /* dev-only:start */ ... /* dev-only:end */
// for CSS) in index.html. This Vite plugin removes the marked blocks from production builds (npm run build),
// so they never ship to GitHub Pages. `npm run dev` keeps them.
const DEV_ONLY_BLOCK = /[ \t]*(?:<!--|\/\*) dev-only:start (?:-->|\*\/)[\s\S]*?(?:<!--|\/\*) dev-only:end (?:-->|\*\/)[ \t]*\r?\n?/g;

export function stripDevOnlyHtml() {
  return {
    name: 'strip-dev-only-html',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(DEV_ONLY_BLOCK, '');
    },
  };
}
