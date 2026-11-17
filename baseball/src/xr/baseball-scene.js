// The ballpark under the lights, seen from the CATCHER's seat behind home plate: the real park from baseball-xr (striped outfield,
// painted infield, mound and rubber, plate, bases, outfield wall with a dark batter's eye behind the pitcher so the white ball
// stands out, stands full of fans, light towers, a starry sky) and the pitcher on the mound, 18.44 m away, who does the whole
// delivery. The player's own body is not drawn.
//
// Everything hangs on one group placed in the viewer's eye frame (origin at the eyes, -z straight ahead): the park's ground sits
// GROUND metres below the eyes, which is where a seated player's floor is, and home plate's point is 0.8 m in front of them.
// Distances come from FIELD in core/ball-path.js so the tests check them.

import { Group } from '@iwsdk/core';
import { FIELD } from '../core/ball-path.js';
import { buildBallpark } from './ballpark.js';
import { Pitcher } from './pitcher.js';

export const GROUND = FIELD.ground; // metres below the eyes

export class BaseballScene {
  constructor() {
    this.root = new Group();
    this.root.name = 'otb-baseball-park';
    this.root.position.y = GROUND;
    this.park = buildBallpark(this.root);
    this.pitcher = new Pitcher(this.root);
  }

  update(dt) {
    this.pitcher.update(dt);
  }
}
