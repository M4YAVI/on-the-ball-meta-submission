import test from 'node:test';
import assert from 'node:assert/strict';
import { bestText, CFG, gridSize, tileRects } from '../src/config.js';
import { PinchDetector } from '../src/gestures.js';
import { pickTile } from '../src/gaze.js';
import { guideStep } from '../src/guide.js';

const { gap, stickiness, distance } = CFG.grid;
const rects = tileRects();
const at = (id) => rects[CFG.games.findIndex((g) => g.id === id)];
const pick = (x, y, current = -1) => pickTile(x, y, rects, current, gap, stickiness);

test('Config: the seven games, on distinct ports that are not the lobby', () => {
  assert.deepEqual(CFG.games.map((g) => g.id), ['baseball', 'cricket', 'bulbrush', 'ontheball', 'ontheballfootball', 'ontheballtennis', 'ontheballbaseball']);
  const ports = CFG.games.map((g) => g.port);
  assert.equal(new Set(ports).size, 7);
  assert.ok(!ports.includes(8080));
});

test('Layout: three to a row, in reading order: Glove Up, Cricket Catch, Bulb Rush across the top', () => {
  const top = at('baseball').y;
  assert.ok(Math.abs(at('cricket').y - top) < 1e-9 && Math.abs(at('bulbrush').y - top) < 1e-9);
  assert.ok(at('baseball').x < at('cricket').x && at('cricket').x < at('bulbrush').x);
  assert.ok(Math.abs(at('baseball').w - at('cricket').w) < 1e-9 && Math.abs(at('bulbrush').w - at('cricket').w) < 1e-9);
});

test('Layout: ON THE BALL, Football and Tennis share the second row, in that order, under the top three', () => {
  const row = at('ontheball').y;
  assert.ok(row < at('baseball').y);
  assert.ok(Math.abs(at('ontheballfootball').y - row) < 1e-9 && Math.abs(at('ontheballtennis').y - row) < 1e-9);
  assert.ok(at('ontheball').x < at('ontheballfootball').x && at('ontheballfootball').x < at('ontheballtennis').x);
});

test('Layout: ON THE BALL Baseball sits on its own row under ON THE BALL, in the left column (the batsman view stays cricket)', () => {
  const b = at('ontheballbaseball');
  const o = at('ontheball');
  assert.ok(b.y < o.y, 'a row below the second row');
  assert.ok(Math.abs(b.x - o.x) < 1e-9 && Math.abs(b.w - o.w) < 1e-9);
  assert.equal(CFG.games.find((g) => g.id === 'ontheballbaseball').path, 'ontheball/baseball');
  assert.notEqual(CFG.games.find((g) => g.id === 'ontheballbaseball').art, CFG.games.find((g) => g.id === 'baseball').art, 'its picture is not the Glove Up one');
});

test('Layout: the whole grid fits the view of Meta VR Glasses without a head turn', () => {
  const { w, h } = gridSize();
  const deg = (metres) => (Math.atan(metres / distance) * 180) / Math.PI;
  assert.ok(deg(w / 2) < 37, `${deg(w / 2).toFixed(1)} degrees to each side`);
  assert.ok(deg(h / 2) < 25, `${deg(h / 2).toFixed(1)} degrees up and down`);
});

test('Gaze: each tile is picked from its own centre, and off the grid is nothing', () => {
  CFG.games.forEach((g, i) => assert.equal(pick(rects[i].x, rects[i].y), i, g.id));
  assert.equal(pick(5, 0), -1);
  assert.equal(pick(0, 5), -1);
});

test('Gaze: there is no dead strip in the gap between two tiles', () => {
  assert.notEqual(pick((at('baseball').x + at('cricket').x) / 2, at('cricket').y), -1, 'between Glove Up and Cricket Catch');
  assert.notEqual(pick(at('baseball').x, (at('baseball').y + at('ontheball').y) / 2), -1, 'between the top row and the second');
});

test('Gaze: the ring stays put until the eyes have clearly left the tile', () => {
  const baseball = CFG.games.findIndex((g) => g.id === 'baseball');
  const cricket = CFG.games.findIndex((g) => g.id === 'cricket');
  const justOverTheLine = at('cricket').x - at('cricket').w / 2 + 0.005;
  assert.equal(pick(justOverTheLine, at('cricket').y, baseball), baseball, 'a small wobble does not move it');
  assert.equal(pick(at('cricket').x, at('cricket').y, baseball), cricket, 'a real look does');
});

test('Pinch: one close is one press, however long it is held', () => {
  const p = new PinchDetector();
  assert.equal(p.update(0.1), false, 'open');
  assert.equal(p.update(0.01), true, 'closes');
  for (let i = 0; i < 30; i++) assert.equal(p.update(0.01), false, 'held');
  assert.equal(p.update(0.1), false, 'opens');
  assert.equal(p.update(0.01), true, 'closes again');
});

test('Pinch: fingers trembling around the threshold do not press twice', () => {
  const p = new PinchDetector();
  p.update(0.1);
  assert.equal(p.update(0.02), true);
  for (const d of [0.035, 0.02, 0.05, 0.02, 0.04]) assert.equal(p.update(d), false, `at ${d}`);
});

test('Pinch: a hand that is first seen already pinched must open before it can press', () => {
  const p = new PinchDetector();
  assert.equal(p.update(0.01), false);
  assert.equal(p.update(0.01), false);
  p.update(0.1);
  assert.equal(p.update(0.01), true);
});

test('Pinch: losing tracking forgets the hand, so its return cannot press', () => {
  const p = new PinchDetector();
  p.update(0.1);
  assert.equal(p.update(null), false);
  assert.equal(p.update(0.01), false, 'reappears closed');
});

test('Guide: asks for a look, then a pinch; on a PC, a click', () => {
  assert.equal(guideStep(false, false), 'desktop');
  assert.equal(guideStep(false, true), 'desktop');
  assert.equal(guideStep(true, false), 'look');
  assert.equal(guideStep(true, true), 'pinch');
});

test('Best score: shown when saved, absent when not, and safe when storage is blocked', () => {
  const game = CFG.games.find((g) => g.id === 'cricket');
  assert.equal(bestText(game, { getItem: () => '31' }), 'Best 31 / 50');
  assert.equal(bestText(game, { getItem: () => null }), null);
  const blocked = { getItem: () => { throw new Error('blocked'); } };
  assert.equal(bestText(game, blocked), null);
});
