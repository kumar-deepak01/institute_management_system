const fs = require('node:fs/promises');
const fileStreams = require('node:fs');
const path = require('node:path');
const { projectRoot } = require('../config/env');

const contentTypes = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
};

async function handleStaticRoute(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end('Method not allowed'); }
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch { res.writeHead(400); return res.end('Bad request'); }
  if (pathname.includes('\0') || pathname.split('/').some(part => part.startsWith('.'))) { res.writeHead(404); return res.end('Not found'); }
  if (pathname === '/uploads' || pathname.startsWith('/uploads/') || pathname === '/data' || pathname.startsWith('/data/')) { res.writeHead(404); return res.end('Not found'); }
  if (pathname === '/') pathname = '/index.html';
  const filePath = path.resolve(projectRoot, `.${pathname}`);
  if (!filePath.startsWith(`${projectRoot}${path.sep}`)) { res.writeHead(403); return res.end('Forbidden'); }
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) throw new Error('Not a file');
    res.writeHead(200, { 'Content-Type': contentTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin' });
    if (req.method === 'HEAD') return res.end();
    const stream = fileStreams.createReadStream(filePath);
    stream.on('error', () => { if (!res.headersSent) { res.writeHead(404); res.end('Not found'); } else res.destroy(); });
    stream.pipe(res);
  } catch { if (!res.headersSent) { res.writeHead(404); res.end('Not found'); } else res.destroy(); }
}

module.exports = { handleStaticRoute };
