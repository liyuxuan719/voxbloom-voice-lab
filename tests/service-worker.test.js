import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../sw.js", import.meta.url), "utf8");

test("activation preserves other GitHub Pages projects' caches", async () => {
  const handlers = {};
  const deleted = [];
  vm.runInNewContext(source, {
    self: { addEventListener: (name, handler) => { handlers[name] = handler; }, clients: { claim() {} } },
    caches: { keys: async () => ["mira-v1", "aster-v1", "voxbloom-voice-lab-v1.1.0", "voxbloom-voice-lab-v2.0.0"], delete: async (key) => deleted.push(key) },
  });
  let completion;
  handlers.activate({ waitUntil: (promise) => { completion = promise; } });
  await completion;
  assert.deepEqual(deleted, ["voxbloom-voice-lab-v1.1.0"]);
});

test("service worker leaves sibling paths and external requests to their own apps", () => {
  const handlers = {};
  vm.runInNewContext(source, {
    URL,
    self: { location: { origin: "https://example.github.io" }, registration: { scope: "https://example.github.io/voxbloom/" }, addEventListener: (name, handler) => { handlers[name] = handler; } },
  });
  for (const url of ["https://example.github.io/mira/index.html", "https://external.test/voxbloom/"]) {
    let intercepted = false;
    handlers.fetch({ request: { method: "GET", url }, respondWith() { intercepted = true; } });
    assert.equal(intercepted, false);
  }
});
