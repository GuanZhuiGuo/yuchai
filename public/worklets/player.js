class SparringPlayer extends AudioWorkletProcessor {
  constructor() {
    super(); this.queue = []; this.offset = 0; this.pending = 0; this.playing = false;
    this.port.onmessage = ({data}) => {
      if (data === 'clear') { this.queue = []; this.offset = 0; this.pending = 0; }
      else if (data instanceof Float32Array) {
        if (this.pending + data.length > sampleRate * 30) {
          this.queue = []; this.offset = 0; this.pending = 0;
          this.port.postMessage({error: '音频缓冲过长，请重新连接'}); return;
        }
        this.queue.push(data); this.pending += data.length;
      }
    };
  }
  process(_, outputs) {
    const out = outputs[0][0];
    for (let i = 0; i < out.length; i++) {
      const head = this.queue[0];
      if (!head) { out[i] = 0; continue; }
      out[i] = head[this.offset++]; this.pending--;
      if (this.offset >= head.length) { this.queue.shift(); this.offset = 0; }
    }
    const playing = this.queue.length > 0;
    if (playing !== this.playing) { this.playing = playing; this.port.postMessage({playing}); }
    return true;
  }
}
registerProcessor('sparring-player', SparringPlayer);
