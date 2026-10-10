export function voiceStatus(s) {
  if (!s.connected) return s.connecting ? '正在连接 AI 客户…' : '对话连接已断开，请重新连接';
  if (s.voicePhase === 'requesting') return '正在开启麦克风，请确认浏览器权限';
  if (s.voicePhase === 'error') return '语音未启动，修复后可点击重试';
  if (s.voicePhase === 'sending') return '正在发送本轮录音…';
  if (s.voicePhase === 'waiting') return '录音已发送，等待客户回应';
  if (s.voicePhase === 'replying') return 'AI 客户正在回应';
  if (s.muted) return '麦克风已暂停，点击继续对话';
  if (s.voicePhase === 'recording') return '正在录音，说完后点击发送';
  if (s.voicePhase === 'listening') return '正在聆听，停顿后客户会自动回应';
  return s.dialogueMode === 'text' ? '点击说话，录音后发送给客户' : '开启后直接说话，无需逐轮发送';
}

export function sessionComposer(s, { textAvailable, icon, esc, time }) {
  const streaming = s.dialogueMode === 'virtual_streaming_dialogue';
  const busy = s.connecting || s.voiceBusy;
  const recording = s.voicePhase === 'recording';
  const listening = streaming && !s.muted && ['listening', 'replying'].includes(s.voicePhase);
  const label = !s.connected ? (s.connecting ? '正在连接' : '重新连接')
    : busy ? (s.voicePhase === 'sending' ? '正在发送' : '正在开启')
    : s.voicePhase === 'error' ? '重试语音'
    : streaming ? (listening ? '暂停聆听' : s.muted ? '继续对话' : '开启实时对话')
    : recording ? '点击发送' : '点击说话';
  const waveform = `<span class="talk-wave" aria-hidden="true">${Array.from({ length: 9 }, (_, i) => `<i style="--bar:${i}"></i>`).join('')}</span>`;
  const status = s.inputMode === 'voice' ? voiceStatus(s) : s.status;
  const error = `<div id="session-error" role="alert" class="call-failure ${s.error ? '' : 'hidden'}">${esc(s.error || '')}</div>`;
  const sound = `<button class="sound-control" data-action="playback" aria-label="${s.playback ? '关闭' : '开启'}客户朗读" aria-pressed="${s.playback}" ${!s.connected || s.connecting ? 'disabled' : ''}>${icon('headset')}<span>声音${s.playback ? '开' : '关'}</span></button>`;
  if (s.inputMode === 'voice') return `
    <div class="voice-console">
      <div class="voice-console-meta"><span>${streaming ? '实时对话' : '消息对话'}</span>${sound}</div>
      <p id="call-status" class="call-status" aria-live="polite">${esc(status)}</p>${error}
      <div class="talk-controls">
        <button class="console-side" data-action="input-mode" data-mode="text" aria-label="${textAvailable ? '切换文字输入' : '此场景文字暂不可用'}" title="${textAvailable ? '文字输入' : '文字暂不可用'}" ${!textAvailable ? 'disabled' : ''}>${icon('keyboard')}</button>
        <button class="talk-button ${recording || listening ? 'is-live' : ''}" data-action="${s.connected ? 'voice-toggle' : 'reconnect'}" ${busy ? 'disabled' : ''} aria-label="${label}">${recording || listening ? waveform : icon('mic')}<strong>${label}</strong>${recording ? `<span class="record-duration">${time(Math.floor((Date.now() - s.recordStartedAt) / 1000))}</span>` : ''}</button>
        <button class="console-side console-end" data-action="end-session" aria-label="结束并评估" title="结束并评估">${icon('power')}</button>
      </div>
      <div class="console-caption"><span>${!textAvailable ? '文字暂不可用' : '左侧切换文字'}</span><span>结束后生成实战报告</span></div>
    </div>`;
  return `<div class="text-console"><div class="text-console-meta"><p id="call-status" class="call-status">${esc(status)}</p>${sound}</div>${error}
    <form id="chat-form"><button type="button" class="text-mic" data-action="input-mode" data-mode="voice" aria-label="切换语音输入">${icon('mic')}</button><label class="sr-only" for="chat-input">输入你的回答</label><textarea id="chat-input" placeholder="输入你的回答，Enter 发送" rows="2" maxlength="3000" ${!s.connected ? 'disabled' : ''}>${esc(s.draft || '')}</textarea><button class="button send-button" type="submit" ${!s.connected ? 'disabled' : ''}>发送 ${icon('arrow')}</button></form>
    <div class="session-actions">${!s.connected && !s.connecting ? '<button class="text-button" data-action="reconnect">重新连接</button>' : '<small>文字与语音可随时切换</small>'}<button class="text-button end-action" data-action="end-session">结束并评估</button></div></div>`;
}
