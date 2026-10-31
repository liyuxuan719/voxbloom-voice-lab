import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import * as math from "../src/audio-math.js";
import * as analysis from "../src/recording-analysis.js";
import * as data from "../src/practice-data.js";

const source = (await readFile(new URL("../assets/app.js", import.meta.url), "utf8"))
  .replace(/^import[\s\S]*?;\s*/gm, "")
  .replaceAll("import.meta.url", '"https://example.test/assets/app.js"');

function createApp({ decode, stored = {} } = {}) {
  const elements = new Map();
  const events = {};
  const revoked = [];
  let closed = 0;
  let created = 0;
  const context2d = new Proxy({}, { get: () => () => {} });
  const element = () => ({
    classList: { toggle() {}, add() {}, remove() {} }, style: {}, dataset: {},
    querySelector: () => element(), querySelectorAll: () => [], addEventListener() {},
    setAttribute() {}, removeAttribute() {}, replaceChildren() {}, append() {},
    pause() {}, load() {}, click() {}, getBoundingClientRect: () => ({ width: 500, height: 200 }),
    getContext: () => context2d,
  });
  class AudioContext {
    state = "running";
    async decodeAudioData(buffer) {
      if (decode) return decode(buffer);
      const samples = new Float32Array(48000);
      for (let i = 0; i < samples.length; i++) samples[i] = .3 * Math.sin(2 * Math.PI * 196 * i / 48000);
      return { duration: 1, sampleRate: 48000, numberOfChannels: 1, getChannelData: () => samples };
    }
    async close() { this.state = "closed"; closed++; }
  }
  const window = { AudioContext, setTimeout: () => 1, clearTimeout() {}, addEventListener: (name, fn) => { events[name] = fn; } };
  const sandbox = {
    ...math, ...analysis, ...data, window, navigator: {}, performance: { now: () => 1000 },
    document: {
      querySelector: (selector) => { if (!elements.has(selector)) elements.set(selector, element()); return elements.get(selector); },
      createElement: element, createDocumentFragment: element,
    },
    localStorage: { getItem: (key) => stored[key] || null, setItem: (key, value) => { stored[key] = value; } },
    URL: { createObjectURL: () => `blob:${++created}`, revokeObjectURL: (url) => revoked.push(url) },
    Blob, Float32Array, Intl, console,
  };
  vm.runInNewContext(source + "\nglobalThis.app = { state, settings, importRecording, deleteClip, restoreHistory };", sandbox);
  return { ...sandbox.app, events, revoked, stored, closed: () => closed };
}

test("audio import analyzes locally without requesting microphone permission", async () => {
  const app = createApp();
  await app.importRecording("A", new Blob(["audio"], { type: "audio/wav" }));
  assert.ok(Math.abs(app.state.clips.A.analysis.averagePitch - 196) < .5);
  assert.equal(app.state.clips.A.extension, "wav");
  assert.equal(app.state.running, false);
  assert.equal(app.closed(), 1);
});

test("failed import preserves an existing clip and closes its decoder", async () => {
  const app = createApp({ decode: async () => { throw new Error("bad codec"); } });
  const clip = { url: "blob:old", duration: 1, waveform: [1], targetLow: 145, targetHigh: 220 };
  app.state.clips.A = clip;
  await app.importRecording("A", new Blob(["invalid"], { type: "audio/wav" }));
  assert.equal(app.state.clips.A, clip);
  assert.equal(app.closed(), 1);
  assert.equal(app.state.clipBusy.A, false);
  assert.deepEqual(app.revoked, []);
});

test("deleting a clip during decoding prevents a late import from restoring it", async () => {
  let finish;
  const app = createApp({ decode: () => new Promise((resolve) => { finish = resolve; }) });
  const pending = app.importRecording("A", new Blob(["audio"]));
  await new Promise((resolve) => setImmediate(resolve));
  app.deleteClip("A");
  finish({ duration: 1, sampleRate: 48000, numberOfChannels: 1, getChannelData: () => new Float32Array(48000) });
  await pending;
  assert.equal(app.state.clips.A, null);
  assert.equal(app.closed(), 1);
});

test("malformed browser storage does not prevent application initialization", () => {
  const app = createApp({ stored: { "voxbloom-settings-v1": "null", "voxbloom-history-v1": '[null,{"timestamp":"invalid"}]' } });
  assert.equal(app.settings.targetLow, 145);
  assert.equal(app.state.history.length, 0);
});

test("overlong imports retain the old clip and release the decoder", async () => {
  const app = createApp({ decode: async () => ({ duration: 121 }) });
  const old = { url: "blob:old", duration: 1, waveform: [1], targetLow: 145, targetHigh: 220 };
  app.state.clips.B = old;
  await app.importRecording("B", new Blob(["long audio"]));
  assert.equal(app.state.clips.B, old);
  assert.equal(app.closed(), 1);
});
