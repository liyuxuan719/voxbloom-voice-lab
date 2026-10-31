import test from "node:test";
import assert from "node:assert/strict";
import { createHistoryBackup, restoreHistoryBackup, normalizeHistory, normalizeSettings, recordingExtension, HISTORY_LIMIT } from "../src/practice-data.js";

const session = (id = "one", timestamp = "2026-10-27T10:00:00.000Z") => ({ id, timestamp, mode: "sustain", targetLow: 145, targetHigh: 220, averagePitch: 196, targetHitRatio: 0.8, pitchDeviationCents: 20, voicedSeconds: 5, goalSeconds: 15, statisticsVersion: 2 });

test("backup round trip retains summaries without audio or arbitrary properties", () => {
  const value = session();
  value.blob = "never-export-this";
  const text = createHistoryBackup([value]);
  assert.ok(!text.includes("never-export-this"));
  assert.deepEqual(restoreHistoryBackup(text), [session()]);
});

test("restore merges duplicate ids without overwriting current records and sorts newest first", () => {
  const backup = createHistoryBackup([session("one"), session("two", "2026-10-28T10:00:00Z")]);
  const current = { ...session("one"), averagePitch: 200 };
  const restored = restoreHistoryBackup(backup, [current]);
  assert.deepEqual(restored.map((item) => item.id), ["two", "one"]);
  assert.equal(restored[1].averagePitch, 200);
});

test("corrupt backup is rejected atomically rather than silently losing records", () => {
  for (const invalid of ["null", "{}", "[1]", "not JSON", JSON.stringify({ app: "other", version: 2, history: [] }), JSON.stringify({ app: "voxbloom", version: 2, history: [session(), { ...session("bad"), timestamp: "broken" }] })]) {
    assert.throws(() => restoreHistoryBackup(invalid, [session()]));
  }
  assert.throws(() => restoreHistoryBackup(" ".repeat(1024 * 1024 + 1)));
});

test("history load survives corrupted records and labels version 1 measurements", () => {
  const legacy = session();
  delete legacy.statisticsVersion;
  assert.equal(normalizeHistory([null, {}, { ...session(), voicedSeconds: "oops" }, legacy])[0].statisticsVersion, 1);
  assert.deepEqual(normalizeHistory({}), []);
  assert.equal(normalizeHistory(Array.from({ length: 150 }, (_, index) => session(String(index)))).length, HISTORY_LIMIT);
});

test("settings normalize non-object storage and non-finite or inverted ranges", () => {
  assert.equal(normalizeSettings(null).targetLow, 145);
  assert.equal(normalizeSettings({ targetLow: Infinity, targetHigh: NaN, mode: "constructor" }).mode, "sustain");
  assert.equal(normalizeSettings({ targetLow: 330, targetHigh: 80 }).targetHigh, 340);
  assert.equal(normalizeSettings({ smoothing: false, goalSeconds: 30 }).smoothing, false);
});

test("audio downloads retain common browser recording types", () => {
  assert.equal(recordingExtension("audio/ogg;codecs=opus"), "ogg");
  assert.equal(recordingExtension("audio/mp4"), "m4a");
  assert.equal(recordingExtension("audio/mpeg"), "mp3");
  assert.equal(recordingExtension("audio/wav"), "wav");
  assert.equal(recordingExtension("", "My Voice.WAV"), "wav");
});
