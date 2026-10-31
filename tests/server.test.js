import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { existsSync, statSync } from "node:fs";
import { readFile as readText } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

test("dev server serves new modules and rejects malformed or out-of-root URL paths", async () => {
  const file = new URL("../scripts/serve.mjs", import.meta.url);
  const source = (await readText(file, "utf8")).replace(/^import[^\n]*\n/gm, "").replaceAll("import.meta.url", JSON.stringify(file.href));
  let handler;
  vm.runInNewContext(source, {
    URL, extname, join, resolve, sep, fileURLToPath, existsSync, statSync,
    process: { env: {} }, console: { log() {} },
    createReadStream: () => ({ pipe(response) { response.end(); } }),
    createServer: (callback) => { handler = callback; return { listen() {}, address: () => ({ port: 4190 }) }; },
  });
  const request = (path) => {
    let status;
    handler({ url: path }, { writeHead(code) { status = code; }, end() {} });
    return status;
  };
  assert.equal(request("/"), 200);
  assert.equal(request("/src/practice-data.js"), 200);
  assert.equal(request("/%zz"), 404);
  assert.equal(request("/%2e%2e%2fpackage.json"), 404);
  assert.equal(request("/"), 200, "malformed URL must not crash the server");
});
