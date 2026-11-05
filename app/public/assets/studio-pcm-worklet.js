/** Copy bounded mono packets out of the render thread; no microphone audio reaches speakers. */
class StudioPcmProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.buffer = new Float32Array(2048);
        this.length = 0;
        this.outstanding = 0;
        this.blocked = false;
        this.port.onmessage = ({data}) => {
            if (data?.type === 'ack') { this.outstanding = Math.max(0, this.outstanding - 1); return; }
            if (data?.type !== 'flush') return;
            this.send(true);
            this.port.postMessage({type: 'flushed', requestId: data.requestId});
        };
    }

    send(final = false) {
        if (!this.length) return;
        // Bound the MessagePort backlog when the browser's main thread is suspended.
        if (this.outstanding >= 8 && !final) {
            this.blocked = true;
            this.port.postMessage({type: 'overflow'});
            return;
        }
        const samples = this.buffer.slice(0, this.length);
        this.length = 0;
        this.outstanding += 1;
        this.port.postMessage({type: 'samples', samples}, [samples.buffer]);
    }

    process(inputs, outputs) {
        const channels = inputs[0] || [];
        const count = this.blocked ? 0 : channels[0]?.length || 0;
        for (let frame = 0; frame < count; frame += 1) {
            let sample = 0;
            for (const channel of channels) sample += channel[frame] || 0;
            this.buffer[this.length++] = sample / channels.length;
            if (this.length === this.buffer.length) this.send();
            if (this.blocked) break;
        }
        for (const output of outputs) for (const channel of output) channel.fill(0);
        return true;
    }
}

registerProcessor('govern-studio-pcm', StudioPcmProcessor);
