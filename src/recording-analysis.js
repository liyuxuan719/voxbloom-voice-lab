import { PitchDetector } from "../assets/pitchy.js";
import { rootMeanSquare, sessionStatistics } from "./audio-math.js";

export function mixChannels(channels) {
  if (!channels?.length) return new Float32Array();
  const length = Math.max(...channels.map((channel) => channel.length));
  const mixed = new Float32Array(length);

  for (const channel of channels) {
    for (let index = 0; index < channel.length; index += 1) {
      mixed[index] += channel[index] / channels.length;
    }
  }
  return mixed;
}

export function analyzeAudioSamples(
  samples,
  sampleRate,
  { targetLow = 145, targetHigh = 220, frameSize = 2048, hopSize = 2048 } = {},
) {
  if (!samples?.length || !Number.isFinite(sampleRate) || sampleRate <= 0) {
    return {
      averagePitch: null,
      targetHitRatio: 0,
      pitchDeviationCents: 0,
      voicedSeconds: 0,
      validFrames: 0,
    };
  }

  const detector = PitchDetector.forFloat32Array(frameSize);
  const frame = new Float32Array(frameSize);
  const pitches = [];
  let validFrames = 0;

  for (let start = 0; start < samples.length; start += hopSize) {
    frame.fill(0);
    const available = Math.min(frameSize, samples.length - start);
    frame.set(samples.subarray(start, start + available));
    const rms = rootMeanSquare(frame);
    if (rms < 0.006) continue;

    const [pitch, clarity] = detector.findPitch(frame, sampleRate);
    if (pitch >= 65 && pitch <= 500 && clarity >= 0.82) {
      pitches.push(pitch);
      validFrames += 1;
    }
  }

  const statistics = sessionStatistics(pitches, targetLow, targetHigh);
  return {
    averagePitch: statistics.averagePitch,
    targetHitRatio: statistics.targetHitRatio,
    pitchDeviationCents: statistics.pitchDeviationCents,
    voicedSeconds: Math.min(samples.length / sampleRate, (validFrames * hopSize) / sampleRate),
    validFrames,
  };
}

export function compareRecordingAnalyses(first, second) {
  if (!first || !second) return null;
  return {
    pitchDelta:
      first.averagePitch !== null && second.averagePitch !== null
        ? second.averagePitch - first.averagePitch
        : null,
    deviationDelta: second.pitchDeviationCents - first.pitchDeviationCents,
    targetHitDelta: (second.targetHitRatio - first.targetHitRatio) * 100,
    voicedDelta: second.voicedSeconds - first.voicedSeconds,
  };
}
