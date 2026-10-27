import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import { createServer } from "node:http";

const root = resolve(import.meta.dirname, "..");
const port = Number(process.env.PORT || 4190);
const host = process.env.HOST || "127.0.0.1";
const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json; charset=utf-8",
};

function resolvePath(urlPath) {
  const decoded = decodeURIComponent((urlPath || "/").split("?")[0]).replaceAll("/", sep);
  let target = resolve(root, `.${decoded}`);
  if (!target.startsWith(root)) return null;
  if (existsSync(target) && statSync(target).isDirectory()) target = join(target, "index.html");
  return target;
}

const server = createServer((request, response) => {
  const filePath = resolvePath(request.url || "/");
  if (!filePath || !existsSync(filePath) || !statSync(filePath).isFile()) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  response.writeHead(200, {
    "content-type": mimeTypes[extname(filePath)] || "application/octet-stream",
    "cache-control": filePath.endsWith("sw.js") ? "no-cache" : "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
    "permissions-policy": "camera=(), microphone=(self), geolocation=()",
    "content-security-policy":
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; manifest-src 'self'; worker-src 'self'",
  });
  createReadStream(filePath).pipe(response);
});

server.listen(port, host, () => {
  console.log(`VoxBloom running at http://${host}:${port}`);
});
