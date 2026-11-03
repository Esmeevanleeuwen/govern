/** Paired windows exchange exact metadata without storage or cross-tab interference. */
import assert from 'node:assert/strict';
import {createCompanionSource, createCompanionReceiver} from '../app/public/assets/companion-channel.js';

const sockets = new Set(), messages = [], deliveries = [], timers = new Map();
let timerId = 0, now = 100000;
const original = {window: globalThis.window, BroadcastChannel: globalThis.BroadcastChannel,
    setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval, now: Date.now};
function run(window, task) { const previous = globalThis.window; globalThis.window = window; try { return task(); } finally { globalThis.window = previous; } }
function flush() {
    let count = 0;
    while (deliveries.length) {
        assert.ok(++count < 1000, 'Protocol must not loop.');
        const {socket, data} = deliveries.shift();
        if (!socket.closed && !socket.window.paused) run(socket.window, () => { for (const handler of socket.handlers) handler({data: structuredClone(data)}); });
    }
}
function tick(milliseconds = 2000) { now += milliseconds; for (const timer of [...timers.values()]) if (!timer.window.paused) run(timer.window, timer.task); flush(); }
class Channel {
    constructor(name) { this.name = name; this.window = window; this.handlers = new Set(); this.closed = false; sockets.add(this); }
    addEventListener(type, handler) { if (type === 'message') this.handlers.add(handler); }
    removeEventListener(type, handler) { this.handlers.delete(handler); }
    postMessage(data) {
        assert.equal(this.closed, false);
        messages.push({name: this.name, data: structuredClone(data)});
        for (const socket of sockets) if (socket !== this && socket.name === this.name && !socket.closed) deliveries.push({socket, data});
    }
    close() { this.closed = true; sockets.delete(this); }
}
function browserWindow(hash = '') {
    return {location: {hash, origin: 'http://localhost'}, opens: [], events: new Map(), blocked: false,
        addEventListener(type, callback) { if (!this.events.has(type)) this.events.set(type, new Set()); this.events.get(type).add(callback); },
        removeEventListener(type, callback) { this.events.get(type)?.delete(callback); },
        open(url, name, features) {
            this.opens.push({url, name, features});
            if (this.blocked) return null;
            this.popup = {closed: false, location: {href: new URL(url, this.location.origin).href}, focusCount: 0, focus() { this.focusCount++; }};
            return this.popup;
        }};
}
const context = {database: 'postgres:govern_pg:public', table: 'Odd : table', key: {tenant: '7', id: '9007199254740993'}, guided: true};
const second = {...context, key: {id: '9007199254740994', tenant: '7'}};

try {
    globalThis.BroadcastChannel = Channel;
    globalThis.setInterval = task => { const id = ++timerId; timers.set(id, {task, window}); return id; };
    globalThis.clearInterval = id => timers.delete(id);
    Date.now = () => now;
    const main = browserWindow(), sourceStatuses = [], inspected = [];
    const source = run(main, () => createCompanionSource({onStatus: value => sourceStatuses.push(value), onSelect: value => inspected.push(value)}));
    assert.equal(source.status, 'idle');
    assert.equal(run(main, () => source.select({...context, values: {private_note: 'must-not-cross-window'}, password: 'never-transmit'})), true);
    assert.equal(messages.length, 0, 'Selecting records does not open a channel or send to another tab before explicit use.');
    assert.equal(run(main, () => source.pin(context)), true);
    assert.equal(run(main, () => source.pin({...context, key: {id: context.key.id, tenant: '7'}})), true);
    assert.equal(main.opens.length, 1, 'A second send reuses the same browser window.');
    assert.equal(main.popup.focusCount, 0, 'Sending to an existing monitor preserves the main screen’s keyboard focus.');
    const firstOpen = main.opens[0];
    assert.match(firstOpen.url, /^\/companion\.php#[a-f0-9]{32}$/);
    assert.equal(firstOpen.url.includes(context.database), false, 'Record coordinates never enter the popup URL.');
    const monitor = browserWindow(new URL(firstOpen.url, 'http://localhost').hash), selections = [], pins = [], modes = [], statuses = [];
    const receiver = run(monitor, () => createCompanionReceiver({onSelection: value => selections.push(value), onPin: value => pins.push(value),
        onMode: value => modes.push(value), onStatus: value => statuses.push(value)}));
    flush();
    assert.equal(receiver.status, 'connected'); assert.equal(source.status, 'connected');
    assert.deepEqual(selections, [context]); assert.deepEqual(pins, [context], 'Repeated queued sends of the same exact record are deduplicated.');
    assert.deepEqual(modes, ['compare']);
    assert.ok(Object.isFrozen(selections[0]) && Object.isFrozen(selections[0].key));
    run(main, () => { for (const listener of main.events.get('pagehide')) listener({persisted: true}); });
    run(monitor, () => { for (const listener of monitor.events.get('pagehide')) listener({persisted: true}); });
    run(main, () => { for (const listener of main.events.get('pageshow')) listener({persisted: true}); });
    run(monitor, () => { for (const listener of monitor.events.get('pageshow')) listener({persisted: true}); });
    flush(); tick();
    assert.equal(source.status, 'connected'); assert.equal(receiver.status, 'connected', 'Back/forward-cache suspension can resume the same pairing.');

    run(main, () => source.select(second)); flush();
    assert.equal(selections.at(-1).key.id, '9007199254740994', 'Close large numeric keys remain exact strings.');
    const beforeSame = messages.length;
    run(main, () => source.select({...second, key: {tenant: '7', id: second.key.id}})); flush();
    assert.equal(messages.length, beforeSame, 'Field ordering cannot create a spurious selection update.');
    run(monitor, () => receiver.setMode('radar')); flush();
    const beforeRequestModes = [...modes];
    run(monitor, () => receiver.requestSelection()); flush();
    assert.deepEqual(modes, beforeRequestModes, 'Requesting current selection does not reset a locally selected mode.');
    run(main, () => source.open('radar')); flush();
    assert.equal(modes.at(-1), 'radar');
    run(monitor, () => receiver.sendSelect(context)); flush();
    assert.deepEqual(inspected, [context]);

    // An invalid high sequence cannot poison later valid updates, and replayed updates stay ignored.
    const sourceMessage = messages.find(item => item.data.role === 'source' && item.data.type === 'selection');
    const injection = run(main, () => new Channel(sourceMessage.name));
    run(main, () => injection.postMessage({...sourceMessage.data, sequence: Number.MAX_SAFE_INTEGER,
        data: {...context, key: {id: 9007199254740993}}})); flush();
    const beforeReplay = selections.length;
    run(main, () => injection.postMessage({...sourceMessage.data, data: context})); flush();
    assert.equal(selections.length, beforeReplay, 'Old sequence numbers cannot replace the current record.');
    run(main, () => source.select(context)); flush();
    assert.equal(selections.at(-1).key.id, context.key.id);
    assert.equal(selections.length, beforeReplay + 1, 'A malformed message never advances the accepted sequence.');
    injection.close();

    const mainB = browserWindow(), peerSelections = [];
    const sourceB = run(mainB, () => createCompanionSource());
    run(mainB, () => { sourceB.select(second); sourceB.open(); });
    const monitorB = browserWindow(new URL(mainB.opens[0].url, 'http://localhost').hash);
    const receiverB = run(monitorB, () => createCompanionReceiver({onSelection: value => peerSelections.push(value)})); flush();
    assert.notEqual(mainB.opens[0].name, firstOpen.name, 'Each main tab owns a distinct popup and channel.');
    const beforeA = selections.length;
    run(mainB, () => sourceB.select({...context, database: 'postgres:govern_pg:archive'})); flush();
    assert.equal(selections.length, beforeA);
    assert.equal(peerSelections.at(-1).database, 'postgres:govern_pg:archive');

    // A frozen monitor can reconnect through a heartbeat pong, without a reload/ready message.
    monitor.paused = true; tick(13000);
    assert.equal(source.status, 'disconnected');
    const pinBeforeResume = pins.length;
    run(main, () => source.pin(second));
    assert.equal(pins.length, pinBeforeResume);
    const monitorTimer = [...timers.entries()].find(([, timer]) => timer.window === monitor);
    timers.delete(monitorTimer[0]); monitor.paused = false; tick();
    assert.equal(source.status, 'connected');
    assert.equal(pins.length, pinBeforeResume + 1, 'A pin queued while disconnected is delivered when the monitor resumes.');
    assert.deepEqual(pins.at(-1), second);
    timers.set(...monitorTimer);

    const pinCount = pins.length;
    run(monitor, () => receiver.destroy()); flush();
    assert.equal(source.status, 'disconnected');
    main.popup.location.href = 'http://localhost/auth.php?mode=login';
    tick();
    assert.match(main.popup.location.href, /auth\.php/, 'Heartbeat never navigates a browser page in the background.');
    run(main, () => source.open('radar'));
    assert.equal(main.popup.location.href, 'http://localhost' + firstOpen.url,
        'Explicit open restores the paired route after login or manual navigation.');
    assert.equal(main.opens.length, 1, 'Restoring a departed popup reuses the existing monitor window.');
    const reloadedSelections = [];
    const reloaded = run(monitor, () => createCompanionReceiver({onSelection: value => reloadedSelections.push(value), onPin: value => pins.push(value)})); flush();
    assert.equal(source.status, 'connected');
    assert.deepEqual(reloadedSelections, [context], 'Reload handshake gets the latest captured main selection.');
    assert.equal(pins.length, pinCount, 'Delivered pin intents are not silently restored or persisted after reload.');
    tick(); assert.equal(reloaded.status, 'connected');
    run(main, () => source.destroy()); flush();
    assert.equal(reloaded.status, 'disconnected', 'Closing the main source informs the still-open monitor.');
    assert.deepEqual(reloadedSelections.at(-1), context, 'Disconnect never replaces the monitor’s record.');
    run(monitor, () => reloaded.destroy()); run(mainB, () => sourceB.destroy()); run(monitorB, () => receiverB.destroy()); flush();
    assert.equal(timers.size, 0); assert.equal(sockets.size, 0, 'Disposal removes both channel and heartbeat resources.');

    const blocked = browserWindow(); blocked.blocked = true;
    const blockedSource = run(blocked, () => createCompanionSource());
    assert.equal(run(blocked, () => blockedSource.pin(context)), false); assert.equal(blockedSource.status, 'blocked');
    assert.equal(blocked.opens.length, 1); tick(); assert.equal(blocked.opens.length, 1, 'A blocked popup is never reopened automatically.');
    run(blocked, () => blockedSource.destroy());
    globalThis.BroadcastChannel = undefined;
    const unsupported = run(main, () => createCompanionSource());
    assert.equal(run(main, () => unsupported.open()), false); assert.equal(unsupported.status, 'unsupported');
    run(main, () => unsupported.destroy());
    const invalid = run(browserWindow('#not-a-pairing-id'), () => createCompanionReceiver());
    assert.equal(invalid.status, 'invalid');
    run(main, () => invalid.destroy());
    assert.ok(messages.every(item => !JSON.stringify(item.data).includes('values') && !JSON.stringify(item.data).includes('password')),
        'Only typed metadata messages are emitted, never record rows or credentials.');
    console.log('PASS: companion pair isolation, exact metadata, startup pin delivery, sequence validation, mode/follow, reload, disconnect, blocked popup and resource disposal.');
} finally {
    globalThis.window = original.window; globalThis.BroadcastChannel = original.BroadcastChannel;
    globalThis.setInterval = original.setInterval; globalThis.clearInterval = original.clearInterval; Date.now = original.now;
}
