// Local QA server reproducing the security headers configured on Vercel.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
const root = resolve('dist');
const config = JSON.parse(await readFile('vercel.json', 'utf8'));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' };
createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, 'http://127.0.0.1:5175').pathname);
    const target = resolve(root, '.' + (path === '/' ? '/index.html' : path));
    if (!target.startsWith(root + sep)) { res.writeHead(403); res.end(); return; }
    const content = await readFile(target);
    for (const h of config.headers[0].headers) res.setHeader(h.key, h.value);
    res.setHeader('Content-Type', types[extname(target)] || 'application/octet-stream');
    res.end(content);
  } catch { res.writeHead(404); res.end(); }
}).listen(5175, '127.0.0.1', () => console.log('Production QA: http://127.0.0.1:5175/'));
