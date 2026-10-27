import test from "node:test";
import assert from "node:assert/strict";

import {
  amplitudeToDecibels,
  describePitch,
  downsamplePeaks,
  frequencyToMidi,
  midiToFrequency,
  rootMeanSquare,
  sessionStatistics,
  smoothValue,
  spectralCentroid,
  standardDeviation,
} from "../src/audio-math.js";

const closeTo = (actual, expected, tolerance = 1e-6) => {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `Expected ${actual} to be within ${tolerance} of ${expected}`,
  );
};

test("A4, A3, and middle C map to the expected MIDI values", () => {
  closeTo(frequencyToMidi(440), 69);
  closeTo(frequencyToMidi(220), 57);
  closeTo(frequencyToMidi(261.625565), 60);
  closeTo(midiToFrequency(69), 440);
});

test("pitch descriptions include note, octave, and cents", () => {
  assert.equal(describePitch(440).note, "A4");
  closeTo(describePitch(440).cents, 0);
  assert.equal(describePitch(466.163762).note, "A♯4");
  assert.ok(describePitch(450).cents > 0);
  assert.equal(describePitch(0).note, "—");
});

test("RMS and decibel conversion handle silence and full-scale values", () => {
  closeTo(rootMeanSquare([1, -1, 1, -1]), 1);
  closeTo(rootMeanSquare([0.5, -0.5]), 0.5);
  assert.equal(rootMeanSquare([]), 0);
  closeTo(amplitudeToDecibels(1), 0);
  closeTo(amplitudeToDecibels(0.5), -6.020599913, 1e-8);
  assert.equal(amplitudeToDecibels(0), -Infinity);
});

test("smoothing converges and ignores invalid measurements", () => {
  assert.equal(smoothValue(100, 200, 0.25), 125);
  assert.equal(smoothValue(100, null, 0.25), 100);
  assert.equal(smoothValue(null, 120, 0.25), 120);
  assert.equal(smoothValue(100, 200, 5), 200);
});

test("spectral centroid is weighted toward the dominant frequency", () => {
  const bins = new Float32Array(16).fill(-120);
  bins[4] = -10;
  const centroid = spectralCentroid(bins, 48000, 32);
  closeTo(centroid, 6000);
});

test("session statistics calculate target hits and pitch deviation", () => {
  const statistics = sessionStatistics([110, 220, 330, 0, Number.NaN], 120, 240);
  assert.equal(statistics.sampleCount, 3);
  closeTo(statistics.averagePitch, 220);
  closeTo(statistics.targetHitRatio, 1 / 3);
  assert.ok(statistics.pitchDeviationCents > 0);
});

test("target hit detection allows a small measurement margin at the boundary", () => {
  const statistics = sessionStatistics([100, 219.8, 220.4, 250], 145, 220);
  assert.equal(statistics.targetHitRatio, 0.5);
});

test("standard deviation and waveform peak downsampling are stable", () => {
  closeTo(standardDeviation([2, 4, 4, 4, 5, 5, 7, 9]), 2);
  const peaks = downsamplePeaks([0, 0.2, -0.8, 0.1, 0.4, -0.2], 3);
  assert.equal(peaks.length, 3);
  assert.equal(Math.max(...peaks), 1);
  assert.deepEqual(downsamplePeaks([], 3), []);
});
