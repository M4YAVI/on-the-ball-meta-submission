export const CFG = {
  // Pinch: thumb tip to index tip. Press at `pinchStart`, and the hand must open past `pinchRelease` before
  // it can press again, so one pinch is one press however much the fingers tremble.
  pinchStart: 0.03,
  pinchRelease: 0.055,

  launchSeconds: 0.8, // the ring closes and the room dims, then the game opens

  // The sport grid, in metres. At 1.7 m it spans about 41 x 24 degrees, which sits inside the narrow view of
  // Meta VR Glasses (37 degrees to each side, 25 up, 43 down), so every tile is reachable with the eyes alone.
  grid: {
    distance: 1.7,
    height: 1.6, // on a PC. In a headset the grid is placed at the player's own eye level, seated or standing.
    tileW: 0.62,
    tileH: 0.35,
    gap: 0.03,
    headingH: 0, // no heading band across the top of the grid (the section labels were removed)
    cornerR: 0.008,
    stickiness: 0.025, // the gaze must leave the focused tile by this much to move on, so the ring does not flicker
  },

  // Columns of three: each column fills top to bottom, then the next column starts. `key` on a PC is this position + 1.
  games: [
    {
      id: 'baseball',
      title: 'Glove Up',
      art: 'baseball',
      row: 0,
      col: 0,
      port: 8082,
      storageKey: 'glove-up-best-25-major',
      bestSuffix: ' / 25',
    },
    {
      id: 'bulbrush',
      title: 'Bulb Rush',
      art: 'bulb',
      row: 1,
      col: 0,
      port: 8083,
      storageKey: 'bulbrush-best',
      bestSuffix: ' pts',
    },
    {
      id: 'ontheball',
      title: 'ON THE BALL',
      art: 'ontheball',
      row: 2,
      col: 0,
      port: 8084,
      storageKey: 'otb-best-green',
      bestSuffix: ' / 20 good sight',
    },
    {
      id: 'ontheballfootball',
      title: 'ON THE BALL Football',
      art: 'football',
      row: 0,
      col: 1,
      port: 8085,
      path: 'ontheball/football', // where the hub serves it
      storageKey: 'otb-football-best-green',
      bestSuffix: ' / 20 good sight',
    },
    {
      id: 'ontheballtennis',
      title: 'ON THE BALL Tennis',
      art: 'tennis',
      row: 1,
      col: 1,
      port: 8086,
      path: 'ontheball/tennis', // where the hub serves it
      storageKey: 'otb-tennis-best-green',
      bestSuffix: ' / 20 good sight',
    },
  ],
};

// How many columns and rows the grid has, counted from the games' positions.
function gridCounts(games) {
  const cols = Math.max(...games.map((game) => game.col + (game.span || 1)));
  const rows = Math.max(...games.map((game) => game.row)) + 1;
  return { cols, rows };
}

// The grid's size, so the guide and the visor frame it too.
export function gridSize(games = CFG.games, g = CFG.grid) {
  const { cols, rows } = gridCounts(games);
  return {
    w: cols * g.tileW + (cols - 1) * g.gap,
    h: g.headingH + rows * g.tileH + (rows - 1) * g.gap,
  };
}

// Where each game's tile sits on the grid: centre and size in metres, with (0, 0) at the middle of the whole grid.
export function tileRects(games = CFG.games, g = CFG.grid) {
  const { cols } = gridCounts(games);
  const pitchX = g.tileW + g.gap;
  const pitchY = g.tileH + g.gap;
  const top = gridSize(games, g).h / 2 - g.headingH; // the top edge of the first row
  return games.map((game) => {
    const span = game.span || 1;
    return {
      x: (game.col + span / 2 - cols / 2) * pitchX,
      y: top - game.row * pitchY - g.tileH / 2,
      w: span * g.tileW + (span - 1) * g.gap,
      h: g.tileH,
    };
  });
}

export function getGameUrl(game) {
  const loc = window.location;
  if (loc.port === '8080') {
    return `${loc.protocol}//${loc.hostname}:${game.port}/?autoxr=1`;
  }
  const basePath = loc.pathname.replace(/\/$/, '');
  const subfolder = game.path ?? (game.id === 'bulbrush' ? 'bulb' : game.id);
  // keep ?device=... so the emulator chosen in the lobby is also used inside the game, and add autoxr=1 so the game
  // re-enters VR on its own (leaving the lobby page ends the VR session, so without it the game opens on a flat preview)
  const params = new URLSearchParams(loc.search);
  params.set('autoxr', '1');
  return `${loc.origin}${basePath}/${subfolder}/?${params.toString()}`;
}

// The saved best score, as shown on a tile, or null when this browser has none to show.
export function bestText(game, storage = globalThis.localStorage) {
  try {
    const stored = storage.getItem(game.storageKey);
    return stored === null || stored === undefined ? null : `Best ${stored}${game.bestSuffix}`;
  } catch (e) {
    return null; // storage blocked
  }
}
