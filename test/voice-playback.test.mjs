import assert from 'node:assert/strict';
import test from 'node:test';
import { Worker } from 'node:worker_threads';

// The bundled browser decoder references Worker when its module is evaluated.
const hadWorker = Object.hasOwn(globalThis, 'Worker');
globalThis.Worker ??= Worker;
const { SparringVoice, encodeTurnFrame } = await import('../public/voice.js');
if (!hadWorker) delete globalThis.Worker;

async function withBrowserGlobals(values, run) {
  const descriptors = new Map(Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  try {
    for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
    await run();
  } finally {
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
}

function browserSocket(mode) {
  return class {
    static OPEN = 1;
    static CONNECTING = 0;
    constructor() {
      this.readyState = 0;
      this.bufferedAmount = 0;
      queueMicrotask(() => {
        this.readyState = 1;
        this.onopen?.();
        if (mode === 'text') this.onmessage?.({ data: encodeTurnFrame(0x8a, 1, {}) });
      });
    }
    send() {}
    close() { this.readyState = 3; }
  };
}

test('new dialogues request playback by default in both protocols, while explicit mute is retained', async () => {
  for (const mode of ['text', 'virtual_streaming_dialogue']) {
    await withBrowserGlobals({ document: { baseURI: 'http://127.0.0.1:5317/' }, location: { protocol: 'http:' }, WebSocket: browserSocket(mode) }, async () => {
      for (const muted of [false, true]) {
        const requests = [];
        const voice = new SparringVoice();
        voice.setPlaybackEnabled = async value => { requests.push(value); voice.playbackEnabled = value; };
        try {
          await voice.start(123, { dialogueMode: mode, ...(muted ? { playbackEnabled: false } : {}) });
          assert.equal(voice.ready, true);
          assert.deepEqual(requests, muted ? [] : [true]);
          assert.equal(voice.playbackEnabled, !muted);
        } finally { await voice.stop(); }
      }
    });
  }
});

test('blocked autoplay reports a recoverable error and a later click can resume the same player', { timeout: 5000 }, async () => {
  const errors = [];
  const context = {
    state: 'suspended',
    resume: () => new Promise(() => {}),
    close: async () => { context.state = 'closed'; },
  };
  await withBrowserGlobals({ AudioContext: class {}, AudioWorkletNode: class {} }, async () => {
    const voice = new SparringVoice({ onError: error => errors.push(error) });
    voice.ready = true;
    voice.dialogueMode = 'virtual_streaming_dialogue';
    voice.playerContext = context;
    const player = voice.player = { port: { postMessage() {} }, disconnect() {} };
    try {
      await assert.rejects(voice.setPlaybackEnabled(true), /点击“朗读”开启声音/);
      assert.equal(voice.ready, true, '播放失败不能中断对话连接');
      assert.equal(voice.playbackEnabled, false);
      assert.equal(errors.length, 1);
      assert.equal(errors[0].recoverable, true);
      assert.equal(errors[0].kind, 'playback');
      context.resume = async () => { context.state = 'running'; };
      await voice.setPlaybackEnabled(true);
      assert.equal(voice.playbackEnabled, true);
      assert.equal(voice.playbackReady, true);
      assert.equal(voice.player, player, '重新开启沿用同一个播放器');
      await voice.setPlaybackEnabled(false);
      assert.equal(voice.playbackEnabled, false);
    } finally { await voice.stop(); }
  });
});

test('turning playback off during initialization prevents late audio replay', async () => {
  let finishResume;
  const context = {
    state: 'suspended',
    resume: () => new Promise(done => { finishResume = done; }),
    close: async () => { context.state = 'closed'; },
  };
  await withBrowserGlobals({ AudioContext: class {}, AudioWorkletNode: class {} }, async () => {
    const voice = new SparringVoice();
    voice.dialogueMode = 'virtual_streaming_dialogue';
    voice.playerContext = context;
    voice.player = { port: { postMessage() {} }, disconnect() {} };
    let replayed = 0;
    voice.audioCache = [{ event: 352, audio: new Uint8Array([1]) }];
    voice.enqueueAudioFrame = () => { replayed++; };
    try {
      const enabling = voice.setPlaybackEnabled(true);
      await voice.setPlaybackEnabled(false);
      context.state = 'running'; finishResume();
      await enabling;
      assert.equal(voice.playbackEnabled, false);
      assert.equal(replayed, 0);
    } finally { await voice.stop(); }
  });
});

test('real-time capture uses device rate and same-origin worklet, and permission failure retains dialogue', async () => {
  const sequence = [], modules = [], errors = [];
  let denied = false, stopped = 0;
  const track = { enabled: true, stop() { stopped++; } };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  const node = () => ({ connect() {}, disconnect() {}, port: { postMessage() {} } });
  class Context {
    constructor(options) { assert.equal(options, undefined); this.state = 'suspended'; this.destination = {}; this.audioWorklet = { addModule: async url => modules.push(url) }; }
    resume() { sequence.push('resume'); this.state = 'running'; return Promise.resolve(); }
    close() { this.state = 'closed'; return Promise.resolve(); }
    createMediaStreamSource() { return node(); }
    createGain() { return { ...node(), gain: { value: 1 } }; }
  }
  await withBrowserGlobals({ isSecureContext: true, AudioContext: Context, AudioWorkletNode: class { constructor() { return node(); } },
    navigator: { mediaDevices: { getUserMedia: async () => { sequence.push('permission'); if (denied) throw Object.assign(new Error('denied'), { name: 'NotAllowedError' }); return stream; } } } }, async () => {
    const voice = new SparringVoice({ onError: error => errors.push(error) });
    voice.ready = true; voice.dialogueMode = 'virtual_streaming_dialogue';
    try {
      await voice.setInputMode('voice');
      assert.deepEqual(sequence, ['resume', 'permission']);
      assert.equal(voice.inputMode, 'voice');
      assert.equal(modules.length, 1);
      assert.ok(modules[0].endsWith('/public/worklets/recorder.js'));
      assert.ok(!modules[0].startsWith('blob:'));
      await voice.setInputMode('text');
      denied = true;
      await assert.rejects(voice.setInputMode('voice'), /麦克风权限被拒绝/);
      assert.equal(voice.ready, true);
      assert.equal(voice.inputMode, 'text');
      assert.equal(errors.at(-1).stage, 'microphone');
      assert.equal(stopped, 1);
    } finally { await voice.stop(); }
  });
});

test('message voice sends once and releases capture, while failed empty audio can be retried', async () => {
  let sends = 0, stopped = 0;
  const track = { stop() { stopped++; } };
  const voice = new SparringVoice();
  const initialize = parts => {
    voice.ready = true; voice.dialogueMode = 'text'; voice.inputMode = 'voice'; voice.stream = { getTracks: () => [track] };
    voice.mediaRecorder = { mimeType: 'audio/webm', stop() { queueMicrotask(() => this.onstop()); } };
    voice.recordingParts = parts;
  };
  let rearmed = 0;
  voice.beginTurnRecording = () => { rearmed++; };
  voice.sendFrame = () => { sends++; };
  try {
    initialize([new Blob(['recording'])]);
    await voice.finishVoiceTurn();
    assert.equal(sends, 1); assert.equal(stopped, 1); assert.equal(rearmed, 0); assert.equal(voice.inputMode, 'text');
    initialize([]);
    await assert.rejects(voice.finishVoiceTurn(), /没有录到声音/);
    assert.equal(sends, 1); assert.equal(rearmed, 1); assert.equal(voice.inputMode, 'voice');
  } finally { await voice.stop(); }
});
