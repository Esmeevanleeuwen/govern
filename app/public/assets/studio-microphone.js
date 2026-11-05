/** Live PCM capture, with explicit start and a bounded, recoverable sequential upload queue. */
export class MicrophoneError extends Error {
    constructor(code, cause) {
        super(code);
        this.name = 'MicrophoneError';
        this.code = code;
        if (cause) this.cause = cause;
    }
}

/** Each chunk is independently decodable: never upload fragments of a MediaRecorder container. */
export function encodePcmWav(samples, sampleRate) {
    if (!(samples instanceof Float32Array) || !samples.length || !Number.isInteger(sampleRate)
        || sampleRate < 8000 || sampleRate > 48000 || samples.length > sampleRate * 12) throw new MicrophoneError('device');
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);
    const ascii = (offset, value) => [...value].forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)));
    ascii(0, 'RIFF'); view.setUint32(4, buffer.byteLength - 8, true); ascii(8, 'WAVE');
    ascii(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true); view.setUint16(34, 16, true); ascii(36, 'data');
    view.setUint32(40, samples.length * 2, true);
    for (let index = 0; index < samples.length; index += 1) {
        const finite = Number.isFinite(samples[index]) ? samples[index] : 0;
        const sample = Math.max(-1, Math.min(1, finite));
        view.setInt16(44 + index * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
    }
    return buffer;
}

/** Frame-based times remain contiguous regardless of network delay or render packet boundaries. */
export class PcmChunker {
    constructor(sampleRate, chunkSeconds, onChunk) {
        if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 48000
            || !Number.isFinite(chunkSeconds) || chunkSeconds < 1 || chunkSeconds > 12 || typeof onChunk !== 'function') {
            throw new MicrophoneError('device');
        }
        this.sampleRate = sampleRate;
        this.capacity = Math.floor(sampleRate * chunkSeconds);
        this.samples = new Float32Array(this.capacity);
        this.length = 0;
        this.frames = 0;
        this.sequence = 0;
        this.onChunk = onChunk;
    }

    push(packet) {
        if (!(packet instanceof Float32Array)) throw new MicrophoneError('device');
        let offset = 0;
        while (offset < packet.length) {
            const size = Math.min(packet.length - offset, this.capacity - this.length);
            this.samples.set(packet.subarray(offset, offset + size), this.length);
            this.length += size;
            offset += size;
            if (this.length === this.capacity) this.flush();
        }
    }

    flush() {
        if (!this.length) return;
        const samples = this.samples.slice(0, this.length);
        const start = Math.round(this.frames * 1000 / this.sampleRate);
        const chunk = {blob: new Blob([encodePcmWav(samples, this.sampleRate)], {type: 'audio/wav'}),
            sequence: this.sequence, start_ms: start,
            end_ms: Math.max(start + 1, Math.round((this.frames + this.length) * 1000 / this.sampleRate)), operation_id: randomId()};
        this.onChunk(chunk);
        // Keep the PCM intact if a bounded queue refuses the chunk.
        this.sequence += 1;
        this.frames += this.length;
        this.length = 0;
    }
}

function randomId() {
    if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
    if (!globalThis.crypto?.getRandomValues) throw new MicrophoneError('unsupported');
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
    return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
}

/** A failed head stays in place with its original operation ID until an explicit retry. */
export function createUploadQueue({send, maxPending = 8, onChange = () => {}, onFailure = () => {}}) {
    const entries = [];
    let active = false, failure = null;
    const waiters = new Set();
    const report = () => onChange({queued: entries.length, active, failed: Boolean(failure)});
    const settle = () => {
        if (!failure && entries.length) return;
        for (const waiter of waiters) failure ? waiter.reject(failure) : waiter.resolve();
        waiters.clear();
    };
    const pump = async () => {
        if (active || failure || !entries.length) { settle(); return; }
        active = true;
        report();
        try {
            while (entries.length && !failure) {
                await send(entries[0]);
                entries.shift();
                report();
            }
        } catch (error) {
            failure = error;
            onFailure(error);
        } finally {
            active = false;
            report();
            settle();
        }
    };
    const flush = () => {
        if (failure) return Promise.reject(failure);
        if (!entries.length && !active) return Promise.resolve();
        return new Promise((resolve, reject) => { waiters.add({resolve, reject}); });
    };
    return {
        enqueue(entry) {
            if (entries.length >= maxPending) throw new MicrophoneError('queue');
            entries.push(entry); report(); void pump();
        },
        flush,
        retry() { failure = null; queueMicrotask(() => { void pump(); }); return flush(); },
        get pending() { return entries.length; },
        get failed() { return failure; },
    };
}

export function createMicrophone({onChunk, onState = () => {}, onError = () => {}, chunkSeconds = 6}) {
    if (typeof onChunk !== 'function') throw new TypeError('onChunk is required');
    let mode = 'idle', capturing = false, accepting = false, generation = 0;
    let stream = null, context = null, source = null, worklet = null, chunker = null;
    let releasePromise = null, stopPromise = null, flushWaiter = null, disposed = false;
    let startPending = false, releasePending = false;
    let lastState = {state: mode, queued: 0, capturing: false};
    const notify = () => {
        const state = ['starting', 'stopping', 'failed'].includes(mode) ? mode
            : capturing ? 'recording' : queue.pending ? 'sending' : mode;
        lastState = {state, queued: queue.pending, capturing};
        onState(lastState);
    };
    const queue = createUploadQueue({send: onChunk, onChange: notify, onFailure: error => {
        void halt(new MicrophoneError('transport', error));
    }});

    const releaseCapture = () => {
        if (releasePromise) return releasePromise;
        releasePending = true;
        capturing = false;
        source?.disconnect();
        for (const track of stream?.getTracks() || []) track.stop();
        stream = null;
        releasePromise = (async () => {
            if (worklet && context?.state === 'running') {
                await new Promise(resolve => {
                    const timeout = setTimeout(() => {
                        flushWaiter = null;
                        onError(new MicrophoneError('interrupted'));
                        resolve();
                    }, 800);
                    flushWaiter = () => { clearTimeout(timeout); flushWaiter = null; resolve(); };
                    worklet.port.postMessage({type: 'flush', requestId: generation});
                });
            }
            accepting = false;
            if (worklet) { worklet.port.onmessage = null; worklet.disconnect(); }
            if (context && context.state !== 'closed') await context.close().catch(() => {});
            worklet = null; context = null; source = null;
            chunker?.flush();
            notify();
        })().finally(() => { releasePending = false; });
        return releasePromise;
    };

    const halt = async error => {
        mode = 'failed';
        notify();
        onError(error);
        try { await releaseCapture(); } catch (releaseError) { onError(new MicrophoneError('device', releaseError)); }
    };

    const stop = () => {
        if (stopPromise) return stopPromise;
        generation += 1;
        if (mode !== 'failed') mode = 'stopping';
        notify();
        stopPromise = (async () => {
            await releaseCapture();
            await queue.flush();
            mode = 'stopped'; notify();
        })();
        // Callers await this promise; also mark it handled for lifecycle-triggered stop.
        stopPromise.catch(() => {});
        return stopPromise;
    };

    const interrupt = () => {
        if (capturing || mode === 'starting') {
            generation += 1;
            void halt(new MicrophoneError('interrupted'));
        }
    };
    const onVisibility = () => { if (globalThis.document?.hidden) interrupt(); };
    globalThis.document?.addEventListener('visibilitychange', onVisibility);
    globalThis.window?.addEventListener('pagehide', interrupt);
    const beforeUnload = event => {
        if (!capturing && !queue.pending) return;
        event.preventDefault(); event.returnValue = '';
        interrupt();
    };
    globalThis.window?.addEventListener('beforeunload', beforeUnload);

    return {
        async start() {
            if (disposed) throw new MicrophoneError('unsupported');
            if (capturing) return;
            // Old permission prompts and worklet-flush callbacks still own their resources.
            if (startPending || releasePending || mode === 'stopping') throw new MicrophoneError('device');
            if (queue.pending) throw new MicrophoneError('transport', queue.failed);
            if (!globalThis.isSecureContext) throw new MicrophoneError('secure');
            const Audio = globalThis.AudioContext || globalThis.webkitAudioContext;
            if (!globalThis.navigator?.mediaDevices?.getUserMedia || !Audio || !globalThis.AudioWorkletNode) {
                throw new MicrophoneError('unsupported');
            }
            mode = 'starting'; releasePromise = null; stopPromise = null;
            startPending = true;
            const version = ++generation;
            notify();
            let ownedContext = null, ownedStream = null;
            try {
                // Resume synchronously from the user's click, before awaiting the permission prompt on iOS.
                ownedContext = new Audio({latencyHint: 'interactive'});
                context = ownedContext;
                const resumed = ownedContext.resume();
                resumed.catch(() => {});
                ownedStream = await navigator.mediaDevices.getUserMedia({audio: {channelCount: 1, echoCancellation: true, noiseSuppression: true}, video: false});
                if (version !== generation) throw new MicrophoneError('interrupted');
                stream = ownedStream;
                await resumed;
                if (version !== generation) throw new MicrophoneError('interrupted');
                if (!ownedContext.audioWorklet) throw new MicrophoneError('unsupported');
                await ownedContext.audioWorklet.addModule(new URL('./studio-pcm-worklet.js', import.meta.url));
                if (version !== generation) throw new MicrophoneError('interrupted');
                chunker = new PcmChunker(ownedContext.sampleRate, chunkSeconds, chunk => {
                    queue.enqueue(chunk);
                    // Reserve room for the worklet's final packet and partial chunk while capture is stopping.
                    if (queue.pending >= 6 && capturing) void halt(new MicrophoneError('queue'));
                });
                source = ownedContext.createMediaStreamSource(ownedStream);
                worklet = new AudioWorkletNode(ownedContext, 'govern-studio-pcm', {numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1]});
                accepting = true;
                worklet.port.onmessage = ({data}) => {
                    if (data?.type === 'flushed') { flushWaiter?.(); return; }
                    if (data?.type === 'overflow') { void halt(new MicrophoneError('queue')); return; }
                    if (accepting && data?.type === 'samples') {
                        worklet.port.postMessage({type: 'ack'});
                        try { chunker.push(data.samples); }
                        catch (error) { void halt(error instanceof MicrophoneError ? error : new MicrophoneError('device', error)); }
                    }
                };
                worklet.onprocessorerror = () => { void halt(new MicrophoneError('device')); };
                for (const track of ownedStream.getAudioTracks()) track.addEventListener('ended', interrupt, {once: true});
                ownedContext.addEventListener('statechange', () => { if (capturing && ownedContext.state !== 'running') interrupt(); });
                source.connect(worklet); worklet.connect(ownedContext.destination);
                capturing = true; mode = 'recording'; notify();
            } catch (error) {
                for (const track of ownedStream?.getTracks() || []) track.stop();
                if (ownedContext && ownedContext.state !== 'closed') await ownedContext.close().catch(() => {});
                stream = null; context = null; accepting = false; capturing = false;
                const known = error instanceof MicrophoneError ? error : new MicrophoneError(
                    ['NotAllowedError', 'SecurityError'].includes(error.name) ? 'permission' : 'device', error);
                mode = 'failed'; notify(); onError(known); throw known;
            } finally { startPending = false; }
        },
        stop,
        async retry() {
            if (capturing || startPending || releasePending) throw new MicrophoneError('device');
            await releaseCapture();
            mode = 'stopping'; notify();
            stopPromise = null;
            try { await queue.retry(); mode = 'stopped'; notify(); }
            catch (error) { mode = 'failed'; notify(); throw error; }
        },
        async dispose() {
            disposed = true;
            globalThis.document?.removeEventListener('visibilitychange', onVisibility);
            globalThis.window?.removeEventListener('pagehide', interrupt);
            globalThis.window?.removeEventListener('beforeunload', beforeUnload);
            return stop();
        },
        getState() { return {...lastState}; },
        get pending() { return queue.pending; },
    };
}
