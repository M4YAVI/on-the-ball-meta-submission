// Look and feel from the ON THE BALL deck: near-black panels, white text, one green accent, and the green / amber / red count.
// Colour is never the only cue: every result also has its own symbol and word (T19).

export const COLORS = Object.freeze({
  bg: '#12161C',
  panel: '#171C24',
  panelHi: '#1E252F',
  edge: 'rgba(255,255,255,0.12)',
  text: '#F3F6F4',
  dim: '#9AA6A0',
  faint: '#8E9A93',
  accent: '#3DDC84', // the brand green
  green: '#3DDC84',
  amber: '#F5A524',
  red: '#E5484D',
  unscored: '#8A94A6',
  white: '#FFFFFF',
  ink: '#0B0E12',
});

export const FONT = '"Inter","Segoe UI","Roboto","Helvetica Neue",Arial,sans-serif';

// word + colour + symbol for each outcome. `symbol` is drawn with paths (see cards.js), so it never depends on a font.
export const OUTCOME = Object.freeze({
  green: { word: 'GREEN', color: COLORS.green, symbol: 'check', note: 'Locked on' },
  amber: { word: 'AMBER', color: COLORS.amber, symbol: 'wave', note: 'Caught it late' },
  red: { word: 'RED', color: COLORS.red, symbol: 'cross', note: 'Looked away' },
  unscored: { word: 'UNSCORED', color: COLORS.unscored, symbol: 'dash', note: 'Tracking too weak. Not a miss' },
});

// Where the person is looking from, as a plain label that is shown on the scorecard and the HUD.
export const SOURCE_LABEL = Object.freeze({
  eye: { short: 'EYE', long: 'Eye tracking (calibrated)', color: COLORS.accent },
  head: { short: 'HEAD', long: 'Head mode (6DoF head tracking)', color: COLORS.amber },
  simulated: { short: 'SIMULATED', long: 'Simulated input (emulator)', color: COLORS.unscored },
});
