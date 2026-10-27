const NOTE_NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function frequencyToMidi(frequency, concertA = 440) {
  if (!Number.isFinite(frequency) || frequency <= 0) return null;
  return 69 + 12 * Math.log2(frequency / concertA);
}

export function midiToFrequency(midi, concertA = 440) {
  if (!Number.isFinite(midi)) return null;
  return concertA * 2 ** ((midi - 69) / 12);
}

export function describePitch(frequency, concertA = 440) {
  const midi = frequencyToMidi(frequency, concertA);
  if (midi === null) {
    return {
      midi: null,
      note: "—",
      noteName: "—",
      octave: null,
      cents: 0,
      targetFrequency: null,
    };
  }

  const nearestMidi = Math.round(midi);
  const noteName = NOTE_NAMES[((nearestMidi % 12) + 12) % 12];
  const octave = Math.floor(nearestMidi / 12) - 1;
  const targetFrequency = midiToFrequency(nearestMidi, concertA);

  return {
    midi,
    note: `${noteName}${octave}`,
    noteName,
    octave,
    cents: 1200 * Math.log2(frequency / targetFrequency),
    targetFrequency,
  };
}

export function rootMeanSquare(samples) {
  if (!samples?.length) return 0;
  let sum = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const value = Number(samples[index]) || 0;
    sum += value * value;
  }
  return Math.sqrt(sum / samples.length);
}

export function amplitudeToDecibels(amplitude) {
  if (!Number.isFinite(amplitude) || amplitude <= 0) return -Infinity;
  return 20 * Math.log10(amplitude);
}

export function smoothValue(previous, next, alpha = 0.22) {
  if (!Number.isFinite(next)) return Number.isFinite(previous) ? previous : null;
  if (!Number.isFinite(previous)) return next;
  const factor = clamp(alpha, 0, 1);
  return previous + (next - previous) * factor;
}

export function spectralCentroid(frequencyDb, sampleRate, fftSize) {
  if (!frequencyDb?.length || !Number.isFinite(sampleRate) || !Number.isFinite(fftSize)) {
    return null;
  }

  let weightedSum = 0;
  let magnitudeSum = 0;
  const binWidth = sampleRate / fftSize;

  for (let index = 0; index < frequencyDb.length; index += 1) {
    const decibels = Number(frequencyDb[index]);
    if (!Number.isFinite(decibels) || decibels < -110) continue;
    const magnitude = 10 ** (decibels / 20);
    weightedSum += index * binWidth * magnitude;
    magnitudeSum += magnitude;
  }

  return magnitudeSum > 0 ? weightedSum / magnitudeSum : null;
}

export function standardDeviation(values) {
  if (!values?.length) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

export function sessionStatistics(pitches, targetLow, targetHigh) {
  const valid = pitches.filter((pitch) => Number.isFinite(pitch) && pitch > 0);
  if (!valid.length) {
    return {
      sampleCount: 0,
      averagePitch: null,
      targetHitRatio: 0,
      pitchDeviationCents: 0,
    };
  }

  const centsOffsets = valid.map((pitch) => describePitch(pitch).cents);
  const boundaryTolerance = Math.max(0.25, (targetHigh - targetLow) * 0.01);
  const hits = valid.filter(
    (pitch) =>
      pitch >= targetLow - boundaryTolerance && pitch <= targetHigh + boundaryTolerance,
  ).length;

  return {
    sampleCount: valid.length,
    averagePitch: valid.reduce((sum, pitch) => sum + pitch, 0) / valid.length,
    targetHitRatio: hits / valid.length,
    pitchDeviationCents: standardDeviation(centsOffsets),
  };
}

export function downsamplePeaks(samples, bucketCount = 80) {
  if (!samples?.length || bucketCount <= 0) return [];
  const bucketSize = Math.max(1, Math.ceil(samples.length / bucketCount));
  const peaks = [];

  for (let start = 0; start < samples.length; start += bucketSize) {
    let peak = 0;
    for (let index = start; index < Math.min(start + bucketSize, samples.length); index += 1) {
      peak = Math.max(peak, Math.abs(samples[index]));
    }
    peaks.push(peak);
  }

  const maxPeak = Math.max(...peaks, 0.0001);
  return peaks.map((peak) => peak / maxPeak);
}
