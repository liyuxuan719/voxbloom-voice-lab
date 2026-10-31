export const HISTORY_LIMIT = 120;
export const MAX_AUDIO_BYTES = 20 * 1024 * 1024;
export const MAX_AUDIO_SECONDS = 120;
const MODES = ["sustain", "glide", "phrase"];
const inRange = (value, low, high) => typeof value === "number" && Number.isFinite(value) && value >= low && value <= high;

export function normalizeSettings(value) {
  const input = value && typeof value === "object" ? value : {};
  const targetLow = inRange(input.targetLow, 70, 330) ? input.targetLow : 145;
  const targetHigh = inRange(input.targetHigh, 80, 400) ? input.targetHigh : 220;
  return {
    targetLow,
    targetHigh: Math.max(targetLow + 10, targetHigh),
    smoothing: input.smoothing !== false,
    mode: MODES.includes(input.mode) ? input.mode : "sustain",
    goalSeconds: [10, 15, 30].includes(input.goalSeconds) ? input.goalSeconds : 15,
  };
}

export function validateSession(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (typeof value.id !== "string" || !value.id.length || value.id.length > 120) return null;
  if (typeof value.timestamp !== "string" || !Number.isFinite(Date.parse(value.timestamp))) return null;
  if (!MODES.includes(value.mode)) return null;
  if (!inRange(value.targetLow, 70, 330) || !inRange(value.targetHigh, 80, 400) || value.targetHigh < value.targetLow + 10) return null;
  if (!inRange(value.averagePitch, 65, 500) || !inRange(value.targetHitRatio, 0, 1)) return null;
  if (!inRange(value.pitchDeviationCents, 0, 4000) || !inRange(value.voicedSeconds, 0, 86400)) return null;
  if (value.goalSeconds !== undefined && ![10, 15, 30].includes(value.goalSeconds)) return null;
  if (value.statisticsVersion !== undefined && ![1, 2].includes(value.statisticsVersion)) return null;
  return {
    id: value.id,
    timestamp: new Date(value.timestamp).toISOString(),
    mode: value.mode,
    targetLow: value.targetLow,
    targetHigh: value.targetHigh,
    averagePitch: value.averagePitch,
    targetHitRatio: value.targetHitRatio,
    pitchDeviationCents: value.pitchDeviationCents,
    voicedSeconds: value.voicedSeconds,
    goalSeconds: value.goalSeconds || 15,
    statisticsVersion: value.statisticsVersion || 1,
  };
}

export function normalizeHistory(value) {
  if (!Array.isArray(value)) return [];
  const unique = new Map();
  for (const item of value) {
    const session = validateSession(item);
    if (session && !unique.has(session.id)) unique.set(session.id, session);
  }
  return [...unique.values()]
    .sort((first, second) => Date.parse(second.timestamp) - Date.parse(first.timestamp))
    .slice(0, HISTORY_LIMIT);
}

export function createHistoryBackup(history) {
  return JSON.stringify({ app: "voxbloom", version: 2, history: normalizeHistory(history) }, null, 2);
}

export function restoreHistoryBackup(text, existing = []) {
  if (typeof text !== "string" || text.length > 1024 * 1024) throw new Error("备份文件应小于 1 MB");
  let data;
  try { data = JSON.parse(text); } catch { throw new Error("无法读取 JSON 备份"); }
  if (data?.app !== "voxbloom" || data.version !== 2 || !Array.isArray(data.history) || data.history.length > HISTORY_LIMIT) {
    throw new Error("请选择 VoxBloom 2.0 导出的摘要备份");
  }
  if (data.history.some((session) => !validateSession(session))) throw new Error("备份包含无效的练习摘要，未导入任何数据");
  // Existing entries win when a backup contains the same session id.
  return normalizeHistory([...normalizeHistory(existing), ...data.history]);
}

export function recordingExtension(mimeType, fileName = "") {
  const type = (mimeType || "").split(";")[0].toLowerCase();
  const detected = ({ "audio/mp4": "m4a", "audio/ogg": "ogg", "audio/wav": "wav", "audio/x-wav": "wav", "audio/mpeg": "mp3", "audio/flac": "flac", "audio/webm": "webm" })[type];
  const extension = fileName.split(".").at(-1).toLowerCase();
  return detected || (["wav", "mp3", "m4a", "ogg", "webm", "flac"].includes(extension) ? extension : "webm");
}
