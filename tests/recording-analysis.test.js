import test from "node:test";
import assert from "node:assert/strict";

import {
  analyzeAudioSamples,
  compareRecordingAnalyses,
  mixChannels,
} from "../src/recording-analysis.js";

const closeTo = (actual, expected, tolerance = 1e-9) => {
  assert.ok(Math.abs(actual - expected) <= tolerance);
};

function sineWave(frequency, sampleRate, duration, amplitude = 0.3) {
  const samples = new Float32Array(Math.round(sampleRate * duration));
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = amplitude * Math.sin((2 * Math.PI * frequency * index) / sampleRate);
  }
  return samples;
}

test("mixed mono audio averages all input channels", () => {
  const mixed = mixChannels([new Float32Array([1, 0, -1]), new Float32Array([0, 1, 1])]);
  assert.deepEqual(Array.from(mixed), [0.5, 0.5, 0]);
  assert.equal(mixChannels([]).length, 0);
});

test("offline analysis detects a 196 Hz test tone", () => {
  const sampleRate = 48000;
  const samples = sineWave(196, sampleRate, 1.2);
  const analysis = analyzeAudioSamples(samples, sampleRate, {
    targetLow: 145,
    targetHigh: 220,
  });
  assert.ok(analysis.validFrames > 10);
  assert.ok(Math.abs(analysis.averagePitch - 196) < 0.5);
  assert.equal(analysis.targetHitRatio, 1);
  assert.ok(analysis.voicedSeconds > 1);
});

test("offline analysis remains safe for silence and invalid input", () => {
  const silence = analyzeAudioSamples(new Float32Array(4096), 48000);
  assert.equal(silence.validFrames, 0);
  assert.equal(silence.averagePitch, null);
  assert.equal(silence.targetHitRatio, 0);
  assert.equal(analyzeAudioSamples([], 0).validFrames, 0);
});

test("A/B comparison returns neutral signed differences", () => {
  const comparison = compareRecordingAnalyses(
    { averagePitch: 180, pitchDeviationCents: 22, targetHitRatio: 0.4, voicedSeconds: 3 },
    { averagePitch: 190, pitchDeviationCents: 18, targetHitRatio: 0.7, voicedSeconds: 4 },
  );
  assert.equal(comparison.pitchDelta, 10);
  assert.equal(comparison.deviationDelta, -4);
  closeTo(comparison.targetHitDelta, 30);
  assert.equal(comparison.voicedDelta, 1);
  assert.equal(compareRecordingAnalyses(null, {}), null);
});
