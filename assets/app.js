import { PitchDetector } from "./pitchy.js";
import {
  amplitudeToDecibels,
  clamp,
  describePitch,
  downsamplePeaks,
  rootMeanSquare,
  sessionStatistics,
  smoothValue,
  spectralCentroid,
} from "../src/audio-math.js";
import {
  analyzeAudioSamples,
  compareRecordingAnalyses,
  mixChannels,
} from "../src/recording-analysis.js";

const SETTINGS_KEY = "voxbloom-settings-v1";
const HISTORY_KEY = "voxbloom-history-v1";
const HISTORY_LIMIT = 12;
const RECORDING_LIMIT_MS = 15000;
const HISTORY_WINDOW_SECONDS = 30;
const analysisPending = new Map();
let analysisWorker = null;
let analysisRequestId = 0;

const PRACTICE_MODES = {
  sustain: {
    title: "持续 /a/",
    instruction: "用平常音量持续发声，保持舒适，不压喉。",
    toast: "保持一个舒适、可持续的元音。",
  },
  glide: {
    title: "滑音",
    instruction: "从舒适的低音缓慢滑向练习区间，再自然回落。",
    toast: "慢一点移动，不需要推到极限。",
  },
  phrase: {
    title: "短句",
    instruction: "用自然语速读一句短句，观察音高起伏而不是追求单点。",
    toast: "观察一句话里的自然变化。",
  },
};

const elements = {
  microphoneButton: document.querySelector("#microphone-button"),
  microphoneButtonLabel: document.querySelector("#microphone-button-label"),
  microphoneButtonHint: document.querySelector("#microphone-button-hint"),
  inputLevel: document.querySelector(".input-level"),
  levelDb: document.querySelector("#level-db"),
  levelFill: document.querySelector("#level-fill"),
  signalQuality: document.querySelector("#signal-quality"),
  modeControl: document.querySelector("#mode-control"),
  modeTitle: document.querySelector("#mode-title"),
  modeInstruction: document.querySelector("#mode-instruction"),
  modeHelp: document.querySelector("#mode-help"),
  targetLow: document.querySelector("#target-low"),
  targetHigh: document.querySelector("#target-high"),
  targetLowValue: document.querySelector("#target-low-value"),
  targetHighValue: document.querySelector("#target-high-value"),
  targetRangeLabel: document.querySelector("#target-range-label"),
  goalOptions: document.querySelector("#goal-options"),
  goalDurationLabel: document.querySelector("#goal-duration-label"),
  smoothingToggle: document.querySelector("#smoothing-toggle"),
  resetSessionButton: document.querySelector("#reset-session-button"),
  liveState: document.querySelector("#live-state"),
  liveStateLabel: document.querySelector("#live-state-label"),
  stageMicButton: document.querySelector("#stage-mic-button"),
  stageMicLabel: document.querySelector("#stage-mic-label"),
  sessionClock: document.querySelector("#session-clock"),
  sessionProgress: document.querySelector(".session-progress"),
  sessionProgressFill: document.querySelector("#session-progress-fill"),
  currentNote: document.querySelector("#current-note"),
  currentFrequency: document.querySelector("#current-frequency"),
  currentCents: document.querySelector("#current-cents"),
  spectralCentroid: document.querySelector("#spectral-centroid"),
  canvas: document.querySelector("#voice-canvas"),
  canvasEmpty: document.querySelector("#canvas-empty"),
  axisHigh: document.querySelector("#axis-high"),
  axisMid: document.querySelector("#axis-mid"),
  axisLow: document.querySelector("#axis-low"),
  averagePitch: document.querySelector("#average-pitch"),
  targetHit: document.querySelector("#target-hit"),
  pitchDeviation: document.querySelector("#pitch-deviation"),
  voicedTime: document.querySelector("#voiced-time"),
  recordingBar: document.querySelector(".recording-bar"),
  recordingDot: document.querySelector("#recording-dot"),
  recordingStatus: document.querySelector("#recording-status"),
  stopRecordingButton: document.querySelector("#stop-recording-button"),
  abComparison: document.querySelector("#ab-comparison"),
  comparePitch: document.querySelector("#compare-pitch"),
  compareDeviation: document.querySelector("#compare-deviation"),
  compareHit: document.querySelector("#compare-hit"),
  compareVoiced: document.querySelector("#compare-voiced"),
  exportHistoryButton: document.querySelector("#export-history-button"),
  clearHistoryButton: document.querySelector("#clear-history-button"),
  historyList: document.querySelector("#history-list"),
  historyEmpty: document.querySelector("#history-empty"),
  installButton: document.querySelector("#install-button"),
  toast: document.querySelector("#toast"),
  year: document.querySelector("#year"),
};

const clipElements = {
  A: {
    card: document.querySelector('[data-clip-slot="A"]'),
    audio: document.querySelector("#clip-a-audio"),
    metrics: document.querySelector("#clip-a-metrics"),
    wave: document.querySelector("#clip-a-wave"),
    duration: document.querySelector("#clip-a-duration"),
    badge: document.querySelector("#clip-a-badge"),
    download: document.querySelector("#clip-a-download"),
    recordButton: document.querySelector('[data-record-slot="A"]'),
    deleteButton: document.querySelector('[data-delete-slot="A"]'),
  },
  B: {
    card: document.querySelector('[data-clip-slot="B"]'),
    audio: document.querySelector("#clip-b-audio"),
    metrics: document.querySelector("#clip-b-metrics"),
    wave: document.querySelector("#clip-b-wave"),
    duration: document.querySelector("#clip-b-duration"),
    badge: document.querySelector("#clip-b-badge"),
    download: document.querySelector("#clip-b-download"),
    recordButton: document.querySelector('[data-record-slot="B"]'),
    deleteButton: document.querySelector('[data-delete-slot="B"]'),
  },
};

const storedSettings = readStoredJson(SETTINGS_KEY, {});
const settings = {
  targetLow: clamp(Number(storedSettings.targetLow) || 145, 70, 330),
  targetHigh: clamp(Number(storedSettings.targetHigh) || 220, 80, 400),
  smoothing: storedSettings.smoothing !== false,
  mode: PRACTICE_MODES[storedSettings.mode] ? storedSettings.mode : "sustain",
  goalSeconds: [10, 15, 30].includes(Number(storedSettings.goalSeconds))
    ? Number(storedSettings.goalSeconds)
    : 15,
};

const state = {
  audioContext: null,
  mediaStream: null,
  sourceNode: null,
  analyser: null,
  detector: null,
  timeData: null,
  frequencyData: null,
  running: false,
  processingFrame: null,
  sessionStartedAt: null,
  lastFrameAt: null,
  voicedSeconds: 0,
  displayPitch: null,
  rawPitch: null,
  clarity: 0,
  centroid: null,
  pitchHistory: [],
  sessionPitches: [],
  lastMetricAt: 0,
  lastVoiceAt: 0,
  goalCelebrated: false,
  history: readStoredJson(HISTORY_KEY, []),
  clips: { A: null, B: null },
  recording: false,
  recordingSlot: null,
  recorder: null,
  recordingStartedAt: null,
  recordingTimer: null,
  recordingTargets: null,
  installPrompt: null,
  toastTimer: null,
  clearHistoryArmed: false,
  clearHistoryTimer: null,
  canvasSize: { width: 0, height: 0 },
};

function readStoredJson(key, fallback) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "null");
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function storeSettings() {
  try {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        targetLow: settings.targetLow,
        targetHigh: settings.targetHigh,
        smoothing: settings.smoothing,
        mode: settings.mode,
        goalSeconds: settings.goalSeconds,
      }),
    );
  } catch {
    // Preferences are optional; audio processing does not depend on storage.
  }
}

function storeHistory() {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(state.history));
  } catch {
    // Practice history is optional and intentionally local-only.
  }
}

function ensureRangeOrder(changedBoundary) {
  if (settings.targetHigh - settings.targetLow >= 10) return;
  if (changedBoundary === "low") {
    settings.targetLow = Math.max(70, settings.targetHigh - 10);
  } else {
    settings.targetHigh = Math.min(400, settings.targetLow + 10);
  }
}

function renderSettings() {
  elements.targetLow.value = String(Math.round(settings.targetLow));
  elements.targetHigh.value = String(Math.round(settings.targetHigh));
  elements.targetLowValue.textContent = `${Math.round(settings.targetLow)} Hz`;
  elements.targetHighValue.textContent = `${Math.round(settings.targetHigh)} Hz`;
  elements.targetRangeLabel.textContent = `${Math.round(settings.targetLow)}–${Math.round(
    settings.targetHigh,
  )} Hz`;
  elements.goalDurationLabel.textContent = `${settings.goalSeconds} 秒`;
  for (const button of elements.goalOptions.querySelectorAll("[data-goal]")) {
    const active = Number(button.dataset.goal) === settings.goalSeconds;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  }
  elements.smoothingToggle.checked = settings.smoothing;
  for (const button of elements.modeControl.querySelectorAll("[data-mode]")) {
    const active = button.dataset.mode === settings.mode;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  }
  const mode = PRACTICE_MODES[settings.mode];
  elements.modeTitle.textContent = mode.title;
  elements.modeInstruction.textContent = mode.instruction;
  updateCanvasAxis();
  renderSessionProgress(state.running ? (performance.now() - state.sessionStartedAt) / 1000 : 0);
}

function setMicrophoneUi(status, detail = "") {
  const listening = state.running;
  elements.microphoneButton.classList.toggle("is-active", listening);
  elements.stageMicButton.classList.toggle("is-active", listening);
  elements.microphoneButtonLabel.textContent = listening ? "停止麦克风" : "启动麦克风";
  elements.stageMicLabel.textContent = listening ? "停止" : "开始";
  elements.microphoneButtonHint.textContent = listening
    ? "声音只在当前设备中分析"
    : "点按后由浏览器请求权限";
  elements.liveState.classList.toggle("is-listening", listening);
  elements.liveState.classList.remove("is-speaking");
  elements.liveStateLabel.textContent = status;
  elements.signalQuality.textContent = listening ? "等待稳定声音" : "等待麦克风";
  elements.signalQuality.className = "";
  if (detail) elements.microphoneButtonHint.textContent = detail;
}

function setSpeakingUi(status) {
  elements.liveState.classList.add("is-listening");
  elements.liveState.classList.toggle("is-speaking", status === "正在发声");
  elements.liveStateLabel.textContent = status;
}

function showToast(message) {
  window.clearTimeout(state.toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add("is-visible");
  state.toastTimer = window.setTimeout(() => {
    elements.toast.classList.remove("is-visible");
  }, 2400);
}

function createIcons() {
  if (window.lucide?.createIcons) {
    window.lucide.createIcons({
      attrs: {
        "aria-hidden": "true",
        "stroke-width": 1.8,
      },
    });
  }
}

async function startMicrophone() {
  if (state.running) {
    stopMicrophone();
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    setMicrophoneUi(
      "当前浏览器不支持音频分析",
      window.isSecureContext ? "请尝试最新版 Chrome、Edge、Safari 或 Firefox" : "麦克风需要 HTTPS 或 localhost",
    );
    showToast("当前环境无法使用麦克风");
    return;
  }

  setMicrophoneUi("正在请求麦克风权限");
  elements.microphoneButton.disabled = true;

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
      },
    });
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error("Web Audio API is unavailable.");

    state.mediaStream = stream;
    state.audioContext = new AudioContextClass({ latencyHint: "interactive" });
    await state.audioContext.resume();
    state.sourceNode = state.audioContext.createMediaStreamSource(stream);
    state.analyser = state.audioContext.createAnalyser();
    state.analyser.fftSize = 2048;
    state.analyser.smoothingTimeConstant = 0.72;
    state.sourceNode.connect(state.analyser);
    state.detector = PitchDetector.forFloat32Array(state.analyser.fftSize);
    state.timeData = new Float32Array(state.analyser.fftSize);
    state.frequencyData = new Float32Array(state.analyser.frequencyBinCount);
    state.running = true;
    resetSession();
    setMicrophoneUi("正在聆听");
    elements.canvasEmpty.hidden = false;
    state.processingFrame = requestAnimationFrame(processAudioFrame);
  } catch (error) {
    const denied = ["NotAllowedError", "SecurityError"].includes(error?.name);
    setMicrophoneUi(
      denied ? "麦克风权限未开启" : "无法启动麦克风",
      denied ? "请在浏览器地址栏中允许麦克风" : "请检查麦克风连接和浏览器设置",
    );
    showToast(denied ? "麦克风权限被拒绝" : "麦克风启动失败");
    cleanupAudio();
  } finally {
    elements.microphoneButton.disabled = false;
  }
}

function stopMicrophone() {
  if (!state.running) return;
  if (state.recording) stopRecording();
  finalizeSession();
  cleanupAudio();
  setMicrophoneUi("麦克风已停止");
  elements.levelDb.textContent = "— dBFS";
  elements.levelFill.style.width = "0%";
  elements.inputLevel.classList.remove("is-hot");
}

function cleanupAudio() {
  state.running = false;
  if (state.processingFrame) cancelAnimationFrame(state.processingFrame);
  state.processingFrame = null;
  for (const track of state.mediaStream?.getTracks() || []) track.stop();
  state.mediaStream = null;
  state.sourceNode?.disconnect();
  state.sourceNode = null;
  state.analyser = null;
  state.detector = null;
  state.timeData = null;
  state.frequencyData = null;
  if (state.audioContext && state.audioContext.state !== "closed") {
    state.audioContext.close().catch(() => {});
  }
  state.audioContext = null;
}

function processAudioFrame(timestamp) {
  if (!state.running || !state.analyser) return;

  const elapsed = Math.max(0, (timestamp - state.sessionStartedAt) / 1000);
  const deltaSeconds = Math.min(0.1, Math.max(0, (timestamp - state.lastFrameAt) / 1000));
  state.lastFrameAt = timestamp;
  renderSessionProgress(elapsed);

  state.analyser.getFloatTimeDomainData(state.timeData);
  state.analyser.getFloatFrequencyData(state.frequencyData);
  const rms = rootMeanSquare(state.timeData);
  const decibels = amplitudeToDecibels(rms);
  const levelRatio = clamp((decibels + 60) / 60, 0, 1);
  elements.levelDb.textContent = Number.isFinite(decibels)
    ? `${Math.round(decibels)} dBFS`
    : "— dBFS";
  elements.levelFill.style.width = `${(levelRatio * 100).toFixed(1)}%`;
  elements.inputLevel.classList.toggle("is-hot", decibels > -2);

  state.centroid = spectralCentroid(
    state.frequencyData,
    state.audioContext.sampleRate,
    state.analyser.fftSize,
  );
  elements.spectralCentroid.textContent =
    state.centroid && state.centroid < 12000
      ? `${Math.round(state.centroid)} Hz`
      : "— Hz";

  const [pitch, clarity] = state.detector.findPitch(
    state.timeData,
    state.audioContext.sampleRate,
  );
  const voiced = pitch >= 65 && pitch <= 500 && clarity >= 0.82 && rms >= 0.006;
  updateSignalQuality({ rms, clarity, voiced });

  if (voiced) {
    state.lastVoiceAt = timestamp;
    state.rawPitch = pitch;
    state.clarity = clarity;
    state.displayPitch = settings.smoothing
      ? smoothValue(state.displayPitch, pitch, 0.2)
      : pitch;
    state.voicedSeconds += deltaSeconds;
    state.sessionPitches.push(state.displayPitch);
    if (state.sessionPitches.length > 12000) state.sessionPitches.shift();
    state.pitchHistory.push({
      time: elapsed,
      pitch: state.displayPitch,
      centroid: state.centroid,
    });
    if (state.pitchHistory.length > 6000) state.pitchHistory.shift();
    elements.canvasEmpty.hidden = true;
    setSpeakingUi("正在发声");

    const description = describePitch(state.displayPitch);
    elements.currentNote.textContent = description.note;
    elements.currentFrequency.textContent = `${state.displayPitch.toFixed(1)} Hz · 清晰度 ${Math.round(
      clarity * 100,
    )}%`;
    const centsRounded = Math.round(description.cents);
    elements.currentCents.textContent =
      centsRounded === 0
        ? "正好位于音高中心"
        : `${centsRounded > 0 ? "+" : ""}${centsRounded} cents`;
  } else if (timestamp - state.lastVoiceAt > 300) {
    state.rawPitch = null;
    setSpeakingUi(rms > 0.006 ? "听到声音，等待稳定音高" : "正在聆听");
  }

  if (timestamp - state.lastMetricAt > 220) {
    state.lastMetricAt = timestamp;
    updateSessionMetrics();
  }

  drawVoiceCanvas();
  state.processingFrame = requestAnimationFrame(processAudioFrame);
}

function renderSessionProgress(elapsed) {
  const capped = Math.max(0, elapsed);
  const percent = clamp((capped / settings.goalSeconds) * 100, 0, 100);
  elements.sessionClock.textContent = `${formatClock(capped)} / ${formatClock(settings.goalSeconds)}`;
  elements.sessionProgressFill.style.width = `${percent}%`;
  elements.sessionProgress.setAttribute("aria-valuenow", String(Math.round(percent)));
  elements.sessionProgress.setAttribute(
    "aria-valuetext",
    `${Math.round(percent)}%，目标 ${settings.goalSeconds} 秒`,
  );
  elements.sessionProgress.classList.toggle("is-complete", capped >= settings.goalSeconds);

  if (state.running && capped >= settings.goalSeconds && !state.goalCelebrated) {
    state.goalCelebrated = true;
    showToast(`已达到 ${settings.goalSeconds} 秒练习目标，可以继续或停止`);
  }
}

function updateSignalQuality({ rms, clarity, voiced }) {
  let label = "等待声音";
  let tone = "";
  if (rms >= 0.95) {
    label = "接近削波";
    tone = "is-hot";
  } else if (rms < 0.002) {
    label = "输入偏弱";
  } else if (voiced) {
    label = clarity >= 0.94 ? "稳定" : "已识别音高";
    tone = clarity >= 0.94 ? "is-good" : "is-warm";
  } else if (rms >= 0.006) {
    label = "收到声音，清晰度不足";
    tone = "is-warm";
  }
  elements.signalQuality.textContent = label;
  elements.signalQuality.className = tone;
}

function updateSessionMetrics() {
  const statistics = sessionStatistics(
    state.sessionPitches,
    settings.targetLow,
    settings.targetHigh,
  );
  elements.averagePitch.textContent = statistics.averagePitch
    ? `${Math.round(statistics.averagePitch)} Hz`
    : "—";
  elements.targetHit.textContent = statistics.sampleCount
    ? `${Math.round(statistics.targetHitRatio * 100)}%`
    : "—";
  elements.pitchDeviation.textContent = statistics.sampleCount
    ? `±${Math.round(statistics.pitchDeviationCents)} ct`
    : "—";
  elements.voicedTime.textContent = `${state.voicedSeconds.toFixed(1)} s`;
}

function resetSession() {
  state.sessionStartedAt = performance.now();
  state.lastFrameAt = state.sessionStartedAt;
  state.voicedSeconds = 0;
  state.displayPitch = null;
  state.rawPitch = null;
  state.pitchHistory = [];
  state.sessionPitches = [];
  state.lastVoiceAt = 0;
  state.goalCelebrated = false;
  elements.currentNote.textContent = "—";
  elements.currentFrequency.textContent = state.running ? "等待声音" : "等待麦克风";
  elements.currentCents.textContent = "开始后显示音分偏差";
  elements.spectralCentroid.textContent = "— Hz";
  elements.averagePitch.textContent = "—";
  elements.targetHit.textContent = "—";
  elements.pitchDeviation.textContent = "—";
  elements.voicedTime.textContent = "0.0 s";
  renderSessionProgress(0);
  elements.signalQuality.textContent = state.running ? "等待稳定声音" : "等待麦克风";
  elements.signalQuality.className = "";
  elements.canvasEmpty.hidden = false;
  drawVoiceCanvas();
}

function finalizeSession() {
  if (state.voicedSeconds < 1.5 || state.sessionPitches.length < 8) return;
  const statistics = sessionStatistics(
    state.sessionPitches,
    settings.targetLow,
    settings.targetHigh,
  );
  if (!statistics.averagePitch) return;

  state.history.unshift({
    id: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`,
    timestamp: new Date().toISOString(),
    mode: settings.mode,
    targetLow: Math.round(settings.targetLow),
    targetHigh: Math.round(settings.targetHigh),
    averagePitch: Number(statistics.averagePitch.toFixed(2)),
    targetHitRatio: Number(statistics.targetHitRatio.toFixed(4)),
    pitchDeviationCents: Number(statistics.pitchDeviationCents.toFixed(2)),
    voicedSeconds: Number(state.voicedSeconds.toFixed(2)),
    goalSeconds: settings.goalSeconds,
  });
  state.history = state.history.slice(0, HISTORY_LIMIT);
  storeHistory();
  renderHistory();
  showToast("本次练习摘要已保存在本机");
}

function formatClock(seconds) {
  const whole = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(whole / 60)).padStart(2, "0")}:${String(whole % 60).padStart(
    2,
    "0",
  )}`;
}

function noteForAxis(frequency) {
  return describePitch(frequency).note;
}

function getCanvasDomain() {
  const dataMinimum = state.pitchHistory.length
    ? Math.min(...state.pitchHistory.map((point) => point.pitch))
    : settings.targetLow;
  const dataMaximum = state.pitchHistory.length
    ? Math.max(...state.pitchHistory.map((point) => point.pitch))
    : settings.targetHigh;
  const low = Math.max(65, Math.min(settings.targetLow * 0.72, dataMinimum * 0.85));
  const high = Math.min(500, Math.max(settings.targetHigh * 1.32, dataMaximum * 1.15));
  return { low, high };
}

function resizeCanvas(canvas) {
  const rectangle = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.round(rectangle.width * dpr));
  const height = Math.max(1, Math.round(rectangle.height * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const context = canvas.getContext("2d");
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  return {
    context,
    width: rectangle.width,
    height: rectangle.height,
  };
}

function drawVoiceCanvas() {
  const { context, width, height } = resizeCanvas(elements.canvas);
  state.canvasSize = { width, height };
  context.clearRect(0, 0, width, height);
  const domain = getCanvasDomain();
  const yForPitch = (pitch) => {
    const normalized =
      Math.log(pitch / domain.low) / Math.log(domain.high / domain.low);
    return height - clamp(normalized, 0, 1) * height;
  };

  context.lineWidth = 1;
  context.strokeStyle = "rgba(239, 245, 236, 0.08)";
  for (let line = 1; line < 5; line += 1) {
    const y = (height / 5) * line;
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width, y);
    context.stroke();
  }
  for (let line = 1; line < 7; line += 1) {
    const x = (width / 7) * line;
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, height);
    context.stroke();
  }

  const bandTop = yForPitch(settings.targetHigh);
  const bandBottom = yForPitch(settings.targetLow);
  context.fillStyle = "rgba(183, 204, 185, 0.14)";
  context.fillRect(0, bandTop, width, bandBottom - bandTop);
  context.strokeStyle = "rgba(183, 204, 185, 0.45)";
  context.setLineDash([5, 5]);
  context.beginPath();
  context.moveTo(0, bandTop);
  context.lineTo(width, bandTop);
  context.moveTo(0, bandBottom);
  context.lineTo(width, bandBottom);
  context.stroke();
  context.setLineDash([]);

  const now = state.running
    ? Math.max(0, (performance.now() - state.sessionStartedAt) / 1000)
    : state.pitchHistory.at(-1)?.time || 0;
  const windowStart = Math.max(0, now - HISTORY_WINDOW_SECONDS);
  const points = state.pitchHistory.filter((point) => point.time >= windowStart);

  if (points.length > 1) {
    context.lineWidth = 2.2;
    context.strokeStyle = "#ee8d7e";
    context.lineJoin = "round";
    context.beginPath();
    points.forEach((point, index) => {
      const x = ((point.time - windowStart) / HISTORY_WINDOW_SECONDS) * width;
      const y = yForPitch(point.pitch);
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.stroke();

    const latest = points.at(-1);
    const latestX = ((latest.time - windowStart) / HISTORY_WINDOW_SECONDS) * width;
    const latestY = yForPitch(latest.pitch);
    context.fillStyle = "#f7e9d4";
    context.beginPath();
    context.arc(latestX, latestY, 3.2, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = "rgba(238, 141, 126, 0.42)";
    context.lineWidth = 7;
    context.beginPath();
    context.arc(latestX, latestY, 8, 0, Math.PI * 2);
    context.stroke();
  }

  if (state.frequencyData?.length) {
    const barCount = Math.min(48, Math.floor(width / 8));
    const stride = Math.max(1, Math.floor(state.frequencyData.length / barCount));
    const baseline = height - 4;
    for (let index = 0; index < barCount; index += 1) {
      const value = state.frequencyData[index * stride];
      const normalized = clamp((value + 100) / 80, 0, 1);
      const barHeight = normalized * 26;
      context.fillStyle = "rgba(212, 167, 76, 0.18)";
      context.fillRect(
        (index / barCount) * width,
        baseline - barHeight,
        Math.max(2, width / barCount - 3),
        barHeight,
      );
    }
  }

  updateCanvasAxis(domain);
}

function updateCanvasAxis(domain = getCanvasDomain()) {
  const middle = Math.sqrt(domain.low * domain.high);
  elements.axisHigh.textContent = `${noteForAxis(domain.high)} · ${Math.round(domain.high)}`;
  elements.axisMid.textContent = `${noteForAxis(middle)} · ${Math.round(middle)}`;
  elements.axisLow.textContent = `${noteForAxis(domain.low)} · ${Math.round(domain.low)}`;
}

function chooseRecordingMimeType() {
  const types = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];
  return types.find((type) => MediaRecorder.isTypeSupported?.(type)) || "";
}

async function startRecording(slot) {
  if (state.recording) {
    stopRecording();
    return;
  }
  if (!state.running) {
    await startMicrophone();
    if (!state.running) return;
  }
  if (!window.MediaRecorder) {
    showToast("当前浏览器不支持录音");
    return;
  }

  try {
    const mimeType = chooseRecordingMimeType();
    const options = mimeType ? { mimeType, audioBitsPerSecond: 96000 } : {};
    const recorder = new MediaRecorder(state.mediaStream, options);
    const chunks = [];
    state.recording = true;
    state.recordingSlot = slot;
    state.recorder = recorder;
    state.recordingStartedAt = performance.now();
    state.recordingTargets = {
      low: settings.targetLow,
      high: settings.targetHigh,
    };
    elements.stopRecordingButton.hidden = false;
    elements.recordingBar.classList.add("is-recording");
    clipElements[slot].card.classList.add("is-recording");

    recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size) chunks.push(event.data);
    });
    recorder.addEventListener("stop", async () => {
      const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
      await installRecording(slot, blob, recorder.mimeType);
      clearRecordingState();
    });
    recorder.start(250);
    state.recordingTimer = window.setTimeout(stopRecording, RECORDING_LIMIT_MS);
    updateRecordingUi();
  } catch {
    showToast("无法开始录音，请重新开启麦克风");
    clearRecordingState();
  }
}

function updateRecordingUi() {
  const elapsed = state.recording
    ? Math.min(RECORDING_LIMIT_MS, performance.now() - state.recordingStartedAt)
    : 0;
  elements.recordingStatus.textContent = state.recording
    ? `正在录制片段 ${state.recordingSlot} · ${(elapsed / 1000).toFixed(1)} 秒`
    : "选择一个片段开始录音，单段最长 15 秒。";
  for (const slot of ["A", "B"]) {
    const button = clipElements[slot].recordButton;
    const recordingThis = state.recording && state.recordingSlot === slot;
    button.classList.toggle("is-recording", recordingThis);
    button.querySelector("span").textContent = recordingThis ? `停止 ${slot}` : `录制 ${slot}`;
    button.disabled = state.recording && !recordingThis;
  }
  if (state.recording) {
    requestAnimationFrame(updateRecordingUi);
  }
}

function stopRecording() {
  if (!state.recording || state.recorder?.state === "inactive") return;
  state.recorder.stop();
}

function clearRecordingState() {
  window.clearTimeout(state.recordingTimer);
  state.recordingTimer = null;
  if (state.recordingSlot) {
    clipElements[state.recordingSlot].card.classList.remove("is-recording");
  }
  state.recording = false;
  state.recordingSlot = null;
  state.recorder = null;
  state.recordingStartedAt = null;
  state.recordingTargets = null;
  elements.stopRecordingButton.hidden = true;
  elements.recordingBar.classList.remove("is-recording");
  elements.recordingStatus.textContent = "选择一个片段开始录音，单段最长 15 秒。";
  for (const slot of ["A", "B"]) {
    clipElements[slot].recordButton.disabled = false;
    clipElements[slot].recordButton.classList.remove("is-recording");
    clipElements[slot].recordButton.querySelector("span").textContent = `录制 ${slot}`;
  }
}

async function installRecording(slot, blob, mimeType) {
  const clip = state.clips[slot];
  if (clip?.url) URL.revokeObjectURL(clip.url);

  const extension = mimeType?.includes("mp4") ? "m4a" : "webm";
  const url = URL.createObjectURL(blob);
  let waveform = new Array(64).fill(0.03);
  let duration = Number((performance.now() - state.recordingStartedAt) / 1000);
  let analysis = null;
  const targets = state.recordingTargets || {
    low: settings.targetLow,
    high: settings.targetHigh,
  };

  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    const context = state.audioContext || new AudioContextClass();
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    duration = decoded.duration;
    waveform = downsamplePeaks(decoded.getChannelData(0), 64);
    const channels = Array.from(
      { length: decoded.numberOfChannels },
      (_, index) => decoded.getChannelData(index),
    );
    const mono = mixChannels(channels);
    analysis = await analyzeRecordingAsync(mono, decoded.sampleRate, targets);
    if (context !== state.audioContext) await context.close();
  } catch {
    // Playback still works when offline pitch analysis is unavailable.
  }

  state.clips[slot] = {
    blob,
    url,
    duration,
    waveform,
    extension,
    analysis,
    targetLow: Math.round(targets.low),
    targetHigh: Math.round(targets.high),
  };
  renderClip(slot);
  renderAbComparison();
  showToast(`片段 ${slot} 已录制，只保存在当前页面`);
}

function getAnalysisWorker() {
  if (!("Worker" in window)) return null;
  if (!analysisWorker) {
    try {
      analysisWorker = new Worker(new URL("./analysis-worker.js", import.meta.url), {
        type: "module",
      });
      analysisWorker.addEventListener("message", (event) => {
        const { id, analysis, error } = event.data || {};
        const pending = analysisPending.get(id);
        if (!pending) return;
        analysisPending.delete(id);
        window.clearTimeout(pending.timer);
        if (error) pending.reject(new Error(error));
        else pending.resolve(analysis);
      });
      analysisWorker.addEventListener("error", () => {
        for (const pending of analysisPending.values()) {
          window.clearTimeout(pending.timer);
          pending.reject(new Error("Analysis worker failed."));
        }
        analysisPending.clear();
        analysisWorker?.terminate();
        analysisWorker = null;
      });
    } catch {
      analysisWorker = null;
    }
  }
  return analysisWorker;
}

function analyzeRecordingAsync(samples, sampleRate, targets) {
  const worker = getAnalysisWorker();
  if (!worker) {
    return Promise.resolve(
      analyzeAudioSamples(samples, sampleRate, {
        targetLow: targets.low,
        targetHigh: targets.high,
      }),
    );
  }

  const id = ++analysisRequestId;
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      const pending = analysisPending.get(id);
      if (!pending) return;
      analysisPending.delete(id);
      pending.reject(new Error("Analysis worker timed out."));
    }, 10000);
    analysisPending.set(id, { resolve, reject, timer });
    worker.postMessage(
      {
        id,
        samples,
        sampleRate,
        targetLow: targets.low,
        targetHigh: targets.high,
      },
    );
  }).catch(() =>
    analyzeAudioSamples(samples, sampleRate, {
      targetLow: targets.low,
      targetHigh: targets.high,
    }),
  );
}

function renderClip(slot) {
  const clip = state.clips[slot];
  const refs = clipElements[slot];
  const hasClip = Boolean(clip);
  refs.card.classList.toggle("has-recording", hasClip);
  refs.badge.textContent = hasClip ? "LOCAL CLIP" : "EMPTY";
  refs.duration.textContent = hasClip ? `${clip.duration.toFixed(1)} 秒 · 仅本页` : "尚未录音";
  refs.audio.hidden = !hasClip;
  refs.download.hidden = !hasClip;
  refs.deleteButton.hidden = !hasClip;
  refs.metrics.hidden = !hasClip || !clip.analysis?.averagePitch;
  if (hasClip) {
    refs.audio.src = clip.url;
    refs.download.href = clip.url;
    refs.download.download = `voxbloom-${slot.toLowerCase()}.${clip.extension}`;
    drawWaveform(refs.wave, clip.waveform, slot === "A" ? "#6f967d" : "#e36f61");
    if (clip.analysis?.averagePitch) {
      renderClipMetrics(refs.metrics, clip.analysis);
    } else {
      refs.metrics.replaceChildren();
    }
  } else {
    refs.audio.removeAttribute("src");
    refs.download.removeAttribute("href");
    refs.metrics.replaceChildren();
    drawWaveform(refs.wave, new Array(64).fill(0.025), "#c7bcaa");
  }
}

function renderClipMetrics(container, analysis) {
  const values = [
    ["平均音高", `${Math.round(analysis.averagePitch)} Hz`],
    ["音高波动", `±${Math.round(analysis.pitchDeviationCents)} ct`],
    ["区间命中", `${Math.round(analysis.targetHitRatio * 100)}%`],
  ];
  const fragment = document.createDocumentFragment();
  for (const [label, value] of values) {
    const item = document.createElement("div");
    const labelElement = document.createElement("span");
    labelElement.textContent = label;
    const valueElement = document.createElement("strong");
    valueElement.textContent = value;
    item.append(labelElement, valueElement);
    fragment.append(item);
  }
  container.replaceChildren(fragment);
}

function renderAbComparison() {
  const first = state.clips.A?.analysis;
  const second = state.clips.B?.analysis;
  const comparison = compareRecordingAnalyses(first, second);
  elements.abComparison.hidden = !comparison;
  if (!comparison) return;

  elements.comparePitch.textContent = formatSigned(comparison.pitchDelta, " Hz");
  elements.compareDeviation.textContent = formatSigned(comparison.deviationDelta, " ct");
  elements.compareHit.textContent = formatSigned(comparison.targetHitDelta, " pt", 1);
  elements.compareVoiced.textContent = formatSigned(comparison.voicedDelta, " s", 1);
}

function formatSigned(value, unit, decimals = 0) {
  if (!Number.isFinite(value)) return "—";
  const rounded = Number(value.toFixed(decimals));
  const sign = rounded > 0 ? "+" : "";
  return `${sign}${rounded}${unit}`;
}

function drawWaveform(canvas, peaks, color) {
  const { context, width, height } = resizeCanvas(canvas);
  context.clearRect(0, 0, width, height);
  context.strokeStyle = color;
  context.lineWidth = 1.4;
  context.beginPath();
  peaks.forEach((peak, index) => {
    const x = (index / Math.max(1, peaks.length - 1)) * width;
    const amplitude = Math.max(1, peak * (height * 0.38));
    context.moveTo(x, height / 2 - amplitude);
    context.lineTo(x, height / 2 + amplitude);
  });
  context.stroke();
  context.strokeStyle = "rgba(25, 35, 30, 0.1)";
  context.beginPath();
  context.moveTo(0, height / 2);
  context.lineTo(width, height / 2);
  context.stroke();
}

function deleteClip(slot) {
  const clip = state.clips[slot];
  if (!clip) return;
  clipElements[slot].audio.pause();
  clipElements[slot].audio.removeAttribute("src");
  clipElements[slot].audio.load();
  if (clip.url) URL.revokeObjectURL(clip.url);
  state.clips[slot] = null;
  renderClip(slot);
  renderAbComparison();
  showToast(`片段 ${slot} 已从当前页面删除`);
}

function renderHistory() {
  const items = Array.isArray(state.history) ? state.history : [];
  elements.historyEmpty.classList.toggle("is-visible", items.length === 0);
  const fragment = document.createDocumentFragment();

  for (const session of items) {
    const description = describePitch(session.averagePitch);
    const relativeClass =
      session.averagePitch < session.targetLow
        ? "is-low"
        : session.averagePitch > session.targetHigh
          ? "is-high"
          : "";
    const item = document.createElement("article");
    item.className = `history-item ${relativeClass}`;

    const date = document.createElement("span");
    date.className = "history-date";
    date.textContent = new Intl.DateTimeFormat("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(session.timestamp));

    const main = document.createElement("div");
    main.className = "history-main";
    const pitch = document.createElement("strong");
    pitch.textContent = `${Math.round(session.averagePitch)} Hz`;
    const note = document.createElement("span");
    note.textContent = description.note;
    main.append(pitch, note);

    const subline = document.createElement("p");
    subline.className = "history-subline";
    subline.textContent = `命中 ${Math.round(session.targetHitRatio * 100)}% · 波动 ±${Math.round(
      session.pitchDeviationCents,
    )} ct · ${session.voicedSeconds.toFixed(1)} s`;

    item.append(date, main, subline);
    fragment.append(item);
  }
  elements.historyList.replaceChildren(fragment);
}

function clearHistory() {
  state.history = [];
  storeHistory();
  renderHistory();
  showToast("本机练习摘要已清空");
}

function handleClearHistory() {
  if (!state.history.length) {
    showToast("当前没有练习摘要");
    return;
  }
  if (!state.clearHistoryArmed) {
    state.clearHistoryArmed = true;
    elements.clearHistoryButton.classList.add("is-confirming");
    elements.clearHistoryButton.querySelector("span").textContent = "再次点击清空";
    window.clearTimeout(state.clearHistoryTimer);
    state.clearHistoryTimer = window.setTimeout(() => {
      state.clearHistoryArmed = false;
      elements.clearHistoryButton.classList.remove("is-confirming");
      elements.clearHistoryButton.querySelector("span").textContent = "清空摘要";
    }, 3500);
    return;
  }

  window.clearTimeout(state.clearHistoryTimer);
  state.clearHistoryArmed = false;
  elements.clearHistoryButton.classList.remove("is-confirming");
  elements.clearHistoryButton.querySelector("span").textContent = "清空摘要";
  clearHistory();
}

function exportHistory() {
  if (!state.history.length) {
    showToast("还没有可导出的练习摘要");
    return;
  }
  const rows = [
    [
      "timestamp",
      "practice_mode",
      "target_low_hz",
      "target_high_hz",
      "average_pitch_hz",
      "target_hit_percent",
      "pitch_deviation_cents",
      "voiced_seconds",
      "goal_seconds",
    ],
    ...state.history.map((session) => [
      session.timestamp,
      session.mode,
      session.targetLow,
      session.targetHigh,
      session.averagePitch,
      Math.round(session.targetHitRatio * 1000) / 10,
      session.pitchDeviationCents,
      session.voicedSeconds,
      session.goalSeconds || "",
    ]),
  ];
  const csv = rows
    .map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(","))
    .join("\r\n");
  const url = URL.createObjectURL(new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "voxbloom-practice-history.csv";
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast("练习摘要已导出");
}

function setPracticeMode(mode) {
  if (!PRACTICE_MODES[mode]) return;
  settings.mode = mode;
  renderSettings();
  storeSettings();
  resetSession();
}

function setupSliders() {
  elements.targetLow.addEventListener("input", () => {
    settings.targetLow = Number(elements.targetLow.value);
    ensureRangeOrder("low");
    renderSettings();
    storeSettings();
    updateSessionMetrics();
  });
  elements.targetHigh.addEventListener("input", () => {
    settings.targetHigh = Number(elements.targetHigh.value);
    ensureRangeOrder("high");
    renderSettings();
    storeSettings();
    updateSessionMetrics();
  });
  elements.smoothingToggle.addEventListener("change", () => {
    settings.smoothing = elements.smoothingToggle.checked;
    storeSettings();
  });
  elements.modeControl.addEventListener("click", (event) => {
    const button = event.target.closest("[data-mode]");
    if (button) setPracticeMode(button.dataset.mode);
  });
  elements.goalOptions.addEventListener("click", (event) => {
    const button = event.target.closest("[data-goal]");
    if (!button) return;
    settings.goalSeconds = Number(button.dataset.goal);
    state.goalCelebrated = false;
    renderSettings();
    storeSettings();
  });
}

function setupRecording() {
  for (const slot of ["A", "B"]) {
    const refs = clipElements[slot];
    refs.recordButton.addEventListener("click", () => startRecording(slot));
    refs.deleteButton.addEventListener("click", () => deleteClip(slot));
    renderClip(slot);
  }
  elements.stopRecordingButton.addEventListener("click", stopRecording);
}

function setupInstallPrompt() {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    state.installPrompt = event;
    elements.installButton.hidden = false;
  });
  elements.installButton.addEventListener("click", async () => {
    if (!state.installPrompt) return;
    state.installPrompt.prompt();
    const choice = await state.installPrompt.userChoice;
    if (choice.outcome === "accepted") showToast("VoxBloom 已添加到设备");
    state.installPrompt = null;
    elements.installButton.hidden = true;
  });
  window.addEventListener("appinstalled", () => {
    elements.installButton.hidden = true;
    state.installPrompt = null;
    showToast("VoxBloom 已安装，可离线打开");
  });
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

function setupVisibilityCleanup() {
  window.addEventListener("pagehide", () => {
    if (state.recording) stopRecording();
    cleanupAudio();
    for (const slot of ["A", "B"]) {
      const clip = state.clips[slot];
      if (clip?.url) URL.revokeObjectURL(clip.url);
    }
  });
}

function init() {
  if (!Array.isArray(state.history)) state.history = [];
  if (settings.targetHigh - settings.targetLow < 10) {
    settings.targetHigh = Math.min(400, settings.targetLow + 10);
  }
  renderSettings();
  renderHistory();
  setupSliders();
  setupRecording();
  setupInstallPrompt();
  setupVisibilityCleanup();
  elements.microphoneButton.addEventListener("click", startMicrophone);
  elements.stageMicButton.addEventListener("click", startMicrophone);
  elements.resetSessionButton.addEventListener("click", () => {
    resetSession();
    showToast("本次显示数据已重置，麦克风状态保持不变");
  });
  elements.modeHelp.addEventListener("click", () => {
    showToast(PRACTICE_MODES[settings.mode].toast);
  });
  elements.exportHistoryButton.addEventListener("click", exportHistory);
  elements.clearHistoryButton.addEventListener("click", handleClearHistory);
  window.addEventListener("resize", () => {
    drawVoiceCanvas();
    for (const slot of ["A", "B"]) {
      if (state.clips[slot]) {
        drawWaveform(
          clipElements[slot].wave,
          state.clips[slot].waveform,
          slot === "A" ? "#6f967d" : "#e36f61",
        );
      }
    }
  });
  elements.year.textContent = new Date().getFullYear();
  createIcons();
  drawVoiceCanvas();
  registerServiceWorker();
}

init();
