/** Wheel input varies by browser/device; preserve its units and canvas scope. */
import assert from 'node:assert/strict';
import {wheelZoomDelta, attachSchemaWheelZoom} from '../app/public/assets/schema-navigation.js';

let checks = 0;
const equal = (actual, expected, label) => { assert.equal(actual, expected, label); checks++; };
equal(wheelZoomDelta({deltaY: 120, deltaMode: 0}), 120, 'Pixel wheel units stay pixels.');
equal(wheelZoomDelta({deltaY: -3, deltaMode: 1}), -48, 'Line wheel units are normalized.');
equal(wheelZoomDelta({deltaY: .5, deltaMode: 2}, 400), 200, 'Page units use the current canvas height.');
equal(wheelZoomDelta({deltaY: 100000, deltaMode: 0}), 600, 'A large wheel event cannot cause an unbounded jump.');
equal(wheelZoomDelta({deltaY: -100000, deltaMode: 0}), -600, 'Negative jumps are bounded too.');
equal(wheelZoomDelta({deltaY: 0, deltaMode: 0}), 0, 'Horizontal-only input leaves zoom unchanged.');
equal(wheelZoomDelta({deltaY: NaN, deltaMode: 0}), 0, 'Invalid input is ignored.');
equal(wheelZoomDelta({deltaY: Infinity, deltaMode: 0}), 0, 'Infinite input is ignored.');

const listeners = new Map();
const nested = new Set();
const canvas = {
    clientHeight: 300,
    contains: node => nested.has(node),
    getBoundingClientRect: () => ({left: 25, top: 50}),
    addEventListener(type, handler, options) { listeners.set(type, handler); equal(options.passive, false, 'Canvas wheel handler can prevent page scrolling.'); },
    removeEventListener(type, handler) { if (listeners.get(type) === handler) listeners.delete(type); },
};
const wheel = (options = {}) => ({deltaY: -120, deltaMode: 0, clientX: 105, clientY: 110,
    target: canvas, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...options});
const events = [];
let zoom = 1;
const detach = attachSchemaWheelZoom(canvas, {getZoom: () => zoom, setZoom: (value, anchor) => events.push({value, anchor})});
const emit = event => { listeners.get('wheel')?.(event); return event; };
const ordinary = emit(wheel());
equal(ordinary.defaultPrevented, true, 'Ordinary wheel zoom does not require Ctrl.');
equal(events[0].value > 1, true, 'Wheel-up zooms in.');
assert.deepEqual(events[0].anchor, {x: 80, y: 60}); checks++;
const reverse = emit(wheel({deltaY: 120}));
equal(reverse.defaultPrevented, true, 'Wheel-down is handled in the canvas.');
equal(events[1].value < 1, true, 'Wheel-down zooms out.');
emit(wheel({deltaY: -30, ctrlKey: true}));
equal(events[2].value > 1, true, 'Trackpad pinch represented by Ctrl-wheel remains supported.');
const beforeIgnored = events.length;
equal(emit(wheel({deltaY: 0, deltaX: 90})).defaultPrevented, false, 'Horizontal-only input is not swallowed.');
emit(wheel({defaultPrevented: true}));
const control = {closest: () => control};
nested.add(control);
equal(emit(wheel({target: control})).defaultPrevented, false, 'Embedded controls retain their own wheel handling.');
zoom = NaN;
equal(emit(wheel()).defaultPrevented, false, 'An unavailable viewport cannot swallow the wheel.');
equal(events.length, beforeIgnored, 'Ignored wheel events do not change viewport state.');
zoom = 1;
detach();
equal(listeners.has('wheel'), false, 'Teardown removes the canvas-only event handler.');
emit(wheel());
equal(events.length, beforeIgnored, 'A detached handler cannot affect later screens.');

console.log(`${checks} schema navigation checks passed.`);
