// All audio stays in this browser. Box-filter resampling carries fractional
// sample weights across render quanta, avoiding 44.1 kHz clock drift.
class LensAudio extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / 16000;
    this.weight = 0; this.sum = 0;
    this.buffer = new Float32Array(80000); this.length = 0; this.total = 0;
    this.enabled = true;
    this.port.onmessage = ({ data }) => {
      if (data.type === 'flush' || data.type === 'pause') {
        this.flush(); this.enabled = data.type !== 'pause';
        this.port.postMessage({ type: 'ack', request: data.request });
      }
      if (data.type === 'resume') this.enabled = true;
    };
  }
  flush() {
    if (!this.length) return;
    const samples = this.buffer.slice(0, this.length);
    this.port.postMessage({ type: 'chunk', samples, start: (this.total - this.length) / 16000 }, [samples.buffer]);
    this.length = 0;
  }
  process(inputs) {
    if (!this.enabled || !inputs[0]?.length) return true;
    const channels = inputs[0];
    for (let i = 0; i < channels[0].length; i++) {
      let sample = 0;
      for (const ch of channels) sample += ch[i];
      sample /= channels.length;
      let remaining = 1;
      while (remaining > 1e-8) {
        const part = Math.min(remaining, this.ratio - this.weight);
        this.sum += sample * part; this.weight += part; remaining -= part;
        if (this.weight >= this.ratio - 1e-8) {
          this.buffer[this.length++] = this.sum / this.ratio;
          this.total++; this.sum = 0; this.weight = 0;
          if (this.length === this.buffer.length) this.flush();
        }
      }
    }
    return true;
  }
}
registerProcessor('lens-audio', LensAudio);
