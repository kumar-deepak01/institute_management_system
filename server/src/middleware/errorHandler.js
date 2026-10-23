const { json } = require('./http');

function handleRouteError(error, res) {
  console.error('API request failed:', error instanceof Error ? error.message : 'unknown error');
  return json(res, 500, { error: 'Authentication service error.' });
}

module.exports = { handleRouteError };
