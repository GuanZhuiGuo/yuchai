import { OggOpusDecoder } from './assets/opus-decoder.js';

const encoder = new TextEncoder();
const textDecoder = new TextDecoder();
const START_CONNECTION = 1;
const TASK_REQUEST = 200;
const CHAT_TEXT_QUERY = 501;
const MAX_BUFFER = 1024 * 1024;

function browserSessionId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function recoverableError(error, kind) {
  const failure = error instanceof Error ? error : new Error(String(error));
  return Object.assign(failure, { recoverable: true, kind });
}

export function encodeFrame(messageType, event, sessionId = '', payload = new Uint8Array()) {
  const sid = encoder.encode(sessionId);
  const size = 4 + 4 + (sid.length ? 4 + sid.length : 0) + 4 + payload.length;
  const buffer = new ArrayBuffer(size);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  bytes.set([0x11, (messageType << 4) | 0x04, 0x10, 0x00]);
  let offset = 4;
  view.setUint32(offset, event); offset += 4;
  if (sid.length) {
    view.setUint32(offset, sid.length); offset += 4;
    bytes.set(sid, offset); offset += sid.length;
  }
  view.setUint32(offset, payload.length); offset += 4;
  bytes.set(payload, offset);
  return buffer;
}

function parseJSONPayload(bytes) {
  let value = JSON.parse(textDecoder.decode(bytes) || '{}');
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { /* Some payloads are plain text. */ }
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (typeof child === 'string' && /^[\[{]/.test(child.trim())) {
        try { value[key] = JSON.parse(child); } catch { /* Keep literal content. */ }
      }
    }
  }
  return value;
}

export function decodeFrame(buffer) {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 12) throw new Error('真实语音响应帧不完整');
  const view = new DataView(buffer);
  const version = view.getUint8(0) >> 4;
  let offset = (view.getUint8(0) & 0x0f) * 4;
  const type = view.getUint8(1) >> 4;
  const flag = view.getUint8(1) & 0x0f;
  if (version !== 1 || offset < 4 || offset > buffer.byteLength) throw new Error('真实语音协议版本不匹配');
  if (![0b1001, 0b1011, 0b1111].includes(type)) throw new Error('真实语音消息类型不匹配');
  if ((view.getUint8(2) & 0x0f) !== 0) throw new Error('真实语音响应使用了未接入的压缩格式');
  const uint32 = () => {
    if (offset + 4 > buffer.byteLength) throw new Error('真实语音响应长度不正确');
    const value = view.getUint32(offset); offset += 4;
    return value;
  };
  const frame = { event: 0 };
  if (type === 0b1111) frame.code = uint32();
  else {
    if ((flag & 0x04) !== 0) frame.event = uint32();
    const sidLength = uint32();
    if (sidLength > buffer.byteLength - offset) throw new Error('真实语音会话标识长度不正确');
    offset += sidLength;
  }
  const payloadLength = uint32();
  if (payloadLength > buffer.byteLength - offset) throw new Error('真实语音内容长度不正确');
  const payload = new Uint8Array(buffer, offset, payloadLength);
  if (type === 0b1011) frame.audio = payload;
  else frame.json = parseJSONPayload(payload);
  return frame;
}

// The deployed turn-based frontend uses a separate ten-byte binary envelope.
export function encodeTurnFrame(messageType, messageId, payload) {
  const bytes = payload instanceof Uint8Array ? payload : encoder.encode(JSON.stringify(payload));
  const buffer = new ArrayBuffer(10 + bytes.length);
  const view = new DataView(buffer);
  new Uint8Array(buffer).set([1, 1, messageType, 0]);
  view.setUint16(4, messageId);
  view.setUint32(6, bytes.length);
  new Uint8Array(buffer, 10).set(bytes);
  return buffer;
}

export function decodeTurnFrame(buffer) {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 10) throw new Error('轮次对话响应帧不完整');
  const view = new DataView(buffer);
  if (view.getUint8(0) !== 1 || view.getUint8(1) !== 1) throw new Error('轮次对话协议版本不匹配');
  const type = view.getUint8(2);
  const size = view.getUint32(6);
  if (size !== buffer.byteLength - 10) throw new Error('轮次对话内容长度不正确');
  const bytes = new Uint8Array(buffer, 10, size);
  return { type, messageId: view.getUint16(4), ...(type === 0x83 ? { audio: bytes } : { json: parseJSONPayload(bytes) }) };
}

// Worklet output remains silent. It resamples any actual AudioContext rate to
// 16 kHz and emits 2,560 signed, little-endian samples (160 ms / 5,120 bytes).
const RECORDER_URL = new URL('./worklets/recorder.js', import.meta.url);

const PLAYER_URL = new URL('./worklets/player.js', import.meta.url);

async function loadWorklet(context, url) {
  await context.audioWorklet.addModule(url.href);
}

async function resumePlayback(context) {
  if (context.state === 'running') return;
  let timer;
  try {
    await Promise.race([
      context.resume(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('浏览器尚未允许自动朗读，请点击“朗读”开启声音')), 2000);
      }),
    ]);
  } finally { clearTimeout(timer); }
}

function resamplePCM(samples, sourceRate, targetRate) {
  if (sourceRate === targetRate || !samples.length) return samples;
  const length = Math.max(1, Math.round(samples.length * targetRate / sourceRate));
  const output = new Float32Array(length);
  const ratio = sourceRate / targetRate;
  for (let index = 0; index < length; index++) {
    const position = index * ratio;
    const left = Math.min(samples.length - 1, Math.floor(position));
    const right = Math.min(samples.length - 1, left + 1);
    output[index] = samples[left] + (samples[right] - samples[left]) * (position - left);
  }
  return output;
}

export class SparringVoice {
  constructor({ onStatus = () => {}, onEvent = () => {}, onError = () => {} } = {}) {
    Object.assign(this, { onStatus, onEvent, onError });
    this.generation = 0;
    this.inputEpoch = 0;
    this.interruptEpoch = 0;
    this.inputMode = 'text';
    this.playbackEnabled = false;
    this.decodeQueue = Promise.resolve();
    this.audioCache = [];
    this.audioCacheBytes = 0;
  }

  status() {
    if (!this.ready) return;
    this.onStatus(this.inputMode === 'text' ? '文字输入已连接'
      : this.muted ? '麦克风已静音'
      : this.dialogueMode === 'text' ? '正在录音，点击停止录音并发送' : '聆听中');
  }

  setMuted(value) {
    this.muted = Boolean(value) || this.complianceMuted;
    for (const track of this.stream?.getAudioTracks() || []) track.enabled = !this.muted;
    this.status();
  }

  interrupt() {
    this.interruptEpoch++;
    this.sentenceActive = false;
    this.player?.port.postMessage('clear');
    this.audioElement?.pause();
    this.webmPlaying = false;
    this.webmQueue = [];
    if (this.audioURL) URL.revokeObjectURL(this.audioURL);
    this.audioURL = null;
  }

  sendFrame(frame) {
    if (this.socket?.readyState !== WebSocket.OPEN) throw new Error('实战连接未建立，请重新连接');
    if (this.socket.bufferedAmount > MAX_BUFFER) throw new Error('对话网络拥堵，请检查网络后重新连接');
    this.socket.send(frame);
  }

  async sendText(value) {
    const text = String(value ?? '').trim();
    if (!text) throw new Error('请输入本轮回复');
    if (!this.ready) throw new Error('实战连接尚未就绪');
    if (this.complianceMuted) throw new Error('本次练习触发合规提示，请结束练习后查看结果');
    if (encoder.encode(text).length > 16 * 1024) throw new Error('本轮文字过长，请缩短后发送');
    this.interrupt();
    this.sendFrame(this.dialogueMode === 'text'
      ? encodeTurnFrame(0x02, this.nextMessageId(), { query: { text_content: text } })
      : encodeFrame(1, CHAT_TEXT_QUERY, this.sessionId, encoder.encode(JSON.stringify({ content: text }))));
    this.onStatus('等待对方回复');
  }

  nextMessageId() {
    this.messageId = ((this.messageId ?? 0) + 1) & 0xffff;
    return this.messageId;
  }

  async start(exerciseId, { inputMode = 'text', dialogueMode = 'virtual_streaming_dialogue', transportMode = dialogueMode, playbackEnabled = true } = {}) {
    if (!Number.isSafeInteger(Number(exerciseId)) || Number(exerciseId) <= 0) throw new Error('练习标识无效');
    if (!['text', 'voice'].includes(inputMode) || !['text', 'virtual_streaming_dialogue'].includes(dialogueMode) ||
      !['text', 'virtual_streaming_dialogue'].includes(transportMode) ||
      (dialogueMode === 'text' && transportMode !== 'text')) throw new Error('实战输入方式或对话协议无效');
    await this.stop();
    const generation = ++this.generation;
    Object.assign(this, { dialogueMode: transportMode, planDialogueMode: dialogueMode, inputMode: 'text', ready: false, muted: false,
      complianceMuted: false, messageId: 0, playbackEnabled: false, playbackReady: false,
      sentenceActive: false, cacheEnded: true, audioCache: [], audioCacheBytes: 0,
      webmQueue: [], sessionId: browserSessionId(), decodeQueue: Promise.resolve() });
    const url = new URL(`api/voice/${Number(exerciseId)}`, document.baseURI);
    if (transportMode === 'text' && dialogueMode !== 'text') url.searchParams.set('transport', 'text');
    url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = this.socket = new WebSocket(url);
    socket.binaryType = 'arraybuffer';
    this.onStatus('正在连接实战');
    try {
      await new Promise((resolveReady, rejectReady) => {
        let settled = false;
        const timer = setTimeout(() => reject(new Error('实战连接超时，请稍后重新连接')), 25_000);
        const resolve = () => {
          if (settled) return;
          settled = true; clearTimeout(timer); this.cancelConnection = null;
          this.ready = true; this.status(); resolveReady();
        };
        const reject = (error) => {
          if (!settled) { settled = true; clearTimeout(timer); rejectReady(error); }
          else this.fail(error, generation);
        };
        this.cancelConnection = () => { clearTimeout(timer); rejectReady(new Error('实战连接已取消')); };
        socket.onopen = () => {
          if (generation !== this.generation) return;
          if (transportMode === 'text') {
            this.heartbeat = setInterval(() => {
              if (generation !== this.generation || socket.readyState !== WebSocket.OPEN) return;
              try { this.sendFrame(encodeTurnFrame(0x09, this.nextMessageId(), { query: { time: Math.floor(Date.now() / 1000) } })); }
              catch (error) { this.fail(error, generation); }
            }, 15_000);
          } else {
            this.sendFrame(encodeFrame(1, START_CONNECTION, '', encoder.encode('{}')));
            const silence = new Uint8Array(5120);
            const sendSilence = () => {
              if (generation !== this.generation || socket.readyState !== WebSocket.OPEN || this.recorder) return;
              try { this.sendFrame(encodeFrame(2, TASK_REQUEST, this.sessionId, silence)); }
              catch (error) { this.fail(error, generation); }
            };
            sendSilence();
            this.keepalive = setInterval(sendSilence, 160);
            // This wrapper does not always emit ConnectionStarted=50. Its
            // contract permits TaskRequest immediately after StartConnection.
            resolve();
          }
        };
        socket.onmessage = ({ data }) => {
          if (generation !== this.generation) return;
          try {
            const frames = transportMode === 'text' ? this.normalizeTurnFrame(decodeTurnFrame(data)) : [decodeFrame(data)];
            for (const frame of frames) {
              if (Object.hasOwn(frame, 'code')) throw new Error(`实战服务返回错误（${frame.code}）`);
              if (frame.event === 50) resolve();
              if (frame.event === 450) { this.interrupt(); this.status(); }
              if (frame.event === 999) {
                this.complianceMuted = true; this.playbackEnabled = false;
                this.setMuted(true); this.interrupt();
              }
              this.onEvent(frame);
              if (frame.event === 550) this.onStatus('对方正在回复');
              if (frame.event === 559) this.status();
              this.receiveAudio(frame, generation);
            }
          } catch (error) { reject(error instanceof Error ? error : new Error('实战响应解析失败')); }
        };
        socket.onerror = () => reject(new Error('实战连接失败，请稍后重新连接'));
        socket.onclose = () => reject(new Error('实战连接已断开，练习未自动结束，可重新连接或结束练习'));
      });
    } catch (error) {
      if (generation === this.generation) this.fail(error, generation);
      throw error;
    }
    if (inputMode === 'voice' && generation === this.generation) {
      // A microphone failure leaves the connected text session usable.
      await this.setInputMode('voice');
    }
    if (playbackEnabled && generation === this.generation) {
      // Browser autoplay restrictions must not delay the dialogue connection.
      void this.setPlaybackEnabled(true).catch(() => {});
    }
  }

  normalizeTurnFrame(frame) {
    const result = frame.json?.result ?? {};
    switch (frame.type) {
      case 0x81: return [
        { event: 451, json: { results: [{ text: String(result.asr_content ?? '') }] } },
        { event: 459, json: {} },
      ];
      case 0x82: return [{ event: 550, json: { content: String(result.text_content ?? '') } }];
      case 0x83: return [{ event: 352, audio: frame.audio, audioFormat: 'webm' }];
      case 0x84: {
        const message = String(result.error_msg ?? '请求未成功');
        // This deployed service can generate text before its optional TTS
        // fails. Preserve the socket and identify the interrupted text turn.
        if (Number(result.error_code) === 201 && /^TTS conversion failed:/.test(message)) {
          this.playbackEnabled = false; this.interrupt();
          this.onError(recoverableError('当前场景语音合成失败，已返回的文字可阅读，可继续文字作答', 'playback'));
          this.onStatus('对方语音生成失败，可继续文字作答');
          return [{ event: 560, json: { reason: 'tts_failed', error_code: 201, partial: true } }];
        }
        throw new Error(`实战服务返回错误（${result.error_code ?? '未知'}）：${message}`);
      }
      case 0x85: return [{ event: 999, json: { show_label: String(result.show_label ?? result.show_labe ?? frame.json?.show_label ?? frame.json?.show_labe ?? '本次练习触发合规提示') } }];
      case 0x86: return [{ event: 559, json: {} }];
      case 0x87: return [{ event: 359, json: {} }];
      case 0x89: return [];
      case 0x8a: return [{ event: 50, json: {} }];
      case 0x8b: return [{ event: 139, json: { content: String(result.content ?? '') } }];
      default: return [];
    }
  }

  async setInputMode(mode) {
    if (!['text', 'voice'].includes(mode)) throw new Error('输入方式无效');
    if (!this.ready) throw new Error('实战连接尚未就绪');
    const epoch = ++this.inputEpoch;
    const generation = this.generation;
    let context, resumed, stage = 'environment';
    try {
      if (mode === 'voice') {
        if (!globalThis.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error('当前浏览器无法录音，请使用 localhost 或 HTTPS 页面');
        if (this.complianceMuted) throw new Error('本次练习触发合规提示，请结束练习后查看结果');
        if (this.dialogueMode !== 'text') {
          const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
          if (!AudioContextClass || !globalThis.AudioWorkletNode) throw new Error('当前浏览器不支持实时录音');
          // Use the device rate; the worklet resamples to 16 kHz. Resume while
          // the explicit microphone button still carries the user gesture.
          context = new AudioContextClass();
          resumed = resumePlayback(context).then(() => null, error => error);
        } else if (!globalThis.MediaRecorder) throw new Error('当前浏览器不支持消息录音');
      }
      await this.releaseMicrophone();
      if (generation !== this.generation || epoch !== this.inputEpoch) {
        await context?.close().catch(() => {}); return;
      }
      this.inputMode = 'text';
      if (mode === 'text') { this.status(); return; }
      stage = 'microphone';
      this.onStatus('正在开启麦克风');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1,
        echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      if (generation !== this.generation || epoch !== this.inputEpoch) {
        stream.getTracks().forEach(track => track.stop());
        await context?.close().catch(() => {}); return;
      }
      this.stream = stream;
      this.recorderContext = context;
      if (context) {
        stage = 'audio';
        const resumeError = await resumed;
        if (resumeError && context.state !== 'running') throw new Error('浏览器未启动录音，请点击语音按钮重试');
        stage = 'worklet';
        await loadWorklet(context, RECORDER_URL);
        if (generation !== this.generation || epoch !== this.inputEpoch) return;
        stage = 'audio';
        const recorder = this.recorder = new AudioWorkletNode(context, 'sparring-recorder', {
          numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
        });
        this.source = context.createMediaStreamSource(stream);
        this.silentGain = context.createGain(); this.silentGain.gain.value = 0;
        this.source.connect(recorder); recorder.connect(this.silentGain); this.silentGain.connect(context.destination);
        recorder.port.onmessage = ({ data }) => {
          if (generation !== this.generation || epoch !== this.inputEpoch) return;
          try { this.sendFrame(encodeFrame(2, TASK_REQUEST, this.sessionId, this.muted ? new Uint8Array(5120) : new Uint8Array(data))); }
          catch (error) { this.fail(error, generation); }
        };
      }
      this.inputMode = 'voice'; this.inputError = null;
      this.setMuted(false);
      if (!context) this.beginTurnRecording();
      this.status();
    } catch (error) {
      if (generation !== this.generation || epoch !== this.inputEpoch) {
        if (context && context.state !== 'closed') await context.close().catch(() => {});
        return;
      }
      await this.releaseMicrophone();
      if (context && context.state !== 'closed') await context.close().catch(() => {});
      this.inputMode = 'text'; this.status();
      const message = stage === 'worklet' ? '录音处理加载失败，请刷新页面后点击语音按钮重试'
        : error?.name === 'NotAllowedError' && stage === 'microphone' ? '麦克风权限被拒绝，请在浏览器地址栏允许麦克风后重试'
        : error?.name === 'NotFoundError' ? '未找到麦克风，请连接录音设备后重试'
        : error?.name === 'NotReadableError' ? '麦克风无法使用，请检查设备或关闭正在占用它的应用后重试'
        : error instanceof Error ? error.message : '录音启动失败，请点击语音按钮重试';
      const failure = this.inputError = recoverableError(new Error(message, { cause: error }), 'input');
      failure.stage = stage; this.onError(failure); throw failure;
    }
  }

  beginTurnRecording() {
    const mimeType = ['audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/ogg'].find((type) => MediaRecorder.isTypeSupported(type));
    if (!mimeType) throw new Error('当前浏览器没有可用的录音格式');
    this.recordingParts = [];
    const recorder = this.mediaRecorder = new MediaRecorder(this.stream, { mimeType });
    recorder.ondataavailable = ({ data }) => { if (data.size) this.recordingParts.push(data); };
    recorder.onerror = () => this.onError(recoverableError('本轮录音失败，可切换文字继续', 'input'));
    recorder.start();
  }

  async finishVoiceTurn({ continueRecording = false } = {}) {
    if (this.dialogueMode !== 'text' || this.inputMode !== 'voice' || !this.mediaRecorder) throw recoverableError('此课程当前没有待发送的轮次录音', 'input');
    if (this.muted || this.complianceMuted) throw recoverableError('麦克风已静音，无法发送录音', 'input');
    const generation = this.generation;
    const epoch = this.inputEpoch;
    const recorder = this.mediaRecorder;
    this.mediaRecorder = null;
    let sent = false;
    try {
      await new Promise((resolve, reject) => {
        recorder.onstop = resolve;
        recorder.onerror = () => reject(new Error('本轮录音失败，可切换文字继续'));
        recorder.stop();
      });
      const parts = this.recordingParts;
      this.recordingParts = [];
      if (generation !== this.generation || epoch !== this.inputEpoch) return;
      const blob = new Blob(parts, { type: recorder.mimeType });
      if (!blob.size) throw new Error('本轮没有录到声音，请重试');
      if (blob.size > MAX_BUFFER) throw new Error('本轮录音过长，请缩短后重试');
      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (generation !== this.generation || epoch !== this.inputEpoch) return;
      this.interrupt();
      this.sendFrame(encodeTurnFrame(0x01, this.nextMessageId(), bytes));
      sent = true;
      this.onStatus('等待对方回复');
    } catch (error) { throw recoverableError(error, 'input'); }
    finally {
      // A rejected/empty/oversized turn must not leave the voice UI unarmed.
      if (generation === this.generation && epoch === this.inputEpoch && this.stream && this.inputMode === 'voice') {
        if (sent && !continueRecording) {
          await this.releaseMicrophone(); this.inputMode = 'text';
        } else {
          try { this.beginTurnRecording(); }
          catch (error) {
            await this.releaseMicrophone(); this.inputMode = 'text'; this.status();
            this.onError(recoverableError(error, 'input'));
          }
        }
      }
    }
  }

  async releaseMicrophone() {
    const recorder = this.mediaRecorder;
    this.mediaRecorder = null;
    if (recorder) {
      recorder.ondataavailable = recorder.onstop = recorder.onerror = null;
      if (recorder.state !== 'inactive') recorder.stop();
    }
    this.recordingParts = [];
    this.stream?.getTracks().forEach((track) => track.stop()); this.stream = null;
    if (this.recorder) this.recorder.port.onmessage = null;
    for (const node of [this.source, this.recorder, this.silentGain]) { try { node?.disconnect(); } catch { /* Already detached. */ } }
    this.source = this.recorder = this.silentGain = null;
    const context = this.recorderContext; this.recorderContext = null;
    if (context && context.state !== 'closed') await context.close().catch(() => {});
  }

  receiveAudio(frame, generation) {
    if (![350, 351, 352, 359].includes(frame.event)) return;
    if ((this.cacheEnded && [350, 352].includes(frame.event))) {
      this.audioCache = []; this.audioCacheBytes = 0; this.cacheEnded = false;
    }
    const copy = { ...frame, ...(frame.audio ? { audio: new Uint8Array(frame.audio) } : {}) };
    this.audioCacheBytes += copy.audio?.byteLength ?? 0;
    if (this.audioCacheBytes <= MAX_BUFFER) this.audioCache.push(copy);
    else { this.audioCache = []; this.audioCacheBytes = MAX_BUFFER + 1; }
    if (frame.event === 359) this.cacheEnded = true;
    if (this.playbackEnabled && this.playbackReady) this.enqueueAudioFrame(frame, generation);
  }

  async setPlaybackEnabled(value) {
    const playbackEpoch = this.playbackEpoch = (this.playbackEpoch ?? 0) + 1;
    const enabled = Boolean(value);
    this.playbackEnabled = enabled;
    this.interrupt();
    if (!enabled) return;
    if (this.complianceMuted) { this.playbackEnabled = false; return; }
    const generation = this.generation;
    try {
      if (this.dialogueMode === 'text') {
        this.audioElement ??= new Audio();
        this.audioElement.onended = () => { this.webmPlaying = false; this.playNextWebm(); };
        this.audioElement.onerror = () => { this.playbackEnabled = false; this.interrupt(); this.onError(recoverableError('对方语音无法播放，文字对话仍可继续', 'playback')); };
      } else {
        const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
        if (!AudioContextClass || !globalThis.AudioWorkletNode) throw new Error('当前浏览器不支持语音播放');
        const context = this.playerContext ??= new AudioContextClass({ sampleRate: 48000 });
        const resume = resumePlayback(context);
        if (!this.player && !this.playbackInit) {
          const decoder = this.decoder ??= new OggOpusDecoder();
          const initializing = Promise.all([decoder.ready, loadWorklet(context, PLAYER_URL)]).then(() => {
            if (generation !== this.generation || context !== this.playerContext) return;
            this.player = new AudioWorkletNode(context, 'sparring-player', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1] });
            this.player.connect(context.destination);
            this.player.port.onmessage = ({ data }) => {
              if (generation !== this.generation) return;
              if (data.error) { this.playbackEnabled = false; this.interrupt(); this.onError(recoverableError(data.error, 'playback')); }
            };
          });
          this.playbackInit = initializing;
          const settled = () => { if (this.playbackInit === initializing) this.playbackInit = null; };
          void initializing.then(settled, settled);
        }
        await Promise.all([resume, this.playbackInit]);
      }
      if (generation !== this.generation || !this.playbackEnabled || playbackEpoch !== this.playbackEpoch) return;
      this.playbackReady = true;
      for (const frame of this.audioCache) this.enqueueAudioFrame(frame, generation);
    } catch (error) {
      if (generation !== this.generation || playbackEpoch !== this.playbackEpoch) return;
      this.playbackEnabled = false; this.playbackReady = false; this.interrupt();
      const failure = recoverableError(new Error(error instanceof Error ? error.message : '语音播放启动失败'), 'playback');
      this.onError(failure); throw failure;
    }
  }

  playNextWebm() {
    if (!this.playbackEnabled || !this.audioElement || this.webmPlaying || !this.webmQueue?.length) return;
    // HTMLAudio.paused may remain true until play() resolves. Reserve the
    // current segment synchronously so cache replay cannot overwrite its src.
    this.webmPlaying = true;
    if (this.audioURL) URL.revokeObjectURL(this.audioURL);
    this.audioURL = URL.createObjectURL(this.webmQueue.shift());
    this.audioElement.src = this.audioURL;
    const generation = this.generation;
    const epoch = this.interruptEpoch;
    void this.audioElement.play().catch(() => {
      if (generation !== this.generation || epoch !== this.interruptEpoch) return;
      this.playbackEnabled = false; this.interrupt();
      this.onError(recoverableError('浏览器阻止语音播放，请再次开启播放；文字对话仍可继续', 'playback'));
    });
  }

  enqueueAudioFrame(frame, generation) {
    if (this.dialogueMode === 'text') {
      if (frame.event !== 352 || !frame.audio) return;
      if ((this.webmQueue?.length ?? 0) > 30) { this.interrupt(); this.onError(recoverableError('语音缓冲过长，请重新开启播放', 'playback')); return; }
      this.webmQueue ??= [];
      this.webmQueue.push(new Blob([frame.audio], { type: 'audio/webm' }));
      if (!this.webmPlaying) this.playNextWebm();
      return;
    }
    if (![350, 351, 352].includes(frame.event)) return;
    if (frame.event === 350) this.sentenceActive = true;
    const active = this.sentenceActive;
    if (frame.event === 351) this.sentenceActive = false;
    const epoch = this.interruptEpoch;
    const decoder = this.decoder; const player = this.player; const context = this.playerContext;
    this.decodeQueue = this.decodeQueue.then(async () => {
      if (generation !== this.generation || epoch !== this.interruptEpoch || !this.playbackEnabled) return;
      if (frame.event === 350 || frame.event === 351) { await decoder.reset(); return; }
      if (!active || !frame.audio) return;
      const result = await decoder.decode(frame.audio);
      if (generation !== this.generation || epoch !== this.interruptEpoch || !this.playbackEnabled) return;
      if (result.errors?.length) throw new Error('对方语音解码失败，文字对话仍可继续');
      const samples = result.channelData?.[0];
      if (samples?.length) {
        const playback = resamplePCM(samples, result.sampleRate, context.sampleRate);
        player.port.postMessage(playback, [playback.buffer]);
      }
    }).catch((error) => {
      if (generation !== this.generation || epoch !== this.interruptEpoch) return;
      this.playbackEnabled = false; this.interrupt(); this.onError(recoverableError(error, 'playback'));
    });
  }

  fail(error, generation) {
    if (generation !== this.generation) return;
    Object.assign(error, { recoverable: false, kind: 'connection' });
    this.onError(error); void this.stop();
  }

  async stop() {
    ++this.generation; ++this.inputEpoch;
    this.playbackInit = null;
    this.ready = false; this.playbackEnabled = false; this.playbackReady = false;
    this.interrupt();
    clearInterval(this.keepalive); clearInterval(this.heartbeat);
    this.keepalive = this.heartbeat = null;
    const socket = this.socket; this.socket = null;
    this.cancelConnection?.(); this.cancelConnection = null;
    if (socket) {
      socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null;
      if ([WebSocket.OPEN, WebSocket.CONNECTING].includes(socket.readyState)) socket.close(1000, '用户断开实战连接');
    }
    const microphoneReleased = this.releaseMicrophone();
    if (this.player) { this.player.port.postMessage('clear'); this.player.port.onmessage = null; try { this.player.disconnect(); } catch {} }
    this.player = null;
    const context = this.playerContext; this.playerContext = null;
    const decoder = this.decoder; this.decoder = null;
    const queue = this.decodeQueue;
    const closed = context && context.state !== 'closed' ? context.close().catch(() => {}) : Promise.resolve();
    const freed = decoder ? Promise.all([queue, decoder.ready]).then(() => decoder.free()).catch(() => {}) : Promise.resolve();
    if (this.audioElement) { this.audioElement.onended = this.audioElement.onerror = null; this.audioElement.removeAttribute('src'); this.audioElement.load(); this.audioElement = null; }
    this.audioCache = []; this.audioCacheBytes = 0;
    if (socket) this.onStatus('实战连接已断开');
    await Promise.all([microphoneReleased, closed, freed]);
  }
}
