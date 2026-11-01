// Tiny static server for local testing (sets COOP/COEP like the production host).
import http from 'http';
import fs from 'fs';
import path from 'path';
const root = path.join(path.dirname(new URL(import.meta.url).pathname), 'public');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.csv': 'text/csv', '.mat': 'application/octet-stream' };
const port = +(process.env.PORT || 8080);
http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(root, p);
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream', 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp', 'Cache-Control': 'no-store' });
  fs.createReadStream(f).pipe(res);
}).listen(port, () => console.log(`http://localhost:${port}`));
