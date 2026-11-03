import assert from 'node:assert/strict';
import {constrainWindow} from '../app/public/assets/modal-geometry.js';

const viewport = {width: 1000, height: 700}, size = {width: 400, height: 300};
assert.deepEqual(constrainWindow({x: 100, y: 200}, size, viewport), {x: 100, y: 200});
assert.deepEqual(constrainWindow({x: -500, y: -300}, size, viewport), {x: 8, y: 8});
assert.deepEqual(constrainWindow({x: 900, y: 690}, size, viewport), {x: 592, y: 392});
assert.deepEqual(constrainWindow({x: 100, y: 100}, {width: 320, height: 600}, {width: 320, height: 600}), {x: 0, y: 0}, 'Full-size mobile windows keep their top and close control reachable.');
assert.deepEqual(constrainWindow({x: 100, y: 100}, {width: 500, height: 900}, {width: 320, height: 600}), {x: 0, y: 0});
assert.deepEqual(constrainWindow({x: 900, y: 600}, size, {width: 500, height: 400}), {x: 92, y: 92}, 'A resized viewport clamps a previously valid position.');
assert.deepEqual(constrainWindow({x: NaN, y: Infinity}, size, viewport), {x: 8, y: 392});
console.log('PASS: floating-window bounds preserve reachable controls across dragging and viewport changes.');
