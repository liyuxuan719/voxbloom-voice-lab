import { analyzeAudioSamples } from "../src/recording-analysis.js";

self.addEventListener("message", (event) => {
  const { id, samples, sampleRate, targetLow, targetHigh } = event.data || {};
  try {
    const analysis = analyzeAudioSamples(samples, sampleRate, {
      targetLow,
      targetHigh,
    });
    self.postMessage({ id, analysis });
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
});
