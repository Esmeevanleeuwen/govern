import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createMicrophone, createUploadQueue, encodePcmWav, PcmChunker} from '../app/public/assets/studio-microphone.js';

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return {promise, resolve, reject}; };
let checks = 0;
const check = (condition, message) => { checks++; assert.ok(condition, message); };

const encoded = encodePcmWav(new Float32Array([-2, -1, 0, 1, 2, NaN]), 16000);
const view = new DataView(encoded);
check(new TextDecoder().decode(new Uint8Array(encoded, 0, 4)) === 'RIFF' && view.getUint32(4, true) === encoded.byteLength - 8, 'Standalone RIFF length.');
check(view.getUint16(22, true) === 1 && view.getUint32(24, true) === 16000 && view.getUint16(34, true) === 16, 'Mono PCM16 uses actual browser rate.');
assert.deepEqual(Array.from({length: 6}, (_, index) => view.getInt16(44 + index * 2, true)), [-32768, -32768, 0, 32767, 32767, 0]); checks++;
const chunks = [];
const chunker = new PcmChunker(8000, 1, chunk => chunks.push(chunk));
chunker.push(new Float32Array(12000)); chunker.push(new Float32Array(7000)); chunker.flush(); chunker.flush();
assert.deepEqual(chunks.map(({sequence, start_ms, end_ms}) => ({sequence, start_ms, end_ms})),
    [{sequence: 0, start_ms: 0, end_ms: 1000}, {sequence: 1, start_ms: 1000, end_ms: 2000}, {sequence: 2, start_ms: 2000, end_ms: 2375}]); checks++;
check(new Set(chunks.map(chunk => chunk.operation_id)).size === 3 && chunks.every(chunk => chunk.blob.type === 'audio/wav'), 'One immutable ID per standalone WAV.');
const tiny = [];
const highRate = new PcmChunker(44100, 6, chunk => tiny.push(chunk));
for (let index = 0; index < 646; index++) highRate.push(new Float32Array(2048));
highRate.flush();
check(tiny.at(-1).end_ms > tiny.at(-1).start_ms, 'Sub-millisecond final audio remains a valid timed segment.');

const first = deferred(), sent = [];
let concurrent = 0, maxConcurrent = 0, rejectFirst = true;
const queue = createUploadQueue({send: async item => {
    sent.push(item); concurrent++; maxConcurrent = Math.max(concurrent, maxConcurrent);
    try { if (rejectFirst) { rejectFirst = false; await first.promise; } }
    finally { concurrent--; }
}});
const a = {sequence: 0, operation_id: 'stable'}, b = {sequence: 1};
queue.enqueue(a); queue.enqueue(b);
check(sent.length === 1 && queue.pending === 2, 'Only one upload is in flight.');
const failedDrain = queue.flush(); first.reject(new Error('network')); await assert.rejects(failedDrain); checks++;
check(queue.pending === 2 && queue.failed, 'Failure retains head and following chunks.');
await queue.retry();
assert.deepEqual(sent, [a, a, b]); checks++;
check(maxConcurrent === 1 && queue.pending === 0, 'Retry preserves exact operation and FIFO without overlap.');
const held = deferred();
const bounded = createUploadQueue({maxPending: 2, send: () => held.promise});
bounded.enqueue(1); bounded.enqueue(2);
assert.throws(() => bounded.enqueue(3), error => error.code === 'queue'); checks++;
held.resolve(); await bounded.flush();

class FakeTrack extends EventTarget { stopped = 0; stop() { this.stopped++; } }
const tracks = [];
const streams = [];
const nodes = [];
let heldFlush = null;
let media = async () => {
    const track = new FakeTrack(); tracks.push(track);
    const stream = {getTracks: () => [track], getAudioTracks: () => [track]}; streams.push(stream); return stream;
};
class FakeAudio extends EventTarget {
    sampleRate = 8000; state = 'suspended'; destination = {};
    audioWorklet = {addModule: async () => {}};
    resume() { this.state = 'running'; return Promise.resolve(); }
    close() { this.state = 'closed'; return Promise.resolve(); }
    createMediaStreamSource() { return {connect() {}, disconnect() {}}; }
}
class FakeWorklet {
    constructor() {
        this.port = {onmessage: null, postMessage: data => {
            if (data.type === 'flush') {
                const acknowledge = () => this.port.onmessage?.({data: {type: 'flushed'}});
                if (heldFlush) heldFlush.push(acknowledge); else queueMicrotask(acknowledge);
            }
        }};
        nodes.push(this);
    }
    connect() {} disconnect() {}
    samples(length) { this.port.onmessage?.({data: {type: 'samples', samples: new Float32Array(length)}}); }
}
Object.defineProperties(globalThis, {
    navigator: {value: {mediaDevices: {getUserMedia: () => media()}}, configurable: true},
    isSecureContext: {value: true, configurable: true}, AudioContext: {value: FakeAudio, configurable: true},
    AudioWorkletNode: {value: FakeWorklet, configurable: true},
    document: {value: new EventTarget(), configurable: true}, window: {value: new EventTarget(), configurable: true},
});

const uploads = [], inFlight = deferred(); let firstUpload = true;
const mic = createMicrophone({chunkSeconds: 1, onChunk: async chunk => { uploads.push(chunk); if (firstUpload) { firstUpload = false; await inFlight.promise; } }});
await mic.start(); nodes.at(-1).samples(10000);
let stopped = false; const stopping = mic.stop().then(() => { stopped = true; });
await tick();
check(tracks.at(-1).stopped > 0 && !stopped && mic.pending === 2, 'Stop releases microphone then waits for upload and tail.');
inFlight.resolve(); await stopping;
check(stopped && uploads.length === 2 && uploads[1].start_ms === 1000 && uploads[1].end_ms === 1250, 'Tail flushes exactly once before stop resolves.');
await mic.stop(); check(uploads.length === 2, 'Repeated stop does not duplicate the tail.');
await mic.dispose();

const releasing = createMicrophone({onChunk: async () => {}});
await releasing.start(); heldFlush = [];
const release = releasing.stop();
await assert.rejects(releasing.start(), error => error.code === 'device'); checks++;
heldFlush.shift()(); heldFlush = null; await release;
await releasing.start();
check(releasing.getState().capturing, 'A new capture starts only after the previous release settled.');
await releasing.dispose();

const pendingPermission = deferred(); media = () => pendingPermission.promise;
const cancelled = createMicrophone({onChunk: async () => {}});
const starting = cancelled.start(); await cancelled.stop();
await assert.rejects(cancelled.start(), error => error.code === 'device'); checks++;
const lateTrack = new FakeTrack(); pendingPermission.resolve({getTracks: () => [lateTrack], getAudioTracks: () => [lateTrack]});
await assert.rejects(starting, error => error.code === 'interrupted'); checks++;
check(lateTrack.stopped > 0 && !cancelled.getState().capturing, 'A late permission result cannot restart a stopped recording.');
await cancelled.dispose();

media = async () => { const track = new FakeTrack(); tracks.push(track); return {getTracks: () => [track], getAudioTracks: () => [track]}; };
const failures = []; let failOnce = true;
const failedMic = createMicrophone({chunkSeconds: 1, onChunk: async () => { if (failOnce) { failOnce = false; throw new Error('401'); } }, onError: error => failures.push(error.code)});
await failedMic.start(); nodes.at(-1).samples(8000); await tick();
check(tracks.at(-1).stopped > 0 && failedMic.pending === 1 && failures.includes('transport'), 'A failed upload stops actual capture and preserves its chunk.');
await failedMic.retry();
check(!failedMic.getState().capturing && failedMic.pending === 0, 'Manual retry sends pending data without restarting microphone.');
await failedMic.dispose();

const interrupted = createMicrophone({onChunk: async () => {}, onError: error => failures.push(error.code)});
await interrupted.start(); document.hidden = true; document.dispatchEvent(new Event('visibilitychange')); await tick();
check(tracks.at(-1).stopped > 0 && failures.includes('interrupted') && !interrupted.getState().capturing, 'Hidden-page capture stops with an explicit interruption.');
await interrupted.dispose();

let Processor;
const packets = [];
vm.runInNewContext(await readFile(new URL('../app/public/assets/studio-pcm-worklet.js', import.meta.url), 'utf8'), {
    Float32Array,
    AudioWorkletProcessor: class { port = {postMessage: message => packets.push(message)}; },
    registerProcessor(name, implementation) { assert.equal(name, 'govern-studio-pcm'); Processor = implementation; },
});
const processor = new Processor();
const output = [new Float32Array(2048).fill(1)];
for (let index = 0; index < 100; index++) processor.process([[new Float32Array(2048).fill(0.5)]], [output]);
check(packets.filter(packet => packet.type === 'samples').length === 8 && packets.filter(packet => packet.type === 'overflow').length === 1,
    'A blocked main thread has at most eight in-flight worklet packets and one explicit overflow.');
processor.port.onmessage({data: {type: 'flush', requestId: 1}});
check(packets.filter(packet => packet.type === 'samples').length === 9 && packets.at(-1).type === 'flushed'
    && output[0].every(value => value === 0), 'Final bounded worklet tail is retained and speaker output stays silent.');
console.log(`Studio microphone: ${checks} checks passed.`);
