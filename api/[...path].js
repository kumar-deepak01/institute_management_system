'use strict';

const { handleRequest } = require('../server');

module.exports = async function apiHandler(req, res) {
  try { return await handleRequest(req, res); }
  catch (error) {
    console.error('Vercel API handler failed:', error.message);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ error: 'The API request could not be completed.' }));
    } else res.end();
  }
};
