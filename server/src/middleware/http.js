function json(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(value));
}

async function body(req, maxSize = 64 * 1024) {
  let input = '';
  for await (const chunk of req) {
    input += chunk;
    if (Buffer.byteLength(input) > maxSize) throw new Error('Request too large');
  }
  return input ? JSON.parse(input) : {};
}

module.exports = { json, body };
