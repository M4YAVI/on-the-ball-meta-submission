// The IWER emulator shows a blue "Remote Control Active" pill and a blue frame whenever a script drives
// the emulated headset (the fielder hands do). That is the emulator's own panel, not part of the game,
// so it is hidden here. Emulator only: a headset has no IWER_DEVICE and this does nothing.
//
// The panel lives in an open shadow root, so the badge is found there by its blue colour.

const BADGE_SELECTORS = [
  '[style*="59, 130, 246, 0.9"]', // the "Remote Control Active" pill
  '[style*="inset"][style*="59, 130, 246"]', // the blue frame around the view
];

function hideIn(root) {
  for (const selector of BADGE_SELECTORS) {
    for (const el of root.querySelectorAll(selector)) {
      if (el.style.display !== 'none') el.style.display = 'none';
    }
  }
}

export function hideRemoteControlBadge() {
  if (typeof window === 'undefined' || !window.IWER_DEVICE) return;
  const sweep = () => {
    hideIn(document);
    for (const host of document.querySelectorAll('*')) {
      if (host.shadowRoot) hideIn(host.shadowRoot);
    }
  };
  sweep();
  setInterval(sweep, 500);
}
