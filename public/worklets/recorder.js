class SparringRecorder extends AudioWorkletProcessor {
  constructor() {
    super(); this.pcm = new Int16Array(2560); this.n = 0;
    this.index = 0; this.next = 0; this.previous = 0; this.ratio = sampleRate / 16000;
  }
  put(sample) {
    const bounded = Math.max(-1, Math.min(1, sample));
    this.pcm[this.n++] = Math.round(bounded * (bounded < 0 ? 32768 : 32767));
    if (this.n === 2560) {
      const buffer = new ArrayBuffer(5120); const view = new DataView(buffer);
      for (let i = 0; i < 2560; i++) view.setInt16(i * 2, this.pcm[i], true);
      this.port.postMessage(buffer, [buffer]); this.n = 0;
    }
  }
  process(inputs, outputs) {
    for (const output of outputs) for (const channel of output) channel.fill(0);
    const channels = inputs[0];
    if (!channels || !channels[0]) return true;
    for (let i = 0; i < channels[0].length; i++) {
      let sample = 0;
      for (const channel of channels) sample += channel[i] || 0;
      sample /= channels.length;
      if (this.index === 0) this.previous = sample;
      while (this.next <= this.index) {
        const fraction = Math.max(0, Math.min(1, this.next - (this.index - 1)));
        this.put(this.previous + (sample - this.previous) * fraction);
        this.next += this.ratio;
      }
      this.previous = sample; this.index++;
    }
    return true;
  }
}
registerProcessor('sparring-recorder', SparringRecorder);
